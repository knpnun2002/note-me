import * as store from '../store.js';
import * as L from '../logic.js';
import { esc, today, addDays, weekStart, parseKey, TH_DAYS, TH_DAYS_SHORT, TH_MONTHS_SHORT, fmtDate, fmtDateLong, fmtDateTime, relDay, monthOf, addMonths, daysInMonth, fmtMonth, weekday, pad, debounce, COLORS } from '../utils.js';
import { icon, openSheet, confirmBox, toast, progress, colorPicker, emptyState, ring } from '../ui.js';
import { TEMPLATE_GROUPS, templateHabit, ICONS } from '../habit-templates.js';
import { downloadIcs, googleCalendarUrl, isIOS } from '../reminders.js';

let tab = 'today';
let selected = today();
let calMonth = monthOf(today());
let journalMonth = monthOf(today());
let gridMode = 'week'; // แท็บสถิติ: 'week' | 'month'
let gridDate = today(); // วันใดก็ได้ในสัปดาห์/เดือนที่กำลังดู

const TABS = { today: 'วันนี้', stats: 'สถิติ', calendar: 'ปฏิทิน', journal: 'บันทึก' };
const CAL_DOW = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
export const MOODS = ['😣', '😕', '😐', '🙂', '😄'];

const pctText = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);

function weekRange(ws) {
  const a = parseKey(ws);
  const b = parseKey(addDays(ws, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${TH_MONTHS_SHORT[a.getMonth()]}`
    : `${a.getDate()} ${TH_MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${TH_MONTHS_SHORT[b.getMonth()]}`;
}

export function render(root) {
  if (selected > today()) selected = today();
  flushNote();
  root.innerHTML = `
    <header class="page-head"><h1>กิจวัตร</h1></header>
    <nav class="tabs" role="tablist">
      ${Object.entries(TABS).map(([k, v]) => `<button role="tab" class="${k === tab ? 'sel' : ''}" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join('')}
    </nav>
    ${{ today: todayTab, stats: statsTab, calendar: calendarTab, journal: journalTab }[tab]()}
    <div class="fab-space"></div>
    <button class="fab" data-act="add" aria-label="เพิ่มกิจวัตร">${icon('plus', 26)}</button>
  `;

  root.onclick = (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      return render(root);
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const h = store.get('habits', el.closest('[data-id]')?.dataset.id);
    if (h && habitAction(el.dataset.act, h, selected)) return;
    switch (el.dataset.act) {
      case 'add':
        return chooseTemplate();
      case 'day':
        selected = el.dataset.date;
        return render(root);
      case 'week':
        selected = addDays(selected, Number(el.dataset.d));
        return render(root);
      case 'cal-month':
        calMonth = el.dataset.d === '0' ? monthOf(today()) : addMonths(calMonth, Number(el.dataset.d));
        return render(root);
      case 'goto':
        selected = el.dataset.date;
        tab = 'today';
        render(root);
        return scrollTo(0, 0);
      case 'cell':
        return habitAction('toggle', h, el.dataset.date);
      case 'grid-mode':
        if (el.value === gridMode) return;
        gridMode = el.value;
        return render(root);
      case 'grid-nav': {
        const d = Number(el.dataset.d);
        gridDate = !d ? today() : gridMode === 'week' ? addDays(gridDate, d * 7) : `${addMonths(monthOf(gridDate), d)}-01`;
        return render(root);
      }
      case 'journal-month':
        journalMonth = el.dataset.d === '0' ? monthOf(today()) : addMonths(journalMonth, Number(el.dataset.d));
        return render(root);
      case 'open-note': {
        // ไปที่บันทึกของวันนั้นในแท็บวันนี้ พร้อมพิมพ์ต่อได้เลย
        selected = el.dataset.date;
        tab = 'today';
        render(root);
        const input = root.querySelector('[data-note]');
        input.scrollIntoView({ block: 'center' });
        return input.focus({ preventScroll: true });
      }
      case 'save-note':
        flushNote();
        setNoteStatus('บันทึกแล้ว ✓');
        return root.querySelector('[data-note]')?.blur();
      case 'mood': {
        flushNote();
        const note = store.get('notes', selected);
        const mood = Number(el.dataset.mood);
        return saveNote(selected, { mood: note?.mood === mood ? 0 : mood });
      }
    }
  };

  // บันทึกระหว่างพิมพ์ โดยไม่วาดหน้าจอใหม่ (ไม่ให้เคอร์เซอร์หลุด)
  const noteInput = root.querySelector('[data-note]');
  if (noteInput) {
    noteInput.oninput = () => {
      noteDraft = { date: noteInput.dataset.date, text: noteInput.value };
      setNoteStatus('กำลังบันทึก…');
      saveNoteSoon();
    };
    noteInput.onchange = flushNote;
  }
}

// ---------- บันทึกประจำวัน ----------
// เก็บข้อความที่กำลังพิมพ์ไว้ แล้วบันทึกเมื่อหยุดพิมพ์ แตะออก กดปุ่มบันทึก หรือสลับไปแอปอื่น

let noteDraft = null;

function flushNote() {
  if (!noteDraft) return;
  const { date, text } = noteDraft;
  noteDraft = null;
  saveNote(date, { text: text.trim() }, { silent: true });
  setNoteStatus(`บันทึกแล้ว ✓`);
}

const saveNoteSoon = debounce(flushNote, 800);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNote());
addEventListener('pagehide', flushNote);

function setNoteStatus(text) {
  const el = document.querySelector('[data-note-status]');
  if (el) el.textContent = text;
}

// การกดในแถวกิจวัตร ใช้ร่วมกับหน้าหลัก คืน true ถ้าจัดการแล้ว
export function habitAction(act, h, date, value) {
  const celebrate = (fn) => {
    const before = L.dayProgress(date).allDone;
    fn();
    if (!before && L.dayProgress(date).allDone) toast('ทำครบทุกกิจวัตรแล้ว 🎉');
  };
  if (act === 'toggle') celebrate(() => L.toggle(h, date));
  else if (act === 'set') celebrate(() => L.setLog(h, date, value));
  else if (act === 'inc') celebrate(() => L.setLog(h, date, L.logValue(h, date) + 1));
  else if (act === 'dec') L.setLog(h, date, L.logValue(h, date) - 1);
  else if (act === 'detail') habitDetail(h);
  else if (act === 'menu') habitMenu(h);
  else return false;
  return true;
}

// ช่องพิมพ์จำนวนของกิจวัตรแบบนับ (ใช้ทั้งหน้ากิจวัตรและหน้าหลัก)
// แตะแล้วเลือกตัวเลขเดิมทั้งหมด พิมพ์ทับได้เลย บันทึกเมื่อพิมพ์เสร็จ
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('[data-count]')) e.target.select();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-count]')) e.target.blur();
});
document.addEventListener('change', (e) => {
  const input = e.target.closest?.('[data-count]');
  const h = input && store.get('habits', input.closest('[data-id]')?.dataset.id);
  if (!h) return;
  const value = Math.min(9999, Math.max(0, parseInt(input.value, 10) || 0));
  if (value === L.logValue(h, input.dataset.date)) input.value = value;
  else habitAction('set', h, input.dataset.date, value);
});

