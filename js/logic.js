import * as store from './store.js';
import { today, addDays, weekday, weekStart, monthOf, addMonths, daysInMonth, pad, toKey } from './utils.js';

// ---------- กิจวัตร ----------
// freq: { kind: 'daily' } | { kind: 'weekdays', days: [0..6] } | { kind: 'perWeek', times: n }
// type: 'check' (ทำ/ไม่ทำ) | 'count' (นับจำนวน ถึง target ถือว่าเสร็จ)
// startDate / endDate (ถ้ามี): ช่วงวันที่ใช้กิจวัตรนี้, reminder: 'HH:MM' สำหรับเตือนผ่านปฏิทิน

export const logId = (habitId, date) => `${habitId}|${date}`;

export function activeHabits() {
  return store.all('habits').filter((h) => !h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const habitIcon = (h) => h.icon || '✨';
export const habitStart = (h) => h.startDate || toKey(new Date(h.createdAt || Date.now()));
export const isActiveOn = (h, date) => date >= habitStart(h) && (!h.endDate || date <= h.endDate);

// วันสุดท้ายที่นับสถิติ: วันนี้ หรือวันสิ้นสุดถ้ากิจวัตรจบไปแล้ว
const lastDay = (h) => (h.endDate && h.endDate < today() ? h.endDate : today());

export function isDue(h, date) {
  return h.freq.kind === 'weekdays' ? h.freq.days.includes(weekday(date)) : true;
}

export function logValue(h, date) {
  return store.get('habitLogs', logId(h.id, date))?.value || 0;
}

export const target = (h) => (h.type === 'count' ? Math.max(1, h.target || 1) : 1);
export const isDone = (h, date) => logValue(h, date) >= target(h);

export function setLog(h, date, value) {
  const id = logId(h.id, date);
  if (value <= 0) store.remove('habitLogs', id);
  else store.put('habitLogs', { id, habitId: h.id, date, value });
}

export function toggle(h, date) {
  if (h.type === 'count') setLog(h, date, logValue(h, date) >= target(h) ? 0 : target(h));
  else setLog(h, date, isDone(h, date) ? 0 : 1);
}

export function weekDoneCount(h, anyDate) {
  const ws = weekStart(anyDate);
  let n = 0;
  for (let i = 0; i < 7; i++) if (isDone(h, addDays(ws, i))) n++;
  return n;
}

const weekMet = (h, date) => weekDoneCount(h, date) >= h.freq.times;

// กิจวัตรที่แสดงในวันนั้น (แบบ X ครั้ง/สัปดาห์ แสดงทุกวัน)
export function habitsForDay(date) {
  return activeHabits().filter((h) => isDue(h, date) && isActiveOn(h, date));
}

// แบบ X ครั้ง/สัปดาห์: วันที่ไม่ได้ทำไม่นับเป็นงานค้าง ถ้าสัปดาห์นั้นทำครบแล้ว
export const countsOn = (h, date) => h.freq.kind !== 'perWeek' || isDone(h, date) || !weekMet(h, date);

export function dayProgress(date) {
  const list = habitsForDay(date);
  const counted = list.filter((h) => countsOn(h, date));
  const done = counted.filter((h) => isDone(h, date)).length;
  return { list, total: counted.length, done, allDone: counted.length > 0 && done === counted.length };
}

// วันที่พลาด สำหรับปฏิทินรายกิจวัตร (แบบ X ครั้ง/สัปดาห์ ตัดสินเมื่อสัปดาห์นั้นจบแล้ว)
export function isMissed(h, date) {
  const t = today();
  if (date >= t || !isActiveOn(h, date) || !isDue(h, date) || isDone(h, date)) return false;
  if (h.freq.kind === 'perWeek') return weekStart(date) < weekStart(t) && !weekMet(h, date);
  return true;
}

function firstLogDate(h) {
  let first = habitStart(h);
  for (const l of store.all('habitLogs')) if (l.habitId === h.id && l.date < first) first = l.date;
  return first;
}

export function currentStreak(h) {
  const t = lastDay(h);
  const start = firstLogDate(h);
  if (h.freq.kind === 'perWeek') {
    let ws = weekStart(t);
    if (weekDoneCount(h, ws) < h.freq.times) ws = addDays(ws, -7);
    let n = 0;
    while (ws >= weekStart(start) && weekDoneCount(h, ws) >= h.freq.times) {
      n++;
      ws = addDays(ws, -7);
    }
    return n;
  }
  let d = isDone(h, t) ? t : addDays(t, -1);
  let n = 0;
  while (d >= start) {
    if (isDue(h, d)) {
      if (!isDone(h, d)) break;
      n++;
    }
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(h) {
  const t = lastDay(h);
  const start = firstLogDate(h);
  let best = 0;
  let run = 0;
  if (h.freq.kind === 'perWeek') {
    for (let ws = weekStart(start); ws <= t; ws = addDays(ws, 7)) {
      run = weekDoneCount(h, ws) >= h.freq.times ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  }
  for (let d = start; d <= t; d = addDays(d, 1)) {
    if (!isDue(h, d)) continue;
    if (isDone(h, d)) run++;
    else if (d !== t) run = 0;
    best = Math.max(best, run);
  }
  return best;
}

export const streakUnit = (h) => (h.freq.kind === 'perWeek' ? 'สัปดาห์' : 'วัน');

// อัตราสำเร็จช่วง from..to (ไม่นับวันนี้ถ้ายังไม่ได้ทำ) คืน null ถ้ายังไม่มีวันให้นับ
export function rateBetween(h, from, to) {
  const t = today();
  if (to > lastDay(h)) to = lastDay(h);
  const start = firstLogDate(h);
  if (from < start) from = start;
  if (from > to) return null;
  if (h.freq.kind === 'perWeek') {
    let met = 0;
    let total = 0;
    for (let ws = weekStart(from); ws <= to; ws = addDays(ws, 7)) {
      const ok = weekMet(h, ws);
      if (ws === weekStart(t) && !ok) continue;
      total++;
      if (ok) met++;
    }
    return total ? met / total : null;
  }
  let due = 0;
  let done = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isDue(h, d)) continue;
    const ok = isDone(h, d);
    if (d === t && !ok) continue;
    due++;
    if (ok) done++;
  }
  return due ? done / due : null;
}

// สรุปช่วง from..to: ทำไปกี่ครั้ง จากที่ควรทำกี่ครั้ง (ไม่นับวันนี้ถ้ายังไม่ได้ทำ)
// แบบ X ครั้ง/สัปดาห์ นับเป็นรายสัปดาห์ (ทำเกินในสัปดาห์เดียวไม่ชดเชยสัปดาห์อื่น)
export function periodStats(h, from, to) {
  const t = today();
  let done = 0;
  let due = 0;
  if (h.freq.kind === 'perWeek') {
    for (let ws = weekStart(from); ws <= to && ws <= t; ws = addDays(ws, 7)) {
      if (!isActiveOn(h, ws) && !isActiveOn(h, addDays(ws, 6))) continue;
      due += h.freq.times;
      done += Math.min(h.freq.times, weekDoneCount(h, ws));
    }
    return { done, due };
  }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d > t || !isActiveOn(h, d) || !isDue(h, d)) continue;
    const ok = isDone(h, d);
    if (d === t && !ok) continue;
    due++;
    if (ok) done++;
  }
  return { done, due };
}

// จำนวนวันที่ทำสำเร็จ ในช่วงวันที่ (ไม่ใส่ช่วง = ทั้งหมด)
export function doneCount(h, from = '0000', to = '9999') {
  return store.all('habitLogs').filter((l) => l.habitId === h.id && l.date >= from && l.date <= to && l.value >= target(h)).length;
}

// ---------- ภาพรวมทุกกิจวัตร ----------

// ทำครบทุกกิจวัตรติดกันกี่วัน (วันที่ไม่มีกิจวัตรต้องทำจะข้ามไป)
export function allDoneStreaks() {
  const habits = activeHabits();
  if (!habits.length) return { current: 0, best: 0 };
  const t = today();
  let best = 0;
  let run = 0;
  for (let d = habits.map(firstLogDate).sort()[0]; d <= t; d = addDays(d, 1)) {
    const p = dayProgress(d);
    if (!p.total) continue;
    if (p.allDone) run++;
    else if (d !== t) run = 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

export const monthOverview = (mk) => rangeOverview(`${mk}-01`, `${mk}-${pad(daysInMonth(mk))}`);

// ภาพรวมทุกกิจวัตรในช่วงวันที่: ความคืบหน้ารายวัน, % รวม, วันที่ทำครบ, วันที่ไม่ได้ทำเลย
export function rangeOverview(from, to) {
  const t = today();
  const days = [];
  let done = 0;
  let due = 0;
  let allDoneDays = 0;
  let zeroDays = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (date > t) {
      days.push({ date, future: true });
      continue;
    }
    const p = dayProgress(date);
    days.push({ date, ...p });
    if (!p.total) continue;
    const pending = date === t && !p.allDone;
    done += p.done;
    due += pending ? p.done : p.total;
    if (p.allDone) allDoneDays++;
    if (!pending && p.done === 0) zeroDays++;
  }
  return { days, rate: due ? done / due : null, allDoneDays, zeroDays };
}

export function freqLabel(h) {
  const f = h.freq;
  if (f.kind === 'daily') return 'ทุกวัน';
  if (f.kind === 'perWeek') return `${f.times} ครั้ง/สัปดาห์`;
  const names = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  if (f.days.length === 5 && [1, 2, 3, 4, 5].every((d) => f.days.includes(d))) return 'จันทร์–ศุกร์';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => f.days.includes(d)).map((d) => names[d]).join(' ');
}

// ---------- การเงิน ----------
// (งานและแพลนอยู่ใน tasks.js)

export function categories(type) {
  return store
    .all('categories')
    .filter((c) => !type || c.type === type)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// รายการที่ยืนยันแล้วของเดือน (สลิปที่รอยืนยันแยกไปอยู่กล่อง "รอยืนยัน")
export function monthTransactions(mk) {
  return store
    .all('transactions')
    .filter((t) => t.status !== 'pending' && t.date.startsWith(mk))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

// โอนระหว่างกระเป๋า และเงินยืม/หารที่ออกให้คนอื่น ไม่นับเป็นรายรับรายจ่ายจริง
export const isSpendingTx = (t) => t.type !== 'transfer' && !t.excluded;

export function monthSummary(mk) {
  let income = 0;
  let expense = 0;
  const byCat = new Map();
  for (const t of monthTransactions(mk)) {
    if (!isSpendingTx(t)) continue;
    if (t.type === 'income') income += t.amount;
    else {
      expense += t.amount;
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    }
  }
  // เทียบงบกับรายจ่ายเฉพาะหมวดที่ตั้งงบไว้
  let budgetTotal = 0;
  let budgetUsed = 0;
  for (const c of categories('expense')) {
    if (!(c.budget > 0)) continue;
    budgetTotal += c.budget;
    budgetUsed += byCat.get(c.id) || 0;
  }
  return { income, expense, balance: income - expense, byCat, budgetTotal, budgetUsed };
}

// ใช้กับรายการเก่าที่บันทึกก่อนมีกระเป๋า
export const PAY_METHODS = { cash: 'เงินสด', transfer: 'โอน / QR', card: 'บัตร' };

// รายการประจำ/บิล: auto (ค่าเดิม) = บันทึกให้เองเมื่อถึงวัน, auto: false = รอกด "จ่ายแล้ว" หรือจับคู่สลิป
// installments = จำนวนงวด (ผ่อน) ว่าง = ไม่จำกัด
// id ของรายการที่สร้างคงที่ต่อเดือน (rec_<id>_<YYYY-MM>) จะได้ไม่ซ้ำจากหลายเครื่อง และลบแล้วไม่สร้างกลับ
export function generateRecurring() {
  const t = today();
  const cm = monthOf(t);
  store.batch(() => {
    for (const r of store.all('recurring')) {
      if (!r.active || r.auto === false) continue;
      let m = r.lastGenerated ? addMonths(r.lastGenerated, 1) : monthOf(r.startDate);
      let last = r.lastGenerated;
      while (m <= cm) {
        const date = `${m}-${pad(Math.min(r.day, daysInMonth(m)))}`;
        if (date > t) break;
        const id = `rec_${r.id}_${m}`;
        const index = installmentIndex(r, m);
        if (date >= r.startDate && index && !store.exists('transactions', id)) {
          store.put('transactions', {
            id,
            type: r.type,
            amount: r.amount,
            categoryId: r.categoryId,
            walletId: r.walletId || null,
            method: r.method,
            payee: r.payee || '',
            note: r.name,
            date,
            recurringId: r.id,
            billMonth: m,
            createdAt: Date.now(),
          });
        }
        last = m;
        m = addMonths(m, 1);
      }
      if (last !== r.lastGenerated) store.patch('recurring', r.id, { lastGenerated: last });
    }
  });
}

// เดือนแรกที่มีงวด: เดือนของวันเริ่ม ถ้าวันที่ของบิลยังไม่ผ่านวันเริ่ม ไม่งั้นเดือนถัดไป
export function firstBillMonth(r) {
  const m = monthOf(r.startDate);
  return `${m}-${pad(Math.min(r.day, daysInMonth(m)))}` >= r.startDate ? m : addMonths(m, 1);
}

// งวดที่เท่าไหร่ในเดือนนั้น (1, 2, …) หรือ 0 ถ้าเดือนนั้นไม่มีงวด (ก่อนเริ่ม / ผ่อนครบแล้ว)
export function installmentIndex(r, mk) {
  const first = firstBillMonth(r);
  if (mk < first) return 0;
  const [y1, m1] = first.split('-').map(Number);
  const [y2, m2] = mk.split('-').map(Number);
  const index = (y2 - y1) * 12 + (m2 - m1) + 1;
  return r.installments && index > r.installments ? 0 : index;
}

export function goalInfo(g) {
  const remaining = Math.max(0, g.target - (g.saved || 0));
  let perMonth = null;
  let monthsLeft = null;
  if (g.deadline && remaining > 0) {
    const now = new Date();
    const [y, m] = g.deadline.split('-').map(Number);
    monthsLeft = Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + 1);
    perMonth = remaining / monthsLeft;
  }
  return { remaining, perMonth, monthsLeft, pct: g.target ? Math.min(1, (g.saved || 0) / g.target) : 0 };
}
