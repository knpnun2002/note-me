// อ่านสลิปโอนเงินในเครื่อง (ฟรี ไม่ส่งรูปไปที่ไหน) ด้วย Tesseract.js ภาษาไทย+อังกฤษ
// ครั้งแรกต้องโหลดตัวอ่านประมาณ 10 MB แล้วเบราว์เซอร์เก็บไว้ใช้ออฟไลน์
// รูปสลิปย่อแล้วเก็บในเครื่อง (IndexedDB) และอัปโหลดไป Google Drive โฟลเดอร์ Note Me/slips เมื่อเชื่อมต่อ

import * as store from './store.js';
import * as sync from './sync.js';
import { loadScript } from './ui.js';
import { today, pad, TH_MONTHS, TH_MONTHS_SHORT } from './utils.js';
import { findWallet, guessCategory, matchBill, defaultWalletId } from './finance.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

// ตัวอ่านสร้างครั้งเดียวแล้วใช้ซ้ำ ถ้าโหลดค้าง/ล้มเหลว ให้ลองใหม่ได้ในครั้งถัดไป (ไม่ค้างตลอดไป)
let workerPromise = null;
let progressCb = null;
async function worker(onProgress) {
  progressCb = onProgress;
  await loadScript(TESSERACT);
  workerPromise ??= Promise.race([
    window.Tesseract.createWorker('tha+eng', 1, { logger: (m) => progressCb?.(m) }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('โหลดตัวอ่านสลิปนานเกินไป')), 180_000)),
  ]).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