function saveNote(date, fields, opts) {
  const cur = store.get('notes', date) || { id: date, date, text: '', mood: 0 };
  const next = { ...cur, ...fields };
  if (!next.text && !next.mood) store.remove('notes', date, opts);
  else store.put('notes', next, opts);
}

// ---------- แท็บวันนี้ ----------

function todayTab() {
  const t = today();
  const ws = weekStart(selected);
  const p = L.dayProgress(selected);
  const others = L.activeHabits().filter((h) => !p.list.includes(h) && L.isActiveOn(h, selected));
  const note = store.get('notes', selected);

  return `
    <div class="week-strip">
      <button class="icon-btn" data-act="week" data-d="-7" aria-label="สัปดาห์ก่อน">${icon('left')}</button>
      ${Array.from({ length: 7 }, (_, i) => {
        const d = addDays(ws, i);
        const dp = d <= t ? L.dayProgress(d) : null;
        const ratio = dp?.total ? dp.done / dp.total : 0;
        return `<button class="day-pill ${d === selected ? 'sel' : ''} ${d === t ? 'today' : ''}" data-act="day" data-date="${d}" ${d > t ? 'disabled' : ''}>
          <span class="dow">${TH_DAYS_SHORT[weekday(d)]}</span>
          <span class="num">${parseKey(d).getDate()}</span>
          <span class="dot ${dp?.allDone ? 'full' : ''}" style="opacity:${!dp?.total ? 0 : 0.25 + ratio * 0.75}"></span>
        </button>`;
      }).join('')}
      <button class="icon-btn" data-act="week" data-d="7" aria-label="สัปดาห์ถัดไป" ${addDays(ws, 7) > t ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    <div class="day-title">
      <span>${selected === t ? 'วันนี้' : esc(fmtDateLong(selected))}</span>
      ${p.allDone ? '<span class="all-done">ทำครบแล้ว 🎉</span>' : p.total ? `<span class="muted">${p.done}/${p.total}</span>` : ''}
    </div>
    ${p.total ? progress(p.done / p.total) : ''}

    <div class="list card">
      ${p.list.length ? p.list.map((h) => habitRow(h, selected)).join('') : emptyState(L.activeHabits().length ? 'ไม่มีกิจวัตรสำหรับวันนี้' : 'ยังไม่มีกิจวัตร กดปุ่ม + เพื่อเริ่มเลย')}
    </div>

    ${others.length ? `<h3 class="section-label">ไม่มีกำหนดวันนี้</h3><div class="list card faded">${others.map((h) => habitRow(h, selected)).join('')}</div>` : ''}

    <h3 class="section-label">บันทึกประจำวัน</h3>
    <div class="card pad">
      <div class="moods" role="group" aria-label="อารมณ์วันนี้">
        ${MOODS.map((m, i) => `<button class="mood ${note?.mood === i + 1 ? 'sel' : ''}" data-act="mood" data-mood="${i + 1}">${m}</button>`).join('')}
      </div>
      <textarea class="note-input" rows="3" placeholder="วันนี้เป็นอย่างไรบ้าง…" data-note data-date="${selected}">${esc(note?.text || '')}</textarea>
      <div class="note-foot">
        <span class="muted small" data-note-status>${note ? `บันทึกแล้ว ✓ ${fmtDateTime(note.updatedAt).split(' ').pop()}` : 'บันทึกอัตโนมัติขณะพิมพ์'}</span>
        <button class="btn btn-sm" data-act="save-note">บันทึก</button>
      </div>
    </div>
  `;
}

