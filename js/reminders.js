// เตือนกิจวัตรและงานผ่านปฏิทิน: เว็บแอปบน iPhone ตั้งเวลาแจ้งเตือนเองไม่ได้ (ต้องมีเซิร์ฟเวอร์)
// จึงสร้างนัดหมายพร้อมเสียงเตือนเป็นไฟล์ .ics ให้เพิ่มลงปฏิทินแทน

import * as store from './store.js';
import { today, addDays, pad, weekday } from './utils.js';
import { isDue, habitStart, habitIcon, activeHabits } from './logic.js';
import { project, firstOccurrence } from './tasks.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// วันแรกที่ต้องทำ นับจากวันนี้หรือวันเริ่ม
function firstDate(h) {
  let d = habitStart(h) > today() ? habitStart(h) : today();
  for (let i = 0; i < 7 && !isDue(h, d); i++) d = addDays(d, 1);
  return d;
}

function rrule(h) {
  let rule = h.freq.kind === 'weekdays' ? `FREQ=WEEKLY;BYDAY=${h.freq.days.map((d) => BYDAY[d]).join(',')}` : 'FREQ=DAILY';
  if (h.endDate) rule += `;UNTIL=${h.endDate.replace(/-/g, '')}T235959`;
  return rule;
}

// 'YYYY-MM-DD' + 'HH:MM' + นาที -> 'YYYYMMDDTHHMMSS' (เวลาท้องถิ่น)
function stamp(date, time, addMin = 0) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const t = new Date(y, m - 1, d, hh, mm + addMin);
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}T${pad(t.getHours())}${pad(t.getMinutes())}00`;
}

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// ตัดบรรทัดยาวเกิน 75 ไบต์ตามมาตรฐาน iCalendar (ภาษาไทย 1 ตัว = 3 ไบต์)
function fold(line) {
  const enc = new TextEncoder();
  let out = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 73) {
      out += '\r\n ';
      bytes = 1;
    }
    out += ch;
    bytes += n;
  }
  return out;
}

function title(h) {
  return `${habitIcon(h)} ${h.name}`;
}

function details(h) {
  return [h.desc, `เปิด Note Me: ${appUrl()}`].filter(Boolean).join('\n');
}

const appUrl = (page = 'habits') => `${location.origin}${location.pathname.replace(/index\.html$/, '')}#/${page}`;
const dtstamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const alarm = (text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(text)}`, 'TRIGGER:PT0M', 'END:VALARM'];

function habitEvent(h, time) {
  const start = firstDate(h);
  return [
    'BEGIN:VEVENT',
    `UID:noteme-habit-${h.id}@noteme`,
    `DTSTAMP:${dtstamp()}`,
    `DTSTART:${stamp(start, time)}`,
    `DTEND:${stamp(start, time, 10)}`,
    `RRULE:${rrule(h)}`,
    `SUMMARY:${icsText(title(h))}`,
    `DESCRIPTION:${icsText(details(h))}`,
    `URL:${appUrl()}`,
    ...alarm(title(h)),
    'END:VEVENT',
  ];
}

function taskRrule(t) {
  const r = t.recur;
  const n = Math.max(1, r.interval || 1);
  const iv = n > 1 ? `;INTERVAL=${n}` : '';
  if (r.kind === 'daily') return `FREQ=DAILY${iv}`;
  if (r.kind === 'weekly') return `FREQ=WEEKLY${iv};BYDAY=${(r.days?.length ? r.days : [weekday(t.date)]).map((d) => BYDAY[d]).join(',')}`;
  if (r.kind === 'monthly') return `FREQ=MONTHLY${iv}${r.day ? `;BYMONTHDAY=${r.day}` : ''}`;
  return `FREQ=YEARLY${iv}`;
}

// งานที่มีเวลา = นัดพร้อมเสียงเตือน, งานที่ไม่มีเวลา = นัดทั้งวัน (ไม่มีเสียง)
function taskEvent(t) {
  const ymd = (d) => d.replace(/-/g, '');
  const p = project(t.projectId);
  // วันเริ่มต้องตรงรูปแบบทำซ้ำ ไม่อย่างนั้นปฏิทินจะนับวันเริ่มเป็นนัดพิเศษอีกหนึ่งครั้ง
  const date = t.recur ? firstOccurrence(t.recur, t.date) : t.date;
  const when = t.time
    ? [`DTSTART:${stamp(date, t.time)}`, `DTEND:${stamp(date, t.time, 30)}`]
    : [`DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`];
  return [
    'BEGIN:VEVENT',
    `UID:noteme-task-${t.id}@noteme`,
    `DTSTAMP:${dtstamp()}`,
    ...when,
    ...(t.recur ? [`RRULE:${taskRrule(t)}`] : []),
    `SUMMARY:${icsText(t.title)}`,
    `DESCRIPTION:${icsText([t.note, p ? `โปรเจกต์: ${p.name}` : '', `เปิด Note Me: ${appUrl('plan')}`].filter(Boolean).join('\n'))}`,
    ...(t.time ? alarm(t.title) : []),
    'END:VEVENT',
  ];
}

function calendar(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Note Me//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Note Me', ...events.flat(), 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const icsFor = (h, time) => calendar([habitEvent(h, time)]);

function download(text, name) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function downloadIcs(h, time) {
  download(icsFor(h, time), `noteme-${h.name.replace(/[\\/:*?"<>|]/g, '').slice(0, 30) || 'habit'}.ics`);
}

// ---------- ส่งออกทั้งหมดจากหน้าตั้งค่า ----------
// งาน: ยังไม่เสร็จ มีวันที่ ตั้งแต่วันนี้ไป (งานทำซ้ำรวมเสมอ), กิจวัตร: ที่ตั้งเวลาเตือนไว้

export function calendarItems({ tasks = true, allDay = false, habits = true } = {}) {
  const t = today();
  return {
    tasks: tasks
      ? store.all('tasks').filter((x) => !x.done && x.date && (x.date >= t || x.recur) && (x.time || allDay))
      : [],
    habits: habits ? activeHabits().filter((h) => h.reminder && (!h.endDate || h.endDate >= t)) : [],
  };
}

export function downloadCalendar(opts) {
  const items = calendarItems(opts);
  download(calendar([...items.tasks.map(taskEvent), ...items.habits.map((h) => habitEvent(h, h.reminder))]), `noteme-calendar-${today()}.ics`);
  return items.tasks.length + items.habits.length;
}

export function googleCalendarUrl(h, time) {
  const start = firstDate(h);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title(h),
    dates: `${stamp(start, time)}/${stamp(start, time, 10)}`,
    details: details(h),
    recur: `RRULE:${rrule(h)}`,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