// ---------- รูปภาพ ----------

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function resize(file, max, type = 'image/jpeg', quality = 0.7) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function fileHash(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- แปลข้อความจากสลิป ----------

const MONTHS = TH_MONTHS.map((full, i) => [full, TH_MONTHS_SHORT[i], TH_MONTHS_SHORT[i].replace(/\./g, '')]);
const BANKS = [
  [/make\s*by\s*kbank|\bmake\b/i, 'make'],
  [/k\s*plus|k\+|kbank|kasikorn|กสิกร/i, 'kbank'],
  [/truemoney|true\s*money|ทรูมันนี/i, 'truemoney'],
  [/scb|ไทยพาณิชย์|siam commercial/i, 'scb'],
  [/krungthai|กรุงไทย|ktb/i, 'กรุงไทย'],
  [/bangkok bank|ธนาคารกรุงเทพ|bbl/i, 'กรุงเทพ'],
  [/krungsri|กรุงศรี/i, 'กรุงศรี'],
  [/ttb|ทหารไทยธนชาต/i, 'ttb'],
];

const parseNum = (s) => Number(s.replace(/,/g, ''));

// เครื่องหมายบน/ล่างตัวอักษรไทย (OCR มักใส่เกินหรือตก)
const MARKS = '[\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E]*';

// หาเดือนจากข้อความ: ลองแบบตรงตัวก่อน ถ้าไม่เจอค่อยแบบยอมให้มีสระ/วรรณยุกต์เกินมา
// (เดือนที่มีสระในตัวย่อ เช่น มี.ค. มิ.ย. ลองก่อน ม.ค. จะได้ไม่จับผิดเดือน)
function findThaiDate(text) {
  const order = MONTHS.map((forms, i) => ({ forms, i })).sort((a, b) => /[ัิ-ฺ็-๎]/.test(b.forms[1]) - /[ัิ-ฺ็-๎]/.test(a.forms[1]));
  const exact = (f) => f.replace(/\./g, '\\.?');
  const loose = (f) => [...f.replace(/\./g, '')].map((ch) => `${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${MARKS}\\.?\\s*${MARKS}`).join('');
  for (const make of [exact, loose]) {
    for (const { forms, i } of order) {
      const alt = [...forms].sort((a, b) => b.length - a.length).map(make).join('|');
      const m = text.match(new RegExp(`(\\d{1,2})\\s*(?:${alt})\\s*(\\d{2,4})`));
      if (m) return { day: Number(m[1]), month: i + 1, year: Number(m[2]) };
    }
  }
  return null;
}

export function extractSlip(raw) {
  // OCR มักเขียน "ำ" เป็นนิคหิต+สระอา ("จํานวน") แปลงกลับก่อน
  const text = raw.replace(/ํา/g, 'ำ').replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { amount: null, date: null, time: null, payee: '', bank: null, income: false };

  // ยอดเงิน: ตัวเลขทศนิยม 2 ตำแหน่ง เลือกบรรทัดที่มีคำว่า จำนวน/Amount/บาท ก่อน ไม่งั้นเอาค่าที่มากที่สุด (ข้ามค่าธรรมเนียม)
  const money = /(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
  const candidates = [];
  for (const line of lines) {
    if (/ค่าธรรมเนียม|fee/i.test(line)) continue;
    for (const m of line.matchAll(money)) {
      const v = parseNum(`${m[1]}.${m[2]}`);
      if (v > 0) candidates.push({ v, strong: /จำนวน|amount|บาท|thb|฿/i.test(line) });
    }
  }
  const strong = candidates.filter((c) => c.strong);
  if (candidates.length) out.amount = Math.max(...(strong.length ? strong : candidates).map((c) => c.v));

  // วันที่: "26 ต.ค. 69", "26 ต.ค. 2569", "26/10/2569"
  const toYear = (y) => (y < 100 ? 2500 + y - 543 : y > 2400 ? y - 543 : y);
  const dm = findThaiDate(text);
  if (dm) {
    out.date = `${toYear(dm.year)}-${pad(dm.month)}-${pad(dm.day)}`;
  } else {
    const nd = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (nd) out.date = `${toYear(Number(nd[3]))}-${pad(Number(nd[2]))}-${pad(Number(nd[1]))}`;
  }
  if (out.date && (out.date > today() || out.date < '2000')) out.date = null;
  const tm = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (tm && Number(tm[1]) < 24) out.time = `${pad(Number(tm[1]))}:${tm[2]}`;

  // ธนาคาร/แอปที่ออกสลิป -> กระเป๋าของเรา
  for (const [re, name] of BANKS) {
    if (re.test(text)) {
      out.bank = name;
      break;
    }
  }

  out.income = /ได้รับเงิน|รับเงินโอน|ได้รับเงินโอน|received|เงินเข้า/i.test(text);

  // อีกฝ่าย: สลิปจ่ายดูบรรทัด ไปยัง/ถึง/To, สลิปรับเงินดูบรรทัด จาก/From
  // ถ้าไม่มีป้าย ใช้ชื่อที่ขึ้นต้นด้วย นาย/นาง/ร้าน/บจก (ชื่อแรกมักเป็นผู้โอน)
  // (ใช้ (?=\s|:|$) แทน \b เพราะ \b ของ JavaScript ไม่รู้จักตัวอักษรไทย)
  const labelRe = out.income ? /^(จาก|from)(?=\s|:|$)/i : /^(ไปยัง|ไป|ถึง|to|ผู้รับ)(?=\s|:|$)/i;
  const label = lines.findIndex((l) => labelRe.test(l));
  const clean = (l) => l.replace(/^(ไปยัง|ไป|ถึง|to|ผู้รับ|จาก|from)\s*:?\s*/i, '').replace(/[xX•*]{2,}[\d-]*|\d{3}-?\d-?x+.*$/g, '').trim();
  if (label >= 0) out.payee = clean(lines[label]) || clean(lines[label + 1] || '');
  if (!out.payee) {
    const names = lines.filter((l) => /^(นาย|นาง|น\.ส\.|ร้าน|บจก|บริษัท|หจก|mr\.?|ms\.?|mrs\.?)/i.test(l) || /\b(co\.,?|ltd|shop|store|\.com)\b/i.test(l));
    out.payee = clean(names[out.income ? 0 : 1] || names[0] || '');
  }
  out.payee = out.payee.slice(0, 60);
  return out;
}

// ---------- นำเข้าสลิป -> กล่องรอยืนยัน ----------

export async function importSlips(files, onProgress) {
  const known = new Set(store.all('transactions').map((t) => t.slipHash).filter(Boolean));
  const result = { added: 0, duplicates: 0, failed: 0 };
  let i = 0;
  for (const file of files) {
    i++;
    try {
      const hash = await fileHash(file);
      if (known.has(hash)) {
        result.duplicates++;
        continue;
      }
      onProgress?.({ index: i, total: files.length, status: 'กำลังอ่าน' });
      const w = await worker((m) => m.status && onProgress?.({ index: i, total: files.length, status: m.status, progress: m.progress }));
      const forOcr = await resize(file, 1600, 'image/png');
      const { data } = await w.recognize(forOcr);
      const s = extractSlip(data.text);
      const type = s.income ? 'income' : 'expense';
      const walletId = (s.bank && findWallet(s.bank)) || defaultWalletId();
      const tx = {
        status: 'pending',
        source: 'slip',
        type,
        amount: s.amount,
        date: s.date || today(),
        time: s.time,
        payee: s.payee,
        walletId,
        categoryId: guessCategory(s.payee, type),
        note: '',
        slipHash: hash,
        createdAt: Date.now(),
      };
      const bill = matchBill(tx);
      if (bill) Object.assign(tx, { recurringId: bill.r.id, billMonth: bill.mk, categoryId: bill.r.categoryId });
      const saved = store.put('transactions', tx);
      await saveImage(saved.id, await resize(file, 900, 'image/jpeg', 0.6));
      known.add(hash);
      result.added++;
    } catch (e) {
      console.error('slip', e);
      result.failed++;
    }
  }
  uploadPending();
  return result;
}

// ---------- เก็บรูปในเครื่อง + Drive ----------

export const imageKey = (id) => `img:${id}`;

export async function saveImage(id, blob) {
  await store.kvSet(imageKey(id), blob);
}

// คืน URL ของรูป (จากเครื่อง หรือดาวน์โหลดจาก Drive ถ้าบันทึกจากอีกเครื่อง)
export async function imageUrl(id, fileId) {
  let blob = await store.kvGet(imageKey(id));
  if (!blob && fileId && sync.isConnected()) {
    blob = await sync.downloadBlob(fileId);
    await store.kvSet(imageKey(id), blob);
  }
  return blob ? URL.createObjectURL(blob) : null;
}

// อัปโหลดรูปที่ยังไม่ขึ้น Drive (สลิปในรายการ และหลักฐานในเงินยืม)
let uploading = false;
export async function uploadPending() {
  if (uploading || !sync.isConnected() || !navigator.onLine) return;
  uploading = true;
  try {
    for (const t of store.all('transactions')) {
      if (t.slipHash && !t.slipFileId) {
        const blob = await store.kvGet(imageKey(t.id));
        if (blob) store.patch('transactions', t.id, { slipFileId: await sync.uploadBlob(blob, `slip-${t.date}-${t.id}.jpg`) }, { silent: true });
      }
    }
    for (const l of store.all('loans')) {
      const atts = l.attachments || [];
      if (!atts.some((a) => a.kind === 'file' && !a.fileId)) continue;
      const next = [];
      for (const a of atts) {
        const blob = a.kind === 'file' && !a.fileId ? await store.kvGet(imageKey(a.id)) : null;
        next.push(blob ? { ...a, fileId: await sync.uploadBlob(blob, a.name || `${a.id}`, 'loans') } : a);
      }
      store.patch('loans', l.id, { attachments: next }, { silent: true });
    }
  } catch (e) {
    console.warn('upload', e);
  } finally {
    uploading = false;
  }
}

sync.afterSync.add(uploadPending);