export function habitRow(h, date) {
  const done = L.isDone(h, date);
  const streak = L.currentStreak(h);
  // ข้อความสั้นที่สุดเท่าที่ยังเข้าใจ เพราะแถวบนมือถือแคบ
  const meta = [];
  if (h.freq.kind === 'weekdays') meta.push(L.freqLabel(h));
  if (h.freq.kind === 'perWeek') meta.push(`สัปดาห์นี้ ${L.weekDoneCount(h, date)}/${h.freq.times}`);
  if (streak) meta.push(`🔥 ${streak}`);
  if (h.reminder) meta.push(`⏰ ${h.reminder}`);

  const value = L.logValue(h, date);
  const control =
    h.type === 'count'
      ? `<div class="counter ${done ? 'done' : ''}">
          <button class="icon-btn sm" data-act="dec" aria-label="ลด" ${value ? '' : 'disabled'}>${icon('minus', 16)}</button>
          <label class="count-value">
            <input type="number" inputmode="numeric" min="0" max="9999" value="${value}" data-count data-date="${date}"
              style="width:${Math.max(2, String(value).length) + 1.2}ch" aria-label="จำนวน${esc(h.name)}">
            <span>/${L.target(h)}${h.unit ? ` <small>${esc(h.unit)}</small>` : ''}</span>
          </label>
          <button class="icon-btn sm" data-act="inc" aria-label="เพิ่ม">${icon('plus', 16)}</button>
        </div>`
      : `<button class="check ${done ? 'on' : ''}" data-act="toggle" aria-pressed="${done}" aria-label="ทำแล้ว">${icon('check', 18)}</button>`;

  return `<div class="row habit-row ${done ? 'is-done' : ''}" data-id="${h.id}" style="--c:${h.color}">
    <button class="row-main" data-act="detail">
      <span class="emoji-tile">${esc(L.habitIcon(h))}</span>
      <span class="row-text"><span class="row-title">${esc(h.name)}</span>${meta.length ? `<span class="row-sub">${esc(meta.join(' · '))}</span>` : ''}</span>
    </button>
    ${control}
    <button class="icon-btn sm more" data-act="menu" aria-label="ตัวเลือกของ ${esc(h.name)}">${icon('more', 18)}</button>
  </div>`;
}

// ---------- แท็บสถิติ ----------
// ปุ่มสัปดาห์/เดือนใช้ร่วมกันทั้งหน้า: ตารางสี, สรุป %, กราฟแท่งรายวัน และรายการแต่ละกิจวัตร
// ตารางสี: แถว = กิจวัตร, คอลัมน์ = วัน ช่องที่ทำแล้วเป็นสีของกิจวัตร ยิ่งทำต่อเนื่องสียิ่งเข้ม

