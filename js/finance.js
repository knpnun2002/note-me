// การเงินแบบ Ebbly: กระเป๋า, เหลือใช้จริง, บิลที่ใกล้ถึง, จำผู้รับ, พิมพ์ภาษาไทย, ยืม/หาร, ลดหย่อนภาษี
//
// transaction: { type: 'expense'|'income'|'transfer', amount, categoryId, walletId, toWalletId (โอน),
//                payee, note, date, status?: 'pending' (สลิปรอยืนยัน), excluded? (ยืม/หาร ไม่นับเป็นรายจ่าย),
//                recurringId?, billMonth?, loanId?, splitId?, taxTag?, slipHash?, slipFileId? }

import * as store from './store.js';
import { today, monthOf, addMonths, daysInMonth, pad, addDays, money } from './utils.js';
import { categories, monthSummary, installmentIndex } from './logic.js';
import { parseQuickAdd } from './quickadd.js';

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// ---------- กระเป๋า ----------

export const wallets = () => store.all('wallets').filter((w) => !w.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const wallet = (id) => (id ? store.get('wallets', id) : null);

// ยอดตั้งต้นใส่ ณ วันหนึ่ง: นับเฉพาะรายการหลังจากนั้น (สลิปย้อนหลังจะไม่ทำให้ยอดเพี้ยน)
const afterBalance = (t, w) => t.date > w.balanceDate || (t.date === w.balanceDate && (t.createdAt || 0) > (w.balanceSetAt || 0));

export function walletBalance(w) {
  if (w.initialBalance == null) return null;
  let b = w.initialBalance;
  for (const t of store.all('transactions')) {
    if (t.status === 'pending' || !afterBalance(t, w)) continue;
    if (t.walletId === w.id) b += t.type === 'income' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.toWalletId === w.id) b += t.amount;
  }
  return round2(b);
}

export function setWalletBalance(w, amount) {
  store.patch('wallets', w.id, { initialBalance: amount, balanceDate: today(), balanceSetAt: Date.now() });
}

export function defaultWalletId() {
  const last = store.settings().lastWalletId;
  return (last && wallet(last) && !wallet(last).archived ? last : wallets()[0]?.id) || null;
}

// ---------- บิลประจำ ----------

export const bills = () => store.all('recurring').filter((r) => r.active && r.type === 'expense');

export function billPaid(r, mk) {
  const id = `rec_${r.id}_${mk}`;
  if (store.get('transactions', id)) return true;
  // บิลอัตโนมัติที่ผู้ใช้ลบรายการไปแล้ว ถือว่าข้ามเดือนนั้น
  if (r.auto !== false && store.exists('transactions', id)) return true;
  return store.all('transactions').some((t) => t.recurringId === r.id && t.billMonth === mk && t.status !== 'pending');
}

export function billDue(r, mk) {
  const index = installmentIndex(r, mk);
  if (!index) return null;
  const date = `${mk}-${pad(Math.min(r.day, daysInMonth(mk)))}`;
  if (date < r.startDate) return null;
  return { r, mk, date, index, amount: r.amount, paid: billPaid(r, mk) };
}

