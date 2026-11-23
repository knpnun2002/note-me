// ซิงค์ข้อมูลกับ Google Drive ของผู้ใช้ โดยไม่มีเซิร์ฟเวอร์กลาง
// ล็อกอินแบบ redirect (ไม่ใช้ป๊อปอัป) เพราะใช้ได้ดีกว่าบน iPhone ที่ติดตั้งเป็นแอป
// สิทธิ์ drive.file = แอปเห็นเฉพาะไฟล์ที่แอปสร้างเอง

import * as store from './store.js';
import { GOOGLE_CLIENT_ID, DRIVE_FOLDER, DRIVE_BACKUP_FOLDER, DRIVE_DATA_FILE } from './config.js';
import { pad, debounce } from './utils.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const LS = {
  token: 'nm_token',
  account: 'nm_account',
  connected: 'nm_connected',
  ids: 'nm_drive_ids',
  lastSync: 'nm_last_sync',
  oauthState: 'nm_oauth_state',
  returnHash: 'nm_return_hash',
  authAttempt: 'nm_auth_attempt',
};

const lsGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const lsSet = (k, v) => (v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)));

class AuthError extends Error {}

// ---------- สถานะ ----------
// off: ยังไม่เชื่อม, idle: ซิงค์แล้ว, syncing, offline, needAuth: ต้องล็อกอินใหม่, error

export const status = { state: 'off', message: '' };
const statusListeners = new Set();

export const onStatus = (fn) => statusListeners.add(fn);

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  for (const fn of statusListeners) fn(status);
}

export const isConfigured = () => !!GOOGLE_CLIENT_ID;
export const isConnected = () => isConfigured() && !!lsGet(LS.connected);
export const account = () => lsGet(LS.account);
export const lastSync = () => lsGet(LS.lastSync);

function tokenValid() {
  const t = lsGet(LS.token);
  return t && t.exp > Date.now() + 60_000;
}
const accessToken = () => lsGet(LS.token)?.token;

// ---------- OAuth (implicit flow แบบ redirect) ----------

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function connect({ silent = false } = {}) {
  const state = Math.random().toString(36).slice(2);
  lsSet(LS.oauthState, state);
  lsSet(LS.returnHash, location.hash.startsWith('#/') ? location.hash : '#/');
  lsSet(LS.authAttempt, Date.now());
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) p.set('prompt', 'none');
  const acct = account();
  if (acct?.email) p.set('login_hint', acct.email);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

// เรียกตอนเปิดแอป: ถ้ากลับมาจากหน้าล็อกอิน Google ให้เก็บ token
// คืนค่า null ถ้าไม่ใช่การกลับมาจากล็อกอิน
export function handleRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const ok = p.get('state') && p.get('state') === lsGet(LS.oauthState);
  const back = lsGet(LS.returnHash) || '#/';
  lsSet(LS.oauthState, null);
  history.replaceState(null, '', redirectUri() + back);
  if (!ok) return { ok: false, error: 'state_mismatch' };
  if (p.get('error')) return { ok: false, error: p.get('error') };
  lsSet(LS.token, { token: p.get('access_token'), exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 });
  lsSet(LS.connected, true);
  return { ok: true };
}

export function disconnect() {
  const t = accessToken();
  if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => {});
  for (const k of [LS.token, LS.account, LS.connected, LS.ids, LS.lastSync]) lsSet(k, null);
  for (const k of Object.keys(subFolders)) delete subFolders[k];
  setStatus('off');
}

// ---------- Drive API ----------