function statsTab() {
  const t = today();
  const habits = L.activeHabits();
  if (!habits.length) return `<div class="card">${emptyState('ยังไม่มีกิจวัตร กดปุ่ม + เพื่อเริ่มเลย')}</div>`;

  const week = gridMode === 'week';
  const mk = monthOf(gridDate);
  const start = week ? weekStart(gridDate) : `${mk}-01`;
  const end = week ? addDays(start, 6) : `${mk}-${pad(daysInMonth(mk))}`;
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  // แบบเดือนช่องแคบ จึงแสดงเลขเฉพาะวันที่ 1 วันจันทร์ และวันนี้ โดยเว้นระยะไม่ให้ตัวเลขชนกัน
  const labeled = new Set(week ? days : []);
  if (!week) {
    const todayIdx = days.indexOf(t);
    let last = -9;
    days.forEach((d, i) => {
      const keep = d === t || ((parseKey(d).getDate() === 1 || weekday(d) === 1) && i - last >= 3 && (todayIdx < 0 || Math.abs(i - todayIdx) >= 3));
      if (keep) {
        labeled.add(d);
        last = i;
      }
    });
  }
  const head = days
    .map((d) => {
      const n = parseKey(d).getDate();
      const wd = weekday(d);
      const label = labeled.has(d) ? n : '';
      return `<div class="hg-day ${wd === 0 || wd === 6 ? 'we' : ''} ${d > t ? 'future' : ''}">
        ${week ? `<span class="${n === 1 ? 'm1' : ''}">${n === 1 ? TH_MONTHS_SHORT[parseKey(d).getMonth()] : TH_DAYS_SHORT[wd]}</span>` : ''}
        <b class="${d === t ? 'now' : ''}">${label}</b>
      </div>`;
    })
    .join('');

  const rows = habits
    .map((h) => {
      // นับความต่อเนื่องย้อนไปก่อนช่วงที่แสดง สีของวันแรกในหน้าจะได้ถูกต้อง
      let run = 0;
      const cells = [];
      for (let d = addDays(start, -60); d <= end; d = addDays(d, 1)) {
        if (d > t) {
          cells.push('<span class="hg-cell future"></span>');
          continue;
        }
        const v = L.logValue(h, d);
        const ratio = Math.min(1, v / L.target(h));
        let cls;
        let style = '';
        if (ratio >= 1) {
          run++;
          // วันแรกสีอ่อน เข้มขึ้นจนสุดในวันที่ 6 แล้วค่อยๆ ลึกขึ้นอีกถ้าต่อเนื่องนานๆ
          const lv = Math.min(1, Math.max(0, Math.min(1, 0.45 + run * 0.11) + jitter(h.id, d)));
          const dk = Math.min(0.22, Math.max(0, run - 6) * 0.02);
          cls = 'done';
          style = `--lv:${lv.toFixed(3)};--dk:${dk.toFixed(3)}`;
        } else if (!L.isActiveOn(h, d)) {
          cls = 'inactive';
        } else if (!L.isDue(h, d) || !L.countsOn(h, d)) {
          cls = 'off';
        } else {
          if (d !== t) run = 0;
          cls = L.isMissed(h, d) ? 'miss' : 'pending';
          if (ratio > 0) {
            cls += ' partial';
            style = `--lv:${(0.12 + ratio * 0.3).toFixed(3)};--dk:0`;
          }
        }
        if (d < start) continue;
        cells.push(
          `<button class="hg-cell ${cls} ${d === t ? 'today' : ''}" data-act="cell" data-id="${h.id}" data-date="${d}" style="${style}" aria-label="${esc(h.name)} ${fmtDate(d)}${ratio >= 1 ? ' ทำแล้ว' : ''}"></button>`
        );
      }
      return `<button class="hg-name" data-act="detail" data-id="${h.id}" style="--c:${h.color}" title="${esc(h.name)}">
          <span class="emoji-tile">${esc(L.habitIcon(h))}</span><span class="hg-label">${esc(h.name)}</span>
        </button>
        <div class="hg-row" style="--c:${h.color}">${cells.join('')}</div>`;
    })
    .join('');

  const ov = L.rangeOverview(start, end);
  const streaks = L.allDoneStreaks();
  const listed = habits.filter((h) => L.habitStart(h) <= end && L.habitStart(h) <= t && (!h.endDate || h.endDate >= start));
  const bars = ov.days
    .map((x) => {
      const ratio = x.future || !x.total ? null : x.done / x.total;
      const n = parseKey(x.date).getDate();
      const label = week ? `${TH_DAYS_SHORT[weekday(x.date)]}<br>${n}` : labeled.has(x.date) ? n : '&nbsp;';
      return `<div class="bar-col ${x.date === t ? 'today' : ''} ${ratio == null ? 'no-data' : ''}">
        <div class="bar"><span style="height:${Math.round((ratio || 0) * 100)}%"></span></div>
        <span class="bar-label">${label}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="grid-bar">
      <div class="seg seg-sm">
        <label><input type="radio" name="gmode" value="week" data-act="grid-mode" ${week ? 'checked' : ''}><span>สัปดาห์</span></label>
        <label><input type="radio" name="gmode" value="month" data-act="grid-mode" ${week ? '' : 'checked'}><span>เดือน</span></label>
      </div>
      <div class="grid-nav">
        <button class="icon-btn" data-act="grid-nav" data-d="-1" aria-label="${week ? 'สัปดาห์' : 'เดือน'}ก่อน">${icon('left')}</button>
        <button class="link" data-act="grid-nav" data-d="0">${week ? weekRange(start) : fmtMonth(mk)}</button>
        <button class="icon-btn" data-act="grid-nav" data-d="1" aria-label="${week ? 'สัปดาห์' : 'เดือน'}ถัดไป" ${end >= t ? 'disabled' : ''}>${icon('right')}</button>
      </div>
    </div>
    <div class="card hgrid-card">
      <div class="hgrid ${week ? 'week' : 'month'}" style="--days:${days.length}">
        <div class="hg-corner"></div>
        <div class="hg-row hg-head">${head}</div>
        ${rows}
      </div>
    </div>
    <div class="hg-legend">
      <span><i class="hg-swatch light"></i><i class="hg-swatch deep"></i>ทำต่อเนื่อง สียิ่งเข้ม</span>
      <span><i class="hg-swatch miss"></i>พลาด</span>
      <span><i class="hg-swatch off"></i>ไม่ต้องทำ</span>
    </div>
    <p class="hint center">แตะช่องเพื่อติ๊ก ผลจะอัปเดตในหน้า "วันนี้" ด้วย · แตะไอคอนเพื่อดูรายละเอียด</p>

    <div class="card pad ring-card">
      ${ring(ov.rate, 'var(--accent)', week ? 'ทั้งสัปดาห์' : 'ทั้งเดือน')}
      <div class="kv">
        <div><span>วันที่ทำครบ</span><b>${ov.allDoneDays} วัน</b></div>
        <div><span>วันที่ไม่ได้ทำเลย</span><b class="${ov.zeroDays ? 'neg' : ''}">${ov.zeroDays} วัน</b></div>
        <div><span>ทำครบติดกันตอนนี้</span><b>${streaks.current} วัน</b></div>
        <div><span>ทำครบติดกันสูงสุด</span><b>${streaks.best} วัน</b></div>
      </div>
    </div>

    <div class="card pad">
      <span class="muted small">ทำสำเร็จรายวัน</span>
      <div class="bars ${week ? '' : 'dense'}">${bars}</div>
    </div>

    <h3 class="section-label">แต่ละกิจวัตร</h3>
    <div class="list card">
      ${
        listed.length
          ? listed
              .map((h) => {
                const s = L.periodStats(h, start, end);
                const r = s.due ? Math.min(1, s.done / s.due) : null;
                return `<button class="row" data-act="detail" data-id="${h.id}" style="--c:${h.color}">
                  <span class="emoji-tile">${esc(L.habitIcon(h))}</span>
                  <span class="row-text"><span class="row-title">${esc(h.name)}</span><span class="row-sub">ทำ ${s.done}/${s.due} ครั้ง</span></span>
                  <span class="stat-right"><b style="color:var(--c)">${pctText(r)}</b><small>🔥 ${L.currentStreak(h)}</small></span>
                </button>`;
              })
              .join('')
          : emptyState(`ยังไม่มีกิจวัตรใน${week ? 'สัปดาห์' : 'เดือน'}นี้`)
      }
    </div>
  `;
}

// สีแต่ละช่องต่างกันนิดหน่อยแบบโมเสก (คงที่ต่อวัน ไม่เปลี่ยนทุกครั้งที่วาด)
function jitter(id, date) {
  let x = 0;
  for (const ch of id + date) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(x) % 100) / 100 - 0.5) * 0.08;
}

// ---------- แท็บปฏิทินรวม ----------

