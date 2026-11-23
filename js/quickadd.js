// แยกวันที่ เวลา การทำซ้ำ ความสำคัญ โปรเจกต์ และป้ายกำกับ ออกจากข้อความที่พิมพ์ (แบบ Todoist Quick Add)
// เช่น "ส่งรายงาน พรุ่งนี้ บ่าย 2 #งาน p1 @ด่วน"
// ignore: ข้อความที่ผู้ใช้กดยกเลิกการแปล (จะคงไว้ในชื่องาน)

import { today, addDays, weekday, weekStart, pad, daysInMonth, monthOf, addMonths, TH_MONTHS, TH_MONTHS_SHORT } from './utils.js';
import { firstOccurrence } from './tasks.js';

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const DAY = 'อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์';
const dayIdx = (name) => (name.startsWith('พฤหัส') ? 4 : DAYS.indexOf(name));

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ชื่อเดือนรับได้หลายแบบ: พฤศจิกายน, พ.ย., พ.ย, พย
const MONTH_FORMS = TH_MONTHS.map((full, i) => {
  const short = TH_MONTHS_SHORT[i];
  return [full, short, short.replace(/\.$/, ''), short.replace(/\./g, '')];
});
const MONTH = MONTH_FORMS.flat().sort((a, b) => b.length - a.length).map(reEsc).join('|');
const monthIdx = (s) => MONTH_FORMS.findIndex((forms) => forms.includes(s));

const RE = (src) => new RegExp(src, 'g');

function toYear(y) {
  if (!y) return null;
  const n = Number(y);
  if (n < 100) return 2500 + n - 543; // พ.ศ. 2 หลัก เช่น 69
  return n >= 2400 ? n - 543 : n;
}

function makeDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return null;
  const mk = `${y}-${pad(m)}`;
  return d > daysInMonth(mk) ? null : `${mk}-${pad(d)}`;
}

