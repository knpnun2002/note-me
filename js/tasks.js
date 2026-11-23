// งานแบบ Todoist: โปรเจกต์ หมวด ความสำคัญ งานย่อย งานทำซ้ำ ป้ายกำกับ และประวัติงานที่เสร็จ
//
// task: { title, note, date?, time?, projectId?, sectionId?, parentId?, priority 1–4,
//         labels: [], recur?, order, done, doneAt, createdAt }
// recur: { kind: 'daily'|'weekly'|'monthly'|'yearly', interval?, days?: [0..6], day? }
// taskLog: บันทึกทุกครั้งที่ทำเสร็จ (งานทำซ้ำเสร็จได้หลายครั้ง) ใช้กับประวัติและสถิติ

import * as store from './store.js';
import { today, addDays, weekday, weekStart, parseKey, pad, daysInMonth, monthOf, addMonths, dayDiff, fmtDate, TH_DAYS, TH_DAYS_SHORT } from './utils.js';

export const PRIORITIES = {
  1: { name: 'P1', label: 'ด่วนมาก', color: '#e5484d' },
  2: { name: 'P2', label: 'สำคัญ', color: '#f08c00' },
  3: { name: 'P3', label: 'ปานกลาง', color: '#3b82f6' },
  4: { name: 'P4', label: 'ปกติ', color: '#9aa1ab' },
};
export const prio = (t) => t.priority || 4;

// ---------- ค้นหา ----------

const isOpen = (t) => !t.done && !t.parentId;
const orderOf = (t) => t.order ?? t.createdAt ?? 0;

// งานที่มีเวลาขึ้นก่อนตามเวลา ที่เหลือตามลำดับที่ลากจัดไว้
export const byTimeThenOrder = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || orderOf(a) - orderOf(b);
export const byOrder = (a, b) => orderOf(a) - orderOf(b);

const query = (filter, sort = byTimeThenOrder) => store.all('tasks').filter(filter).sort(sort);

export const tasksOn = (date) => query((t) => isOpen(t) && t.date === date);
export const overdueTasks = () =>
  query((t) => isOpen(t) && t.date && t.date < today(), (a, b) => a.date.localeCompare(b.date) || byTimeThenOrder(a, b));
export const inboxTasks = () => query((t) => isOpen(t) && !t.projectId, byOrder);
export const projectTasks = (pid, sectionId = null) =>
  query((t) => isOpen(t) && t.projectId === pid && (t.sectionId || null) === sectionId, byOrder);
export const labelTasks = (label) => query((t) => isOpen(t) && (t.labels || []).includes(label), byOrder);
export const subtasks = (id) => store.all('tasks').filter((t) => t.parentId === id).sort(byOrder);
export const doneTasksOn = (date) => store.all('taskLog').filter((l) => l.date === date).sort((a, b) => a.at - b.at);