function calendarTab() {
  const t = today();
  const mo = L.monthOverview(calMonth);
  const streaks = L.allDoneStreaks();
  const lead = (weekday(`${calMonth}-01`) + 6) % 7;

  return `
    <div class="nav-row">
      <button class="icon-btn" data-act="cal-month" data-d="-1" aria-label="เดือนก่อน">${icon('left')}</button>
      <button class="link" data-act="cal-month" data-d="0">${fmtMonth(calMonth)}</button>
      <button class="icon-btn" data-act="cal-month" data-d="1" aria-label="เดือนถัดไป" ${calMonth >= monthOf(t) ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    <div class="card pad">
      <div class="cal overall">
        ${CAL_DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('')}
        ${'<span></span>'.repeat(lead)}
        ${mo.days
          .map((x) => {
            const cls = x.future
              ? 'future'
              : !x.total
                ? 'empty'
                : x.allDone
                  ? 'all'
                  : x.done
                    ? 'part'
                    : x.date < t
                      ? 'none'
                      : '';
            // อารมณ์ที่เลือกในบันทึกประจำวัน (มีแต่ข้อความ = จุดเล็กๆ)
            const note = store.get('notes', x.date);
            const mark = note?.mood ? `<span class="m">${MOODS[note.mood - 1]}</span>` : note?.text ? '<span class="m dot-note"></span>' : '';
            return `<button class="cal-day ${cls} ${x.date === t ? 'today' : ''} ${mark ? 'has-note' : ''}" data-act="goto" data-date="${x.date}" ${x.future ? 'disabled' : ''}>
              <span class="d">${parseKey(x.date).getDate()}</span>${mark}
            </button>`;
          })
          .join('')}
      </div>
      <div class="cal-legend">
        <span><i class="lg all"></i>ทำครบ</span><span><i class="lg part"></i>ทำบางส่วน</span><span><i class="lg none"></i>ไม่ได้ทำ</span><span>🙂 อารมณ์</span>
      </div>
    </div>

    <div class="card pad ring-card">
      ${ring(mo.rate, 'var(--accent)', 'เดือนนี้')}
      <div class="kv">
        <div><span>ทำครบติดกันตอนนี้</span><b>${streaks.current} วัน</b></div>
        <div><span>ทำครบติดกันสูงสุด</span><b>${streaks.best} วัน</b></div>
        <div><span>วันที่ทำครบ (เดือนนี้)</span><b>${mo.allDoneDays} วัน</b></div>
        <div><span>วันที่ไม่ได้ทำเลย (เดือนนี้)</span><b class="${mo.zeroDays ? 'neg' : ''}">${mo.zeroDays} วัน</b></div>
      </div>
    </div>
    <p class="hint center">แตะวันที่เพื่อดูหรือบันทึกกิจวัตรของวันนั้น</p>
  `;
}

// ---------- แท็บบันทึกประจำวัน ----------

function journalTab() {
  const t = today();
  const notes = store
    .all('notes')
    .filter((n) => n.date.startsWith(journalMonth))
    .sort((a, b) => b.date.localeCompare(a.date));
  const moodCount = MOODS.map((_, i) => notes.filter((n) => n.mood === i + 1).length);
  const dayLabel = (d) => (d >= addDays(t, -1) ? relDay(d) : `${TH_DAYS[weekday(d)]} ${fmtDate(d)}`);

  return `
    <div class="nav-row">
      <button class="icon-btn" data-act="journal-month" data-d="-1" aria-label="เดือนก่อน">${icon('left')}</button>
      <button class="link" data-act="journal-month" data-d="0">${fmtMonth(journalMonth)}</button>
      <button class="icon-btn" data-act="journal-month" data-d="1" aria-label="เดือนถัดไป" ${journalMonth >= monthOf(t) ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    ${journalMonth === monthOf(t) && !store.get('notes', t) ? `<button class="btn btn-primary write-today" data-act="open-note" data-date="${t}">${icon('edit', 18)} เขียนบันทึกวันนี้</button>` : ''}

    ${
      notes.some((n) => n.mood)
        ? `<div class="card pad mood-summary" aria-label="อารมณ์ในเดือนนี้">
            ${MOODS.map((m, i) => `<div class="${moodCount[i] ? '' : 'none'}"><span>${m}</span><b>${moodCount[i]}</b></div>`).join('')}
          </div>`
        : ''
    }

    <div class="list card journal">
      ${
        notes.length
          ? notes
              .map(
                (n) => `<button class="journal-entry" data-act="open-note" data-date="${n.date}">
                  <span class="journal-mood">${n.mood ? MOODS[n.mood - 1] : '<span class="no-mood"></span>'}</span>
                  <span class="journal-body">
                    <span class="journal-date">${esc(dayLabel(n.date))}</span>
                    ${n.text ? `<span class="journal-text">${esc(n.text)}</span>` : '<span class="journal-text muted">ไม่ได้เขียนข้อความ</span>'}
                  </span>
                </button>`
              )
              .join('')
          : emptyState('ยังไม่มีบันทึกในเดือนนี้')
      }
    </div>
  `;
}

// ---------- เมนู ⋮ ----------

