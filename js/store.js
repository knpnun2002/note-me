// ข้อมูลทั้งหมดอยู่ในเอกสารเดียว แบ่งเป็นคอลเลกชัน แต่ละคอลเลกชันเป็น { id: record }
// ทุก record มี updatedAt และการลบจะเหลือ { id, deleted: true, updatedAt } ไว้
// เพื่อให้รวมข้อมูลจากหลายเครื่องได้ทีละรายการ (record ที่ใหม่กว่าชนะ)

import { uid } from './utils.js';

export const COLLECTIONS = [
  'habits', 'habitLogs', 'notes',
  'tasks', 'projects', 'sections', 'taskLog',
  'transactions', 'categories', 'recurring', 'goals',
  'wallets', 'payees', 'loans', 'splits',
  'settings',
];

// กระเป๋าเริ่มต้น aliases ใช้จับคำตอนพิมพ์ ("กาแฟ 65 ทรูมันนี่") และตอนอ่านสลิป
const DEFAULT_WALLETS = [
  ['w_kbank', 'KBank', 'KB', '#138f2d', ['kbank', 'k bank', 'kplus', 'k plus', 'k+', 'กสิกร', 'กสิกรไทย', 'เคแบงก์']],
  ['w_make', 'MAKE', 'MK', '#7c3aed', ['make', 'make by kbank', 'เมค', 'เมก']],
  ['w_truemoney', 'TrueMoney', 'TM', '#f97316', ['truemoney', 'true money', 'ทรูมันนี่', 'ทรูมันนี', 'ทรู', 'tmn', 'wallet']],
];

// โปรเจกต์เริ่มต้น (id คงที่ เหมือนหมวดหมู่การเงิน) งานที่ไม่มีโปรเจกต์อยู่ใน Inbox
const DEFAULT_PROJECTS = [
  ['p_work', 'งาน', '💼', '#3b82f6'],
  ['p_personal', 'ส่วนตัว', '🏠', '#16a37f'],
  ['p_study', 'เรียน', '📚', '#8b5cf6'],
];

const DEFAULT_CATEGORIES = [
  ['c_food', 'expense', 'อาหารและเครื่องดื่ม', '#c46f3a'],
  ['c_transport', 'expense', 'เดินทาง', '#3b6ea8'],
  ['c_home', 'expense', 'ที่พัก / ค่าเช่า', '#7a5ba6'],
  ['c_bills', 'expense', 'บิลและสาธารณูปโภค', '#6b7280'],
  ['c_shopping', 'expense', 'ช้อปปิ้ง', '#b8577a'],
  ['c_health', 'expense', 'สุขภาพ', '#2e7d6b'],
  ['c_fun', 'expense', 'บันเทิง', '#b89a2e'],
  ['c_edu', 'expense', 'การศึกษา', '#5f8a3a'],
  ['c_other_ex', 'expense', 'อื่นๆ', '#9ca3af'],
  ['c_salary', 'income', 'เงินเดือน', '#2e7d6b'],
  ['c_side', 'income', 'รายได้เสริม', '#3b6ea8'],
  ['c_other_in', 'income', 'อื่นๆ', '#9ca3af'],
];

const DEFAULT_SETTINGS = { id: 'app', backupIntervalDays: 7, backupKeep: 10, autoConnect: true, lastBackupAt: 0, dailyGoal: 5, weeklyGoal: 25 };

let doc = null;
const listeners = new Set();

export function emptyDoc() {
  const d = { version: 1 };
  for (const c of COLLECTIONS) d[c] = {};
  return d;
}