export function projects() {
  return store.all('projects').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export const project = (id) => (id ? store.get('projects', id) : null);
export const sections = (pid) => store.all('sections').filter((s) => s.projectId === pid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const openCount = (pid) => store.all('tasks').filter((t) => isOpen(t) && t.projectId === pid).length;

// ป้ายกำกับทั้งหมด พร้อมจำนวนงานที่ยังไม่เสร็จ
export function allLabels() {
  const counts = new Map();
  for (const t of store.all('tasks')) {
    if (t.done) continue;
    for (const l of t.labels || []) counts.set(l, (counts.get(l) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
}

// ลำดับถัดไปสำหรับงานใหม่ (ต่อท้ายรายการ)
export const nextOrder = () => Date.now();

// ลำดับระหว่างสองงาน ใช้ตอนลากจัดเรียง
export function orderBetween(prev, next) {
  if (prev && next) return (orderOf(prev) + orderOf(next)) / 2;
  if (prev) return orderOf(prev) + 1000;
  if (next) return orderOf(next) - 1000;
  return nextOrder();
}

// ---------- ทำเสร็จ / งานทำซ้ำ ----------

// งานทำซ้ำ: ทำเสร็จแล้วเลื่อนไปครั้งถัดไป (หลังวันนี้หรือวันกำหนดเดิม แล้วแต่อันไหนช้ากว่า)
// และรีเซ็ตงานย่อยให้เริ่มใหม่
export function complete(t) {
  const d = today();
  store.batch(() => {
    store.put('taskLog', {
      id: `${t.id}|${t.recur && t.date ? t.date : 'done'}`,
      taskId: t.id,
      title: t.title,
      projectId: t.projectId || null,
      date: d,
      at: Date.now(),
    });
    if (t.recur && t.date) {
      store.patch('tasks', t.id, { date: nextOccurrence(t.recur, t.date > d ? t.date : d, t.date) });
      for (const s of subtasks(t.id)) if (s.done) store.patch('tasks', s.id, { done: false, doneAt: null });
    } else {
      store.patch('tasks', t.id, { done: true, doneAt: Date.now() });
    }
  });
}

export function uncomplete(t) {
  store.batch(() => {
    store.remove('taskLog', `${t.id}|done`);
    store.patch('tasks', t.id, { done: false, doneAt: null });
  });
}

export function removeTask(t) {
  store.batch(() => {
    for (const s of subtasks(t.id)) store.remove('tasks', s.id);
    store.remove('tasks', t.id);
  });
}

const monthsBetween = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

// วันถัดไปที่ตรงรูปแบบ หลังวันที่ after (anchor = วันตั้งต้นของรอบ ใช้นับ "ทุก N วัน/สัปดาห์/เดือน")
export function nextOccurrence(r, after, anchor = after) {
  const n = Math.max(1, r.interval || 1);
  if (r.kind === 'daily') {
    let d = anchor;
    while (d <= after) d = addDays(d, n);
    return d;
  }
  if (r.kind === 'weekly') {
    const days = r.days?.length ? r.days : [weekday(anchor)];
    const base = weekStart(anchor);
    for (let d = addDays(after, 1), i = 0; i < 7 * n + 7; d = addDays(d, 1), i++) {
      const weeks = Math.round(dayDiff(base, weekStart(d)) / 7);
      if (weeks % n === 0 && days.includes(weekday(d))) return d;
    }
    return addDays(after, 7);
  }
  if (r.kind === 'monthly') {
    const day = r.day || parseKey(anchor).getDate();
    for (let mk = monthOf(after), i = 0; i < 400; mk = addMonths(mk, 1), i++) {
      if (monthsBetween(monthOf(anchor), mk) % n) continue;
      const d = `${mk}-${pad(Math.min(day, daysInMonth(mk)))}`;
      if (d > after) return d;
    }
  }
  // yearly
  const [, m, dd] = anchor.split('-');
  for (let y = Number(after.slice(0, 4)); ; y++) {
    const d = `${y}-${m}-${pad(Math.min(Number(dd), daysInMonth(`${y}-${m}`)))}`;
    if (d > after) return d;
  }
}

// ครั้งแรกตั้งแต่วันที่ from (รวมวันนั้นด้วย)
export const firstOccurrence = (r, from) => nextOccurrence(r, addDays(from, -1), from);

export function recurLabel(r) {
  if (!r) return '';
  const n = Math.max(1, r.interval || 1);
  if (r.kind === 'daily') return n === 1 ? 'ทุกวัน' : `ทุก ${n} วัน`;
  if (r.kind === 'monthly') return `${n === 1 ? 'ทุกเดือน' : `ทุก ${n} เดือน`}${r.day ? ` วันที่ ${r.day}` : ''}`;
  if (r.kind === 'yearly') return 'ทุกปี';
  const days = [...(r.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const prefix = n === 1 ? 'ทุก' : `ทุก ${n} สัปดาห์ `;
  if (!days.length) return n === 1 ? 'ทุกสัปดาห์' : `ทุก ${n} สัปดาห์`;
  if (days.length === 7) return n === 1 ? 'ทุกวัน' : prefix.trim();
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return `${prefix}วันทำงาน`;
  if (days.length === 1) return `${prefix}วัน${TH_DAYS[days[0]]}`;
  return `${prefix.trim()} ${days.map((d) => TH_DAYS_SHORT[d]).join(', ')}`;
}

// ---------- แสดงวันกำหนด แบบ Todoist ----------
// สี: เลยกำหนด = แดง, วันนี้ = เขียว, พรุ่งนี้ = ส้ม, ภายในสัปดาห์ = ม่วง, ไกลกว่านั้น = เทา

export function dueInfo(date, time) {
  if (!date) return null;
  const diff = dayDiff(today(), date);
  let label;
  let cls;
  if (diff < 0) [label, cls] = [diff === -1 ? 'เมื่อวาน' : fmtDate(date), 'overdue'];
  else if (diff === 0) [label, cls] = ['วันนี้', 'today'];
  else if (diff === 1) [label, cls] = ['พรุ่งนี้', 'tomorrow'];
  else if (diff < 7) [label, cls] = [TH_DAYS[weekday(date)], 'week'];
  else [label, cls] = [fmtDate(date), 'later'];
  return { label: time ? `${label} ${time}` : label, cls };
}

// ---------- ความคืบหน้า ----------

export function goals() {
  const s = store.settings();
  return { daily: s.dailyGoal ?? 5, weekly: s.weeklyGoal ?? 25 };
}

export function completedCounts() {
  const counts = new Map();
  for (const l of store.all('taskLog')) counts.set(l.date, (counts.get(l.date) || 0) + 1);
  return counts;
}

// ทำถึงเป้ารายวันติดกันกี่วัน (ถ้าวันนี้ยังไม่ถึง นับถึงเมื่อวาน)
export function goalStreak() {
  const goal = goals().daily;
  const counts = completedCounts();
  let d = today();
  if ((counts.get(d) || 0) < goal) d = addDays(d, -1);
  let n = 0;
  while ((counts.get(d) || 0) >= goal) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function weekDone(anyDate = today()) {
  const counts = completedCounts();
  const ws = weekStart(anyDate);
  let n = 0;
  for (let i = 0; i < 7; i++) n += counts.get(addDays(ws, i)) || 0;
  return n;
}