export function habitMenu(h) {
  openSheet({
    title: `${L.habitIcon(h)} ${h.name}`,
    body: `<div class="menu-list">
      <button data-m="detail">${icon('chart')} สถิติและปฏิทิน</button>
      <button data-m="edit">${icon('edit')} แก้ไข</button>
      <button data-m="remind">${icon('bell')} เตือนผ่านปฏิทิน${h.reminder ? ` <span class="muted">(${h.reminder})</span>` : ''}</button>
      <button data-m="archive">${icon('archive')} เก็บถาวร</button>
      <button data-m="delete" class="danger">${icon('trash')} ลบ</button>
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        close();
        ({ detail: habitDetail, edit: editHabit, remind: reminderSheet, archive: archiveHabit, delete: deleteHabit })[m](h);
      };
    },
  });
}

async function archiveHabit(h) {
  if (!(await confirmBox(`เก็บ "${h.name}" ถาวร? ประวัติยังอยู่ และนำกลับมาได้ที่หน้าตั้งค่า`, { ok: 'เก็บถาวร' }))) return false;
  store.patch('habits', h.id, { archived: true });
  toast('เก็บถาวรแล้ว');
  return true;
}

async function deleteHabit(h) {
  if (!(await confirmBox(`ลบ "${h.name}" และประวัติทั้งหมด? ถ้าอยากเก็บประวัติไว้ ให้ใช้ "เก็บถาวร" แทน`, { ok: 'ลบ', danger: true }))) return false;
  store.batch(() => {
    for (const l of store.all('habitLogs')) if (l.habitId === h.id) store.remove('habitLogs', l.id);
    store.remove('habits', h.id);
  });
  toast('ลบแล้ว');
  return true;
}

// ---------- รายละเอียด + ปฏิทินรายกิจวัตร ----------

export function habitDetail(h) {
  let month = monthOf(today());
  openSheet({
    title: `${L.habitIcon(h)} ${h.name}`,
    body: '<div data-detail></div>',
    onMount(sheet, close) {
      const box = sheet.querySelector('[data-detail]');
      const draw = () => {
        h = store.get('habits', h.id);
        if (!h) return close();
        const t = today();
        const lead = (weekday(`${month}-01`) + 6) % 7;
        const cells = [];
        for (let d = 1; d <= daysInMonth(month); d++) {
          const k = `${month}-${pad(d)}`;
          const ratio = Math.min(1, L.logValue(h, k) / L.target(h));
          const cls = [
            k > t ? 'future' : '',
            !L.isActiveOn(h, k) && !ratio ? 'inactive' : !L.isDue(h, k) ? 'off' : '',
            L.isMissed(h, k) ? 'missed' : '',
            ratio >= 1 ? 'full' : '',
            k === t ? 'today' : '',
          ].join(' ');
          cells.push(
            `<button class="cal-day ${cls}" data-date="${k}" ${k > t ? 'disabled' : ''} style="${ratio ? `--fill:${ratio}` : ''}" aria-label="${d}${ratio >= 1 ? ' ทำแล้ว' : ''}">${d}</button>`
          );
        }
        const rate = L.rateBetween(h, `${month}-01`, `${month}-${pad(daysInMonth(month))}`);
        const range = [h.startDate && `เริ่ม ${fmtDate(h.startDate)}`, h.endDate && `ถึง ${fmtDate(h.endDate)}`].filter(Boolean).join(' · ');
        box.innerHTML = `
          ${h.desc ? `<p class="detail-desc">${esc(h.desc)}</p>` : ''}
          <p class="hint top">${esc([L.freqLabel(h), h.type === 'count' ? `วันละ ${L.target(h)} ${h.unit || 'ครั้ง'}` : '', range, h.reminder ? `⏰ ${h.reminder}` : ''].filter(Boolean).join(' · '))}</p>
          <div class="cal-head">
            <button class="icon-btn" data-m="-1" aria-label="เดือนก่อน">${icon('left')}</button>
            <span>${fmtMonth(month)}</span>
            <button class="icon-btn" data-m="1" aria-label="เดือนถัดไป" ${month >= monthOf(t) ? 'disabled' : ''}>${icon('right')}</button>
          </div>
          <div class="cal" style="--c:${h.color}">
            ${CAL_DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('')}
            ${'<span></span>'.repeat(lead)}
            ${cells.join('')}
          </div>
          <p class="hint">แตะวันที่เพื่อบันทึกย้อนหลัง · ขอบแดง = วันที่พลาด</p>
          <div class="ring-card">
            ${ring(rate, h.color, 'เดือนนี้')}
            <div class="kv">
              <div><span>ต่อเนื่องตอนนี้</span><b>${L.currentStreak(h)} ${L.streakUnit(h)}</b></div>
              <div><span>ต่อเนื่องสูงสุด</span><b>${L.bestStreak(h)} ${L.streakUnit(h)}</b></div>
              <div><span>ทำในเดือนนี้</span><b>${L.doneCount(h, `${month}-01`, `${month}-31`)} วัน</b></div>
              <div><span>ทำทั้งหมด</span><b>${L.doneCount(h)} วัน</b></div>
            </div>
          </div>
          <div class="sheet-actions">
            <button class="btn" data-a="remind">${icon('bell', 18)} เตือน</button>
            <button class="btn" data-a="archive">${icon('archive', 18)} เก็บถาวร</button>
            <button class="btn grow" data-a="edit">${icon('edit', 18)} แก้ไข</button>
          </div>`;
      };
      draw();
      box.onclick = async (e) => {
        const m = e.target.closest('[data-m]');
        if (m) {
          month = addMonths(month, Number(m.dataset.m));
          return draw();
        }
        const day = e.target.closest('[data-date]');
        if (day) {
          L.toggle(h, day.dataset.date);
          return draw();
        }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'edit' || a === 'remind') {
          close();
          (a === 'edit' ? editHabit : reminderSheet)(h);
        } else if (a === 'archive' && (await archiveHabit(h))) close();
      };
    },
  });
}

// ---------- เพิ่มกิจวัตร: เลือกจากคลังหรือสร้างเอง ----------

function chooseTemplate() {
  openSheet({
    title: 'เพิ่มกิจวัตร',
    body: `
      <button class="row own-habit card" data-own>
        <span class="emoji-tile">✏️</span>
        <span class="row-text"><span class="row-title">สร้างกิจวัตรเอง</span><span class="row-sub">ตั้งชื่อ ไอคอน ความถี่ได้ตามใจ</span></span>
        ${icon('plus', 20)}
      </button>
      ${TEMPLATE_GROUPS.map(
        (g, gi) => `<details class="tpl-group" ${gi === 0 ? 'open' : ''}>
          <summary>${esc(g.name)}<span class="muted small">${g.items.length}</span></summary>
          <div class="list">
            ${g.items
              .map((item, ii) => {
                const tpl = templateHabit(item);
                return `<button class="row" data-g="${gi}" data-i="${ii}">
                  <span class="emoji-tile">${tpl.icon}</span>
                  <span class="row-text"><span class="row-title">${esc(tpl.name)}</span>
                  <span class="row-sub">${esc([L.freqLabel(tpl), tpl.type === 'count' ? `วันละ ${tpl.target} ${tpl.unit}` : ''].filter(Boolean).join(' · '))}</span></span>
                  ${icon('right', 18)}
                </button>`;
              })
              .join('')}
          </div>
        </details>`
      ).join('')}`,
    onMount(sheet, close) {
      sheet.onclick = (e) => {
        if (e.target.closest('[data-own]')) {
          close();
          return editHabit();
        }
        const row = e.target.closest('[data-g]');
        if (!row) return;
        close();
        editHabit(templateHabit(TEMPLATE_GROUPS[row.dataset.g].items[row.dataset.i]));
      };
    },
  });
}

// ---------- ฟอร์มเพิ่ม / แก้ไข ----------

export function editHabit(h) {
  const isNew = !h?.id;
  h = {
    name: '',
    icon: '✨',
    desc: '',
    type: 'check',
    target: 8,
    unit: '',
    freq: { kind: 'daily' },
    color: COLORS[store.all('habits').length % COLORS.length],
    startDate: isNew ? today() : L.habitStart(h),
    endDate: '',
    reminder: '',
    ...h,
  };
  const days = h.freq.kind === 'weekdays' ? h.freq.days : [1, 2, 3, 4, 5];
  const times = h.freq.kind === 'perWeek' ? h.freq.times : 3;

  openSheet({
    title: isNew ? 'สร้างกิจวัตร' : 'แก้ไขกิจวัตร',
    body: `<form class="form" novalidate>
      <div class="field"><span>ชื่อกิจวัตร</span>
        <div class="name-row">
          <button type="button" class="emoji-btn" data-emoji aria-label="เลือกไอคอน">${esc(L.habitIcon(h))}</button>
          <input name="name" value="${esc(h.name)}" placeholder="เช่น ออกกำลังกาย, อ่านหนังสือ" maxlength="60" ${isNew && !h.name ? 'autofocus' : ''} required>
        </div>
        <input type="hidden" name="icon" value="${esc(L.habitIcon(h))}">
        <div class="emoji-pick" data-picker hidden>
          ${ICONS.map((e) => `<button type="button" data-icon="${e}">${e}</button>`).join('')}
          <input name="iconCustom" placeholder="หรือพิมพ์อีโมจิเอง" maxlength="8" autocomplete="off">
        </div>
      </div>
      <label class="field"><span>คำอธิบาย (ถ้ามี)</span>
        <input name="desc" value="${esc(h.desc || '')}" placeholder="เช่น หลังตื่นนอน ก่อนอาหารเช้า" maxlength="80">
      </label>

      <div class="field"><span>รูปแบบ</span>
        <div class="seg">
          <label><input type="radio" name="type" value="check" ${h.type === 'check' ? 'checked' : ''}><span>ทำ / ไม่ทำ</span></label>
          <label><input type="radio" name="type" value="count" ${h.type === 'count' ? 'checked' : ''}><span>นับจำนวน</span></label>
        </div>
      </div>
      <div class="field-row" data-show="count">
        <label class="field"><span>เป้าหมายต่อวัน</span><input name="target" type="number" inputmode="numeric" min="1" value="${h.target || 8}"></label>
        <label class="field"><span>หน่วย</span><input name="unit" value="${esc(h.unit || '')}" placeholder="เช่น แก้ว, หน้า" maxlength="12"></label>
      </div>

      <div class="field"><span>ความถี่</span>
        <div class="seg">
          <label><input type="radio" name="freq" value="daily" ${h.freq.kind === 'daily' ? 'checked' : ''}><span>ทุกวัน</span></label>
          <label><input type="radio" name="freq" value="weekdays" ${h.freq.kind === 'weekdays' ? 'checked' : ''}><span>เลือกวัน</span></label>
          <label><input type="radio" name="freq" value="perWeek" ${h.freq.kind === 'perWeek' ? 'checked' : ''}><span>ครั้ง/สัปดาห์</span></label>
        </div>
      </div>
      <div class="chips" data-show="weekdays">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="chip"><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${TH_DAYS_SHORT[d]}</span></label>`).join('')}
      </div>
      <label class="field" data-show="perWeek"><span>จำนวนครั้งต่อสัปดาห์</span>
        <select name="times">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === times ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>

      <div class="field-row">
        <label class="field"><span>วันเริ่ม</span><input name="startDate" type="date" value="${h.startDate}"></label>
        <label class="field"><span>วันสิ้นสุด (ถ้ามี)</span><input name="endDate" type="date" value="${h.endDate || ''}"></label>
      </div>
      <label class="field"><span>เวลาเตือน (ถ้ามี)</span><input name="reminder" type="time" value="${h.reminder || ''}"></label>
      <p class="hint">ตั้งเวลาเตือนแล้ว บันทึกเสร็จจะให้เพิ่มนัดลงปฏิทินในเครื่อง</p>

      <div class="field"><span>สี</span>${colorPicker(COLORS, h.color)}</div>

      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash', 18)} ลบ</button>`}
        <button class="btn btn-primary grow">บันทึก</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const picker = form.querySelector('[data-picker]');
      const emojiBtn = form.querySelector('[data-emoji]');
      const setIcon = (v) => {
        form.elements.icon.value = v;
        emojiBtn.textContent = v;
      };
      emojiBtn.onclick = () => (picker.hidden = !picker.hidden);
      picker.onclick = (e) => {
        const b = e.target.closest('[data-icon]');
        if (!b) return;
        setIcon(b.dataset.icon);
        form.elements.iconCustom.value = '';
        picker.hidden = true;
      };
      form.elements.iconCustom.oninput = (e) => e.target.value.trim() && setIcon(e.target.value.trim());

      const showFields = () => {
        const shown = [form.elements.type.value, form.elements.freq.value];
        for (const el of form.querySelectorAll('[data-show]')) el.hidden = !shown.includes(el.dataset.show);
      };
      form.onchange = showFields;
      showFields();

      form.onsubmit = (e) => {
        e.preventDefault();
        const f = form.elements;
        const name = f.name.value.trim();
        if (!name) return f.name.focus();
        const kind = f.freq.value;
        const freq =
          kind === 'weekdays'
            ? { kind, days: [...form.querySelectorAll('[name=days]:checked')].map((x) => Number(x.value)) }
            : kind === 'perWeek'
              ? { kind, times: Number(f.times.value) }
              : { kind };
        if (kind === 'weekdays' && !freq.days.length) return toast('เลือกอย่างน้อย 1 วัน');
        const startDate = f.startDate.value || today();
        const endDate = f.endDate.value;
        if (endDate && endDate < startDate) return toast('วันสิ้นสุดต้องอยู่หลังวันเริ่ม');
        const reminder = f.reminder.value;
        const saved = store.put('habits', {
          ...h,
          name,
          icon: f.icon.value || '✨',
          desc: f.desc.value.trim(),
          type: f.type.value,
          target: Math.max(1, parseInt(f.target.value, 10) || 1),
          unit: f.unit.value.trim(),
          freq,
          startDate,
          endDate,
          reminder,
          color: f.color.value,
          createdAt: h.createdAt || Date.now(),
          order: h.order ?? store.all('habits').length,
        });
        close();
        const scheduleChanged = reminder && (isNew || reminder !== h.reminder || JSON.stringify(freq) !== JSON.stringify(h.freq) || endDate !== (h.endDate || ''));
        if (scheduleChanged) reminderSheet(saved, { justSaved: true });
        else toast(isNew ? 'เพิ่มกิจวัตรแล้ว' : 'บันทึกแล้ว');
      };

      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await deleteHabit(h)) close();
      });
    },
  });
}