// ---------- IndexedDB (key-value) ----------

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('noteme', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function kvGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- โหลด / บันทึก ----------

export async function load() {
  doc = (await kvGet('doc')) || emptyDoc();
  for (const c of COLLECTIONS) doc[c] ??= {};
  ensureDefaults();
  await persist();
}

// id ของค่าเริ่มต้นคงที่ เพื่อไม่ให้แต่ละเครื่องสร้างซ้ำกันตอนซิงค์
function ensureDefaults() {
  if (!doc.settings.app) doc.settings.app = { ...DEFAULT_SETTINGS, updatedAt: 0 };
  if (!Object.keys(doc.categories).length) {
    DEFAULT_CATEGORIES.forEach(([id, type, name, color], i) => {
      doc.categories[id] = { id, type, name, color, budget: 0, order: i, updatedAt: 0 };
    });
  }
  if (!Object.keys(doc.projects).length) {
    DEFAULT_PROJECTS.forEach(([id, name, icon, color], i) => {
      doc.projects[id] = { id, name, icon, color, order: i, view: 'list', updatedAt: 0 };
    });
  }
  if (!Object.keys(doc.wallets).length) {
    DEFAULT_WALLETS.forEach(([id, name, badge, color, aliases], i) => {
      doc.wallets[id] = { id, name, badge, color, aliases, initialBalance: null, order: i, updatedAt: 0 };
    });
  }
}

let persistChain = Promise.resolve();
function persist() {
  const snapshot = doc;
  persistChain = persistChain.then(() => kvSet('doc', snapshot)).catch((e) => console.error('persist failed', e));
  return persistChain;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let batchDepth = 0;
let batchDirty = false;

// opts.silent: ไม่ต้องวาดหน้าจอใหม่, opts.fromSync: มาจากการซิงค์ (ไม่ต้องซิงค์ซ้ำ)
function changed(opts = {}) {
  if (batchDepth) {
    batchDirty = true;
    return;
  }
  persist();
  for (const fn of listeners) fn(opts);
}

// ---------- อ่าน / เขียน record ----------

export const getDoc = () => doc;

export function all(col) {
  return Object.values(doc[col]).filter((r) => !r.deleted);
}

export function get(col, id) {
  const r = doc[col][id];
  return r && !r.deleted ? r : null;
}

// เคยมี id นี้ไหม รวมถึงที่ลบไปแล้ว
export const exists = (col, id) => id in doc[col];

function stamp(prev) {
  return Math.max(Date.now(), (prev?.updatedAt || 0) + 1);
}

export function put(col, rec, opts) {
  const id = rec.id || uid();
  const saved = { ...rec, id, updatedAt: stamp(doc[col][id]) };
  delete saved.deleted;
  doc[col][id] = saved;
  changed(opts);
  return saved;
}

export function patch(col, id, fields, opts) {
  const cur = get(col, id);
  if (!cur) return null;
  return put(col, { ...cur, ...fields }, opts);
}

export function remove(col, id, opts) {
  if (!doc[col][id]) return;
  doc[col][id] = { id, deleted: true, updatedAt: stamp(doc[col][id]) };
  changed(opts);
}

// เขียนหลายรายการแล้วแจ้งเปลี่ยนครั้งเดียว
export function batch(fn, opts) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (!batchDepth && batchDirty) {
      batchDirty = false;
      changed(opts);
    }
  }
}

export const settings = () => doc.settings.app;
export const setSettings = (fields, opts) => patch('settings', 'app', fields, opts);

// ---------- ซิงค์ / สำรอง ----------

export function merge(a, b) {
  const out = emptyDoc();
  for (const c of COLLECTIONS) {
    const A = a?.[c] || {};
    const B = b?.[c] || {};
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = A[id];
      const y = B[id];
      out[c][id] = !y || (x && (x.updatedAt || 0) >= (y.updatedAt || 0)) ? x : y;
    }
  }
  return out;
}

// ลายเซ็นของเอกสาร ใช้เช็คว่าสองฝั่งเหมือนกันไหม
export function signature(d) {
  return COLLECTIONS.map((c) =>
    Object.values(d?.[c] || {})
      .map((r) => `${r.id}:${r.updatedAt}`)
      .sort()
      .join(',')
  ).join('|');
}

// รวมข้อมูลจาก Drive เข้ากับข้อมูลในเครื่อง ณ ขณะนั้น
export function mergeRemote(remote) {
  const merged = merge(doc, remote);
  if (signature(merged) === signature(doc)) return false;
  doc = merged;
  changed({ fromSync: true });
  return true;
}

// ไฟล์จากเวอร์ชันเก่าอาจยังไม่มีคอลเลกชันใหม่ (เช่น projects) ถือว่าใช้ได้
export function isValidDoc(d) {
  return d && typeof d === 'object' && d.version === 1 && typeof d.habits === 'object' && COLLECTIONS.every((c) => d[c] === undefined || typeof d[c] === 'object');
}

// กู้คืนจากไฟล์สำรอง: ทุก record ในไฟล์ถูกประทับเวลาใหม่ให้ชนะข้อมูลเดิม
// และ record ที่ไม่มีในไฟล์สำรองถูกลบ
export function restore(backup) {
  const now = Date.now();
  const next = emptyDoc();
  for (const c of COLLECTIONS) {
    for (const [id, r] of Object.entries(backup[c] || {})) next[c][id] = { ...r, updatedAt: now };
    for (const id of Object.keys(doc[c])) {
      if (!(id in next[c])) next[c][id] = { id, deleted: true, updatedAt: now };
    }
  }
  doc = next;
  ensureDefaults();
  changed();
}

export function exportJson() {
  return JSON.stringify(doc);
}