async function api(method, url, { body, headers = {}, raw = false } = {}) {
  if (!tokenValid()) throw new AuthError();
  const res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${accessToken()}`, ...headers } });
  if (res.status === 401) {
    lsSet(LS.token, null);
    throw new AuthError();
  }
  if (!res.ok) {
    const err = new Error(`Drive ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(name, parentId, mime) {
  let query = `name='${q(name)}' and trashed=false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  if (mime) query += ` and mimeType='${mime}'`;
  const res = await api('GET', `${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime&spaces=drive`);
  return res.files[0]?.id || null;
}

async function createFolder(name, parentId) {
  const meta = { name, mimeType: FOLDER_MIME, ...(parentId && { parents: [parentId] }) };
  const res = await api('POST', `${DRIVE}/files?fields=id`, {
    body: JSON.stringify(meta),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.id;
}

async function createJson(name, parentId, text) {
  const boundary = `nm${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const res = await api('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  });
  return res.id;
}

const updateJson = (fileId, text) =>
  api('PATCH', `${UPLOAD}/files/${fileId}?uploadType=media&fields=id`, {
    body: text,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });

const downloadJson = async (fileId) => (await api('GET', `${DRIVE}/files/${fileId}?alt=media`, { raw: true })).json();

// ---------- ไฟล์รูป (สลิป / หลักฐาน) ในโฟลเดอร์ Note Me/<sub> ----------

const subFolders = {};
async function subFolder(name) {
  if (subFolders[name]) return subFolders[name];
  const { folder } = await driveIds();
  subFolders[name] = (await findOne(name, folder, FOLDER_MIME)) || (await createFolder(name, folder));
  return subFolders[name];
}

export async function uploadBlob(blob, name, sub = 'slips') {
  const parent = await subFolder(sub);
  const boundary = `nm${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await api('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  });
  return res.id;
}

export const downloadBlob = async (fileId) => (await api('GET', `${DRIVE}/files/${fileId}?alt=media`, { raw: true })).blob();

// งานที่ต้องทำหลังซิงค์สำเร็จ (เช่น อัปโหลดรูปสลิปที่ค้างไว้ตอนออฟไลน์)
export const afterSync = new Set();

// หา/สร้างโฟลเดอร์ของแอป เก็บ id ไว้ ถ้าผู้ใช้ลบโฟลเดอร์ทิ้ง (404) จะหาใหม่
async function driveIds() {
  let ids = lsGet(LS.ids);
  if (ids?.folder && ids?.backups) return ids;
  const folder = (await findOne(DRIVE_FOLDER, null, FOLDER_MIME)) || (await createFolder(DRIVE_FOLDER));
  const backups = (await findOne(DRIVE_BACKUP_FOLDER, folder, FOLDER_MIME)) || (await createFolder(DRIVE_BACKUP_FOLDER, folder));
  const data = await findOne(DRIVE_DATA_FILE, folder);
  ids = { folder, backups, data };
  lsSet(LS.ids, ids);
  return ids;
}

async function withIds(fn) {
  try {
    return await fn(await driveIds());
  } catch (e) {
    if (e.status !== 404) throw e;
    lsSet(LS.ids, null);
    return fn(await driveIds());
  }
}

async function loadAccount() {
  if (account()) return;
  const res = await api('GET', `${DRIVE}/about?fields=user(displayName,emailAddress)`);
  lsSet(LS.account, { name: res.user.displayName, email: res.user.emailAddress });
}

// ---------- ซิงค์ ----------

let syncing = false;
let again = false;

export async function sync() {
  if (!isConnected()) return setStatus('off');
  if (syncing) {
    again = true;
    return;
  }
  if (!navigator.onLine) return setStatus('offline');
  if (!tokenValid()) return setStatus('needAuth');
  syncing = true;
  setStatus('syncing');
  try {
    await loadAccount();
    await withIds(async (ids) => {
      if (ids.data) {
        const remote = await downloadJson(ids.data);
        if (store.isValidDoc(remote)) store.mergeRemote(remote);
        if (store.signature(store.getDoc()) !== store.signature(remote)) await updateJson(ids.data, store.exportJson());
      } else {
        ids.data = await createJson(DRIVE_DATA_FILE, ids.folder, store.exportJson());
        lsSet(LS.ids, ids);
      }
    });
    lsSet(LS.lastSync, Date.now());
    setStatus('idle');
    await maybeAutoBackup();
    for (const fn of afterSync) await fn().catch((e) => console.warn('afterSync', e));
  } catch (e) {
    console.error('sync failed', e);
    if (e instanceof AuthError) setStatus('needAuth');
    else setStatus(navigator.onLine ? 'error' : 'offline', e.message);
  } finally {
    syncing = false;
    if (again) {
      again = false;
      sync();
    }
  }
}

const syncSoon = debounce(sync, 2000);

export function init(redirectResult) {
  if (!isConnected()) return setStatus('off');

  store.subscribe((opts) => {
    if (!opts.fromSync) syncSoon();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (lastSync() || 0) > 30_000) sync();
  });
  addEventListener('online', () => sync());
  addEventListener('offline', () => setStatus('offline'));

  if (tokenValid()) return sync();
  if (redirectResult && !redirectResult.ok) return setStatus('needAuth', redirectResult.error);

  // token หมดอายุ (อายุ 1 ชั่วโมง): ขอใหม่แบบเงียบตอนเปิดแอป ถ้าเปิดตั้งค่าไว้
  const recentlyTried = Date.now() - (lsGet(LS.authAttempt) || 0) < 2 * 60_000;
  if (store.settings().autoConnect && navigator.onLine && !recentlyTried) return connect({ silent: true });
  setStatus(navigator.onLine ? 'needAuth' : 'offline');
}

// ---------- สำรองข้อมูล ----------

function backupName() {
  const d = new Date();
  return `noteme-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export function isBackupDue() {
  const s = store.settings();
  return s.backupIntervalDays > 0 && Date.now() - (s.lastBackupAt || 0) >= s.backupIntervalDays * 864e5;
}

async function maybeAutoBackup() {
  if (isBackupDue()) await backupNow();
}

export async function backupNow() {
  await withIds(async (ids) => {
    await createJson(backupName(), ids.backups, store.exportJson());
    store.setSettings({ lastBackupAt: Date.now() }, { silent: true });
  });
  await pruneBackups();
}

export async function listBackups() {
  return withIds(async (ids) => {
    const query = `'${ids.backups}' in parents and trashed=false`;
    const res = await api(
      'GET',
      `${DRIVE}/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime,size)`
    );
    return res.files;
  });
}

async function pruneBackups() {
  const keep = store.settings().backupKeep || 10;
  const files = await listBackups();
  for (const f of files.slice(keep)) await api('DELETE', `${DRIVE}/files/${f.id}`);
}

export const downloadBackup = (fileId) => downloadJson(fileId);

// ดาวน์โหลดไฟล์สำรองลงเครื่อง (ใช้ได้แม้ไม่ได้เชื่อม Google)
export function downloadToDevice() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  if (!isConnected()) store.setSettings({ lastBackupAt: Date.now() }, { silent: true });
}