// ---------- เตือนผ่านปฏิทิน ----------

export function reminderSheet(h, { justSaved = false } = {}) {
  const ios = isIOS();
  openSheet({
    title: 'เตือนผ่านปฏิทิน',
    body: `<div class="form">
      ${justSaved ? '<p class="saved-note">✓ บันทึกกิจวัตรแล้ว</p>' : ''}
      <p class="small">สร้างนัด <b>${esc(L.habitIcon(h))} ${esc(h.name)}</b> ${esc(L.freqLabel(h))} พร้อมเสียงเตือน แล้วเพิ่มลงปฏิทินในเครื่อง เตือนได้แม้ไม่ได้เปิดแอป</p>
      <label class="field"><span>เวลาเตือน</span><input name="time" type="time" value="${h.reminder || '08:00'}"></label>
      <button type="button" class="btn btn-primary" data-ics>${icon('plan', 18)} เพิ่มลงปฏิทิน${ios ? ' iPhone' : 'ในเครื่อง'}</button>
      <a class="btn" data-gcal target="_blank" rel="noopener">เพิ่มลง Google Calendar</a>
      <p class="hint">${
        ios
          ? 'บน iPhone: กดเพิ่มลงปฏิทิน แล้วเลือก "เพิ่มทั้งหมด" (Add All) ถ้าระบบถามให้ดาวน์โหลด ให้กดดาวน์โหลดแล้วแตะเปิดไฟล์'
          : 'ไฟล์ .ics เปิดได้ด้วย Outlook, ปฏิทินของ Windows/Mac หรือนำเข้า Google Calendar'
      }</p>
      <p class="hint">ถ้าแก้เวลาหรือความถี่ภายหลัง ให้ลบนัดเดิมในปฏิทินแล้วเพิ่มใหม่ · Google Calendar จะเตือนตามค่าเริ่มต้นของปฏิทินนั้น</p>
    </div>`,
    onMount(sheet, close) {
      const time = sheet.querySelector('[name=time]');
      const gcal = sheet.querySelector('[data-gcal]');
      const saveTime = () => {
        if (time.value && time.value !== h.reminder) h = store.patch('habits', h.id, { reminder: time.value }) || h;
      };
      const updateLink = () => (gcal.href = googleCalendarUrl(h, time.value || '08:00'));
      time.oninput = updateLink;
      updateLink();
      gcal.onclick = () => {
        saveTime();
        setTimeout(close, 300);
      };
      sheet.querySelector('[data-ics]').onclick = () => {
        if (!time.value) return toast('เลือกเวลาก่อน');
        saveTime();
        downloadIcs(h, time.value);
        close();
        toast('สร้างนัดเตือนแล้ว');
      };
    },
  });
}