export function parseQuickAdd(input, { ignore = [] } = {}) {
  const t = today();
  const out = { date: null, time: null, recur: null, priority: null, project: null, labels: [], noDate: false };
  const raws = { date: [], time: [], recur: [], priority: [], project: [], labels: [] };
  let text = ` ${input} `;

  // แทนที่ข้อความที่แปลได้ด้วยช่องว่าง (fn คืน false = ไม่ใช่ ให้คงไว้)
  const take = (kind, re, fn) => {
    text = text.replace(re, (...args) => {
      const m = args[0];
      if (ignore.includes(m.trim())) return m;
      if (fn(...args) === false) return m;
      raws[kind].push(m.trim());
      return ' ';
    });
  };
  const setTime = (h, m = 0) => {
    h = Number(h);
    m = Number(m);
    if (h > 23 || m > 59) return false;
    out.time = `${pad(h)}:${pad(m)}`;
  };
  const setDate = (d) => {
    if (!d) return false;
    out.date = d;
  };

  // ---- คำที่ระบุชัด: ความสำคัญ โปรเจกต์ ป้าย (ทำก่อน จะได้ไม่ไปแปลชื่อโปรเจกต์เป็นวันที่) ----
  take('priority', /(^|\s)[pP!]([1-4])(?=\s|$)/g, (m, pre, n) => (out.priority = Number(n)));
  take('project', /(^|\s)#([^\s#@]+)/g, (m, pre, name) => (out.project = name));
  take('labels', /(^|\s)@([^\s#@]+)/g, (m, pre, name) => void (out.labels.includes(name) || out.labels.push(name)));

  // ---- ทำซ้ำ ----
  take('recur', /ทุก\s*วันทำงาน/g, () => (out.recur = { kind: 'weekly', days: [1, 2, 3, 4, 5] }));
  take('recur', RE(`ทุก\\s*(?:วัน)?(${DAY})\\s*(?:-|–|ถึง)\\s*(?:วัน)?(${DAY})`), (m, a, b) => {
    const days = [];
    for (let d = dayIdx(a), i = 0; i < 7; d = (d + 1) % 7, i++) {
      days.push(d);
      if (d === dayIdx(b)) break;
    }
    out.recur = { kind: 'weekly', days };
  });
  take('recur', /ทุก\s*(\d+)\s*(วัน|สัปดาห์|อาทิตย์|เดือน|ปี)/g, (m, n, unit) => {
    const kind = { วัน: 'daily', สัปดาห์: 'weekly', อาทิตย์: 'weekly', เดือน: 'monthly', ปี: 'yearly' }[unit];
    out.recur = { kind, interval: Math.max(1, Number(n)) };
  });
  take('recur', /ทุก\s*วันที่\s*(\d{1,2})/g, (m, d) => {
    if (Number(d) < 1 || Number(d) > 31) return false;
    out.recur = { kind: 'monthly', day: Number(d) };
  });
  // "ทุกอาทิตย์" ภาษาพูดหมายถึงทุกสัปดาห์ ส่วน "ทุกวันอาทิตย์" คือวันอาทิตย์
  take('recur', /ทุก\s*(?:สัปดาห์|อาทิตย์)(?!\s*(?:,|และ|กับ))/g, () => (out.recur = { kind: 'weekly' }));
  take('recur', RE(`ทุก\\s*((?:วัน)?(?:${DAY})(?:\\s*(?:,|และ|กับ)?\\s*(?:วัน)?(?:${DAY}))*)`), (m, list) => {
    const days = [...new Set([...list.matchAll(RE(DAY))].map((x) => dayIdx(x[0])))];
    out.recur = { kind: 'weekly', days };
  });
  take('recur', /ทุก\s*วัน(?!ที่)/g, () => (out.recur = { kind: 'daily' }));
  take('recur', /ทุก\s*เดือน/g, () => (out.recur = { kind: 'monthly' }));
  take('recur', /ทุก\s*ปี/g, () => (out.recur = { kind: 'yearly' }));

  // ---- เวลา ----
  take('time', /(?:เวลา\s*)?(\d{1,2}):(\d{2})\s*(?:น\.?)?/g, (m, h, mm) => setTime(h, mm));
  take('time', /เวลา\s*(\d{1,2})\.(\d{2})\s*(?:น\.?)?/g, (m, h, mm) => setTime(h, mm));
  take('time', /(\d{1,2})\.(\d{2})\s*น\.?/g, (m, h, mm) => setTime(h, mm));
  take('time', /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, (m, h, mm, ap) => {
    h = Number(h) % 12;
    return setTime(ap.toLowerCase() === 'pm' ? h + 12 : h, mm || 0);
  });
  take('time', /เที่ยงคืน/g, () => setTime(0));
  take('time', /บ่าย\s*(?:(\d{1,2})\s*(?:โมง)?|โมง)(\s*ครึ่ง)?/g, (m, h, half) => setTime(h ? 12 + Number(h) : 13, half ? 30 : 0));
  // "6 โมงเช้า" = 6:00, "5 โมงเย็น" = 17:00, "4 โมง" (1–5 ไม่ระบุ) = บ่าย
  take('time', /(\d{1,2})\s*โมง\s*(เช้า|เย็น)?(\s*ครึ่ง)?/g, (m, h, q, half) => {
    h = Number(h);
    if (q === 'เย็น' || (!q && h >= 1 && h <= 5)) h += 12;
    return setTime(h, half ? 30 : 0);
  });
  take('time', /(\d)\s*ทุ่ม(\s*ครึ่ง)?/g, (m, h, half) => setTime(Number(h) === 6 ? 0 : 18 + Number(h), half ? 30 : 0));
  take('time', /ตี\s*(\d)(\s*ครึ่ง)?/g, (m, h, half) => setTime(h, half ? 30 : 0));
  take('time', /เที่ยง(?:ตรง|วัน)?/g, () => setTime(12));

  // ---- วันที่ ----
  take('date', /วันนี้|คืนนี้|เช้านี้/g, () => setDate(t));
  take('date', /พรุ่งนี้/g, () => setDate(addDays(t, 1)));
  take('date', /มะรืน(?:นี้)?/g, () => setDate(addDays(t, 2)));
  take('date', /เมื่อวาน(?:ซืน)?/g, (m) => setDate(addDays(t, m.endsWith('ซืน') ? -2 : -1)));
  take('date', RE(`วัน(${DAY})\\s*หน้า`), (m, d) => setDate(addDays(weekStart(t), 7 + ((dayIdx(d) + 6) % 7))));
  // "อาทิตย์หน้า" ภาษาพูด = สัปดาห์หน้า (วันจันทร์)
  take('date', /(?:อาทิตย์|สัปดาห์)\s*หน้า/g, () => setDate(addDays(weekStart(t), 7)));
  take('date', /สุดสัปดาห์(?:นี้)?|เสาร์\s*อาทิตย์(?:นี้)?/g, () => {
    const wd = weekday(t);
    return setDate(wd === 6 || wd === 0 ? t : addDays(t, 6 - wd));
  });
  take('date', /เดือน\s*หน้า/g, () => setDate(`${addMonths(monthOf(t), 1)}-01`));
  take('date', /อีก\s*(\d+)\s*(วัน|สัปดาห์|อาทิตย์|เดือน)/g, (m, n, unit) => {
    n = Number(n);
    if (unit === 'เดือน') {
      const mk = addMonths(monthOf(t), n);
      return setDate(`${mk}-${pad(Math.min(Number(t.slice(8)), daysInMonth(mk)))}`);
    }
    return setDate(addDays(t, unit === 'วัน' ? n : n * 7));
  });
  take('date', /ไม่มี\s*(?:วันที่|กำหนด|วัน)/g, () => (out.noDate = true));
  take('date', RE(`(\\d{1,2})\\s*(${MONTH})\\s*(\\d{4}|\\d{2}(?!\\d))?`), (m, d, mon, y) => {
    let date = makeDate(toYear(y) || Number(t.slice(0, 4)), monthIdx(mon) + 1, Number(d));
    if (date && !y && date < t) date = makeDate(Number(t.slice(0, 4)) + 1, monthIdx(mon) + 1, Number(d));
    return setDate(date);
  });
  take('date', /(^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/g, (m, pre, d, mo, y) => {
    let date = makeDate(toYear(y) || Number(t.slice(0, 4)), Number(mo), Number(d));
    if (date && !y && date < t) date = makeDate(Number(t.slice(0, 4)) + 1, Number(mo), Number(d));
    return setDate(date);
  });
  take('date', /วันที่\s*(\d{1,2})/g, (m, d) => {
    let mk = monthOf(t);
    let date = makeDate(...mk.split('-').map(Number), Number(d));
    if (date && date < t) {
      mk = addMonths(mk, 1);
      date = makeDate(...mk.split('-').map(Number), Number(d));
    }
    return setDate(date);
  });
  // ชื่อวัน: วันที่ใกล้ที่สุดตั้งแต่วันนี้ (ต้องมี "วัน" นำหน้า หรือเป็นคำแยก เพื่อไม่ไปจับ "ดวงจันทร์")
  take('date', RE(`(^|\\s|วัน)(${DAY})(?:\\s*นี้)?`), (m, pre, d) => setDate(addDays(t, (dayIdx(d) - weekday(t) + 7) % 7)));

  // ---- สรุป ----
  if (out.noDate) {
    out.date = null;
    out.time = null;
  }
  if (out.time && !out.date && !out.recur && !out.noDate) out.date = t;
  if (out.recur) {
    if (out.recur.kind === 'weekly' && !out.recur.days?.length) out.recur.days = [weekday(out.date || t)];
    if (out.recur.kind === 'monthly' && !out.recur.day) out.recur.day = Number((out.date || t).slice(8));
    if (!out.date) out.date = firstOccurrence(out.recur, t);
  }

  return { ...out, title: text.replace(/\s+/g, ' ').trim(), raws };
}