// บิลที่ยังไม่จ่ายของเดือนนี้ (รวมที่เลยวันแล้ว) และของเดือนหน้าที่จะถึงภายใน 7 วัน
export function upcomingBills(days = 7) {
  const t = today();
  const mk = monthOf(t);
  const out = [];
  for (const r of bills()) {
    for (const m of [mk, addMonths(mk, 1)]) {
      const b = billDue(r, m);
      if (!b || b.paid) continue;
      if (m !== mk && b.date > addDays(t, days)) continue;
      out.push(b);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function unpaidThisMonth() {
  const mk = monthOf(today());
  return bills()
    .map((r) => billDue(r, mk))
    .filter((b) => b && !b.paid);
}

export function payBill(r, mk, { walletId, date = today() } = {}) {
  const id = `rec_${r.id}_${mk}`;
  store.put('transactions', {
    id,
    type: 'expense',
    amount: r.amount,
    categoryId: r.categoryId,
    walletId: walletId || r.walletId || defaultWalletId(),
    payee: r.payee || '',
    note: r.name,
    date,
    recurringId: r.id,
    billMonth: mk,
    createdAt: Date.now(),
  });
}

// จับคู่สลิปกับบิลที่ยังไม่จ่าย: ชื่อผู้รับคล้ายกัน หรือยอดเท่ากัน (ต่างไม่เกิน 2%)
export function matchBill(tx) {
  if (tx.type !== 'expense' || !tx.amount) return null;
  const mk = monthOf(tx.date || today());
  const key = payeeKey(tx.payee || '');
  return (
    unpaidThisMonth().find((b) => {
      const near = Math.abs(b.amount - tx.amount) <= b.amount * 0.02;
      const bkey = payeeKey(b.r.payee || b.r.name);
      const sameName = key && bkey && (key.includes(bkey) || bkey.includes(key));
      return b.mk === mk && (sameName ? Math.abs(b.amount - tx.amount) <= b.amount * 0.15 : near && key === '');
    }) || null
  );
}

// เจอบิลประจำเอง: จ่ายผู้รับเดิม 3 เดือนติด ยอดใกล้กัน (ต่างไม่เกิน 10%) และยังไม่ได้ตั้งเป็นบิล
export function billSuggestions() {
  const dismissed = new Set(store.settings().dismissedBills || []);
  const linked = new Set(store.all('recurring').map((r) => payeeKey(r.payee || r.name)));
  const groups = new Map();
  for (const t of store.all('transactions')) {
    if (t.type !== 'expense' || t.status === 'pending' || t.excluded || t.recurringId || !t.payee) continue;
    const key = payeeKey(t.payee);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const cm = monthOf(today());
  const out = [];
  for (const [key, txs] of groups) {
    if (dismissed.has(key) || linked.has(key)) continue;
    const byMonth = new Map(txs.map((t) => [monthOf(t.date), t]));
    // 3 เดือนติดกัน จบที่เดือนนี้หรือเดือนก่อน
    const end = byMonth.has(cm) ? cm : addMonths(cm, -1);
    const months = [addMonths(end, -2), addMonths(end, -1), end];
    if (!months.every((m) => byMonth.has(m))) continue;
    const amounts = months.map((m) => byMonth.get(m).amount).sort((a, b) => a - b);
    const mid = amounts[1];
    if (amounts.some((a) => Math.abs(a - mid) > mid * 0.1)) continue;
    const last = byMonth.get(end);
    out.push({ key, payee: last.payee, amount: mid, day: Number(last.date.slice(8)), categoryId: last.categoryId, walletId: last.walletId, months: 3 });
  }
  return out;
}

export function dismissBillSuggestion(key) {
  store.setSettings({ dismissedBills: [...(store.settings().dismissedBills || []), key] });
}

// ---------- เหลือใช้จริง ----------
// รายได้ไม่แน่นอน จึงนับเป็นเดือนปฏิทิน
// ถ้าใส่ยอดตั้งต้นครบทุกกระเป๋า: เงินในกระเป๋าทั้งหมด − บิลที่ยังไม่จ่ายถึงสิ้นเดือน
// ถ้ายังไม่ได้ใส่: รายรับเดือนนี้ − ใช้ไปแล้ว − บิลที่ยังไม่จ่าย

export function safeToSpend() {
  const t = today();
  const mk = monthOf(t);
  const s = monthSummary(mk);
  const unpaid = unpaidThisMonth();
  const billsTotal = sum(unpaid.map((b) => b.amount));
  const ws = wallets();
  const allSet = ws.length > 0 && ws.every((w) => w.initialBalance != null);
  const cash = allSet ? sum(ws.map(walletBalance)) : null;
  const left = round2(allSet ? cash - billsTotal : s.income - s.expense - billsTotal);
  const daysLeft = daysInMonth(mk) - Number(t.slice(8)) + 1;
  return { mode: allSet ? 'wallets' : 'income', cash, income: s.income, spent: s.expense, billsTotal, unpaid, left, daysLeft, perDay: left > 0 ? left / daysLeft : 0 };
}

// ---------- จำผู้รับ -> หมวด ----------

export const payeeKey = (s) => String(s || '').toLowerCase().replace(/^(นาย|นางสาว|นาง|น\.ส\.|ร้าน|บจก\.?|บริษัท)\s*/, '').replace(/\s+/g, ' ').trim();

export function rememberPayee(tx) {
  if (!tx.payee || tx.type === 'transfer' || tx.excluded) return;
  const key = payeeKey(tx.payee);
  if (!key) return;
  const cur = store.get('payees', `py:${key}`);
  if (cur && cur.categoryId === tx.categoryId && cur.walletId === tx.walletId) return;
  store.put('payees', { id: `py:${key}`, name: tx.payee, type: tx.type, categoryId: tx.categoryId, walletId: tx.walletId || null }, { silent: true });
}

// เดาหมวดจากคำในชื่อ (ใช้เมื่อยังไม่เคยจ่ายผู้รับคนนี้)
const KEYWORDS = [
  ['c_food', /ข้าว|กาแฟ|ชา|ก๋วยเตี๋ยว|อาหาร|ขนม|น้ำ(?!มัน)|มื้อ|หมูกระทะ|ชาบู|บุฟเฟ่|pizza|kfc|mcdonald|starbucks|café|cafe|bakery|ไก่|ส้มตำ|ร้านอาหาร|grabfood|lineman|foodpanda|robinhood/i],
  ['c_transport', /bts|mrt|แท็กซี่|taxi|grab(?!food)|bolt|น้ำมัน|ทางด่วน|ค่ารถ|วินมอไซ|รถเมล์|ปตท|ptt|shell|bangchak|บางจาก|ที่จอดรถ/i],
  ['c_home', /ค่าเช่า|ค่าห้อง|คอนโด|หอพัก|ส่วนกลาง/i],
  ['c_bills', /ค่าไฟ|ค่าน้ำประปา|ค่าน้ำ|ค่าเน็ต|อินเทอร์เน็ต|ค่าโทร|ais|dtac|true(?!money)|3bb|การไฟฟ้า|การประปา|บัตรเครดิต|ประกัน/i],
  ['c_shopping', /shopee|lazada|7-?11|เซเว่น|lotus|โลตัส|big ?c|makro|แม็คโคร|ช้อป|ซื้อ|ห้าง|central|เสื้อ|รองเท้า|ikea|uniqlo/i],
  ['c_health', /ยา|หมอ|คลินิก|โรงพยาบาล|รพ\.|ฟิตเนส|fitness|ทำฟัน|ตรวจสุขภาพ|วิตามิน/i],
  ['c_fun', /netflix|spotify|youtube|disney|หนัง|ดูหนัง|เกม|game|steam|คอนเสิร์ต|เที่ยว|ตั๋ว|major|sf ?cinema/i],
  ['c_edu', /คอร์ส|course|หนังสือ|เรียน|ติว|udemy|สัมมนา/i],
];
const INCOME_WORDS = /เงินเดือน|รายได้|ได้รับ|รับเงิน|รับโอน|เงินเข้า|ค่าจ้าง|โบนัส|ขายได้|ขายของ|ลูกค้าโอน|ค่าคอม|ปันผล|ดอกเบี้ยรับ|คืนเงิน/;

export function guessCategory(text, type) {
  const memory = store.get('payees', `py:${payeeKey(text)}`);
  if (memory?.categoryId && store.get('categories', memory.categoryId)) return memory.categoryId;
  const has = (id) => !!store.get('categories', id);
  if (type === 'income') {
    if (/เงินเดือน|ค่าจ้าง|โบนัส/.test(text) && has('c_salary')) return 'c_salary';
    if (/ขาย|ลูกค้า|ค่าคอม|ฟรีแลนซ์|freelance/.test(text) && has('c_side')) return 'c_side';
    return categories('income').at(-1)?.id;
  }
  for (const [id, re] of KEYWORDS) if (re.test(text) && has(id)) return id;
  return categories('expense').at(-1)?.id;
}

// ---------- พิมพ์ภาษาไทย: "กาแฟ 65 ทรูมันนี่", "เงินเดือน 25000 make", "โอน 1000 kbank ไป make" ----------

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walletAliasRe() {
  const pairs = [];
  for (const w of wallets()) for (const a of [w.name, ...(w.aliases || [])]) if (a) pairs.push([a.toLowerCase(), w.id]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  return { re: pairs.length ? new RegExp(`(${pairs.map(([a]) => reEsc(a)).join('|')})`, 'gi') : null, map: new Map(pairs) };
}

export function findWallet(text) {
  const { re, map } = walletAliasRe();
  const m = re && String(text).match(re);
  return m ? map.get(m[0].toLowerCase()) : null;
}

export function parseMoney(input) {
  let text = ` ${input} `;
  const out = { amount: null, type: 'expense', walletId: null, toWalletId: null, date: null, payee: '', categoryId: null };

  // จำนวนเงิน: ตัวเลขที่มี บาท/฿ ก่อน ถ้าไม่มีใช้ตัวเลขสุดท้าย
  const numRe = /(?:฿\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(บาท|฿|baht|thb)?/gi;
  const nums = [...text.matchAll(numRe)].filter((m) => m[0].trim());
  const pick = nums.find((m) => m[3] || m[0].trim().startsWith('฿')) || nums.at(-1);
  if (pick) {
    out.amount = round2(Number(pick[1].replace(/,/g, '') + (pick[2] ? `.${pick[2]}` : '')));
    text = text.slice(0, pick.index) + ' ' + text.slice(pick.index + pick[0].length);
  }

  // โอนระหว่างกระเป๋า: "kbank ไป make", "จาก kbank เข้า make"
  const { re, map } = walletAliasRe();
  if (re) {
    const src = re.source;
    const tr = new RegExp(`(?:โอน\\s*)?(?:จาก\\s*)?${src}\\s*(?:ไป|เข้า|→|->|to)\\s*${src}`, 'i');
    const m = text.match(tr);
    if (m) {
      out.type = 'transfer';
      out.walletId = map.get(m[1].toLowerCase());
      out.toWalletId = map.get(m[2].toLowerCase());
      text = text.replace(m[0], ' ');
    } else {
      const w = text.match(new RegExp(src, 'i'));
      if (w) {
        out.walletId = map.get(w[0].toLowerCase());
        text = text.replace(w[0], ' ').replace(/\s(?:จ่าย)?(?:ด้วย|ผ่าน|จาก|เข้า)\s*$/, ' ');
      }
    }
  }
  text = text.replace(/\s(?:จ่าย)?(?:ด้วย|ผ่าน)\s/g, ' ');

  // วันที่ (ใช้ตัวแปลเดียวกับหน้าแพลน)
  const p = parseQuickAdd(text.trim());
  if (p.date && p.raws.date.length) {
    out.date = p.date;
    text = p.title;
  }

  if (out.type !== 'transfer' && INCOME_WORDS.test(text)) out.type = 'income';
  out.payee = text.replace(/^\s*(?:โอน|จ่าย|ซื้อ)\s+/, ' ').replace(/\s+/g, ' ').trim();
  if (out.type !== 'transfer') out.categoryId = guessCategory(out.payee, out.type);
  return out;
}

// ---------- ยืม / ให้ยืม ----------
// loan: { person, direction: 'lent' (ให้ยืม) | 'borrowed' (ยืมมา), principal, rate (% ต่อเดือน แบบคงที่),
//         months, startDate, dueDay, note, payments: [{id, date, amount, txId}], attachments: [{id, kind, name, text}] }

export function loanInfo(l) {
  const months = Math.max(1, l.months || 1);
  const interest = round2((l.principal * (l.rate || 0) * months) / 100);
  const total = round2(l.principal + interest);
  const per = Math.ceil(total / months);
  const paid = round2(sum((l.payments || []).map((p) => p.amount)));
  const remaining = Math.max(0, round2(total - paid));
  const paidCount = remaining <= 0 ? months : Math.min(months, Math.floor((paid + 0.005) / per));
  const nextIndex = remaining > 0 ? paidCount + 1 : null;
  const nextAmount = remaining > 0 ? Math.min(per, remaining) : 0;
  let nextDue = null;
  if (nextIndex) {
    const first = addMonths(monthOf(l.startDate), l.dueDay && l.dueDay < Number(l.startDate.slice(8)) ? 1 : 0);
    const m = addMonths(first, nextIndex - 1);
    nextDue = `${m}-${pad(Math.min(l.dueDay || Number(l.startDate.slice(8)), daysInMonth(m)))}`;
  }
  return { months, interest, total, per, paid, remaining, paidCount, nextIndex, nextAmount, nextDue, done: remaining <= 0 };
}

// ---------- หารกับเพื่อน ----------
// split: { title, date, total, myShare, people: [{id, name, amount, paid, txId}], walletId, categoryId, txIds: [] }

export function splitInfo(s) {
  const others = s.people || [];
  const owed = round2(sum(others.map((p) => p.amount)));
  const got = round2(sum(others.filter((p) => p.paid).map((p) => p.amount)));
  return { owed, got, waiting: round2(owed - got), done: got >= owed };
}

// ---------- ลดหย่อนภาษี ----------

export const TAX_TAGS = { esg: 'ThaiESG / กองทุนลดหย่อน', insurance: 'ประกันชีวิต / สุขภาพ', donation: 'เงินบริจาค', other: 'ลดหย่อนอื่นๆ' };

export function taxSummary(year) {
  const txs = store.all('transactions').filter((t) => t.taxTag && t.status !== 'pending' && t.date.startsWith(String(year)));
  const totals = Object.fromEntries(Object.keys(TAX_TAGS).map((k) => [k, 0]));
  for (const t of txs) totals[t.taxTag] = round2((totals[t.taxTag] || 0) + t.amount);
  return { totals, txs: txs.sort((a, b) => b.date.localeCompare(a.date)) };
}

// ---------- ส่งออก CSV (เปิดใน Excel ภาษาไทยได้) ----------

export function transactionsCsv() {
  const typeName = { expense: 'รายจ่าย', income: 'รายรับ', transfer: 'โอน' };
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['วันที่', 'ประเภท', 'จำนวนเงิน', 'หมวด', 'กระเป๋า', 'ไปกระเป๋า', 'ผู้รับ/ผู้จ่าย', 'โน้ต', 'ลดหย่อนภาษี', 'ไม่นับเป็นรายจ่าย']];
  const txs = store.all('transactions').filter((t) => t.status !== 'pending').sort((a, b) => a.date.localeCompare(b.date));
  for (const t of txs) {
    rows.push([
      t.date,
      typeName[t.type] || t.type,
      t.amount,
      store.get('categories', t.categoryId)?.name || '',
      wallet(t.walletId)?.name || '',
      wallet(t.toWalletId)?.name || '',
      t.payee || '',
      t.note || '',
      t.taxTag ? TAX_TAGS[t.taxTag] : '',
      t.excluded ? 'ใช่' : '',
    ]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export const fmtBalance = (w) => {
  const b = walletBalance(w);
  return b == null ? 'ตั้งยอด' : money(b);
};
