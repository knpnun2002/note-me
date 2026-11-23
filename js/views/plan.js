// หน้าแพลนแบบ Todoist: วันนี้ / ล่วงหน้า / Inbox / โปรเจกต์ (+ ป้ายกำกับ, บอร์ด)
// เพิ่มงานด้วยการพิมพ์ภาษาธรรมชาติ, ปัดขวา = เสร็จ, ปัดซ้าย = เลื่อนวัน, ลากที่จุดจับเพื่อจัดลำดับ

import * as store from '../store.js';
import * as T from '../tasks.js';
import { parseQuickAdd } from '../quickadd.js';
import { esc, uid, today, addDays, weekStart, weekday, parseKey, toKey, fmtDate, TH_DAYS, TH_DAYS_SHORT, TH_MONTHS_SHORT, COLORS } from '../utils.js';
import { icon, openSheet, confirmBox, toast, progress, emptyState, ring, colorPicker, startSwipe } from '../ui.js';

let tab = 'today';
let openProjectId = null;
let openLabel = null;
let upWeek = today();
let showDone = false;
let hideOverdue = false;
let suppressClick = false;

const TABS = { today: 'วันนี้', upcoming: 'ล่วงหน้า', inbox: 'Inbox', projects: 'โปรเจกต์' };

export function render(root) {
  if (openProjectId && !T.project(openProjectId)) openProjectId = null;
  root.innerHTML = `
    <header class="page-head">
      <h1>แพลน</h1>
      <button class="icon-btn" data-act="stats" aria-label="ความคืบหน้าและงานที่เสร็จ">${icon('chart', 22)}</button>
    </header>
    <nav class="tabs" role="tablist">
      ${Object.entries(TABS).map(([k, v]) => `<button role="tab" class="${k === tab ? 'sel' : ''}" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join('')}
    </nav>
    ${{ today: viewToday, upcoming: viewUpcoming, inbox: viewInbox, projects: viewProjects }[tab]()}
    <div class="fab-space"></div>
    <button class="fab" data-act="quick" aria-label="เพิ่มงาน">${icon('plus', 26)}</button>
  `;

  root.onclick = (e) => {
    if (suppressClick) return;
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      openProjectId = null;
      openLabel = null;
      return render(root);
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const task = store.get('tasks', el.closest('[data-id]')?.dataset.id);
    if (task && el.dataset.act === 'toggle') return completeWithAnimation(el.closest('.task-item'), task);
    if (task && taskAction(el.dataset.act, task)) return;
    const pid = el.dataset.pid || openProjectId;
    switch (el.dataset.act) {
      case 'quick':
        return openQuickAdd(el.dataset.ctx ? JSON.parse(el.dataset.ctx) : context());
      case 'stats':
        return openStats();
      case 'toggle-done':
        showDone = !showDone;
        return render(root);
      case 'toggle-overdue':
        hideOverdue = !hideOverdue;
        return render(root);
      case 'reschedule-overdue':
        return pickDate({ date: today() }, ({ date }) => {
          store.batch(() => T.overdueTasks().forEach((t) => store.patch('tasks', t.id, { date })));
          toast('เลื่อนงานค้างแล้ว');
        }, { allowRecur: false });
      case 'undo-log': {
        const t = store.get('tasks', el.dataset.task);
        if (t?.done) T.uncomplete(t);
        return;
      }
      case 'up-nav':
        upWeek = el.dataset.d === '0' ? today() : addDays(upWeek, Number(el.dataset.d) * 7);
        return render(root);
      case 'up-jump':
        return root.querySelector(`#day-${el.dataset.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      case 'goto-inbox':
        tab = 'inbox';
        return render(root);
      case 'open-project':
        openProjectId = el.dataset.pid;
        openLabel = null;
        render(root);
        return scrollTo(0, 0);
      case 'open-label':
        openLabel = el.dataset.label;
        openProjectId = null;
        render(root);
        return scrollTo(0, 0);
      case 'back':
        openProjectId = null;
        openLabel = null;
        return render(root);
      case 'proj-view':
        if (el.value !== T.project(pid)?.view) store.patch('projects', pid, { view: el.value });
        return;
      case 'project-menu':
        return projectMenu(T.project(pid));
      case 'new-project':
        return editProject();
      case 'new-section':
        return editSection({ projectId: pid });
      case 'section-menu':
        return sectionMenu(store.get('sections', el.dataset.sid));
    }
  };

  root.onpointerdown = (e) => {
    const handle = e.target.closest('[data-drag]');
    if (handle) return startDrag(e, handle);
    const item = e.target.closest('.task-item');
    if (item && e.pointerType !== 'mouse') swipeTask(e, item);
  };
}

// บริบทของปุ่ม + ตามหน้าที่เปิดอยู่ งานใหม่จะได้ค่าเริ่มต้นที่ตรงกับหน้านั้น
function context() {
  if (tab === 'today') return { date: today() };
  if (tab === 'projects' && openProjectId) return { projectId: openProjectId };
  if (tab === 'projects' && openLabel) return { labels: [openLabel] };
  return {};
}

// การกดที่แถวงาน ใช้ร่วมกับหน้าหลัก คืน true ถ้าจัดการแล้ว
export function taskAction(act, t) {
  if (!t) return false;
  if (act === 'toggle') toggleTask(t);
  else if (act === 'open') openTask(t);
  else return false;
  return true;
}

function toggleTask(t) {
  if (t.done) return T.uncomplete(t);
  const before = T.doneTasksOn(today()).length;
  T.complete(t);
  const goal = T.goals().daily;
  if (before < goal && before + 1 >= goal) return toast(`ถึงเป้าวันนี้แล้ว 🎉 ${goal} งาน`);
  if (t.recur && t.date) toast(`เสร็จแล้ว · ครั้งถัดไป ${T.dueInfo(store.get('tasks', t.id).date).label}`);
}

// ติ๊กแล้วให้เห็นวงกลมเต็มก่อนงานหายจากรายการ
function completeWithAnimation(item, t) {
  if (t.done || !item) return toggleTask(t);
  item.classList.add('completing');
  setTimeout(() => toggleTask(t), 260);
}

// ---------- แถวงาน ----------

export function taskRow(t, { showProject = true, showDate = true, sortable = false } = {}) {
  const p = T.prio(t);
  const due = showDate ? T.dueInfo(t.date, t.time) : t.time ? { label: t.time, cls: 'time' } : null;
  const subs = T.subtasks(t.id);
  const proj = showProject ? T.project(t.projectId) : null;
  const meta = [];
  if (due || t.recur) meta.push(`<span class="due ${due?.cls || ''}">${icon('plan', 12)}${esc(due?.label || '')}${t.recur ? icon('repeat', 12) : ''}</span>`);
  if (subs.length) meta.push(`<span>${icon('subtask', 12)}${subs.filter((s) => s.done).length}/${subs.length}</span>`);
  for (const l of t.labels || []) meta.push(`<span class="lbl">@${esc(l)}</span>`);
  if (proj) meta.push(`<span class="proj"><i style="background:${proj.color}"></i>${esc(proj.name)}</span>`);
  const desc = (t.note || '').split('\n')[0];

  return `<div class="task-item" data-id="${t.id}">
    <div class="swipe-bg" aria-hidden="true"><span class="sw-done">${icon('check', 18)} เสร็จ</span><span class="sw-date">เลื่อนวัน ${icon('plan', 18)}</span></div>
    <div class="row task-row ${t.done ? 'is-done' : ''}">
      <button class="tcheck p${p} ${t.done ? 'on' : ''}" data-act="toggle" aria-pressed="${!!t.done}" aria-label="ทำเสร็จ">${icon('check', 14)}</button>
      <button class="row-main" data-act="open">
        <span class="row-text">
          <span class="t-title">${esc(t.title)}</span>
          ${desc ? `<span class="t-desc">${esc(desc)}</span>` : ''}
          ${meta.length ? `<span class="t-meta">${meta.join('')}</span>` : ''}
        </span>
      </button>
      ${sortable ? `<span class="drag-handle" data-drag aria-label="ลากเพื่อจัดลำดับ">${icon('grip', 16)}</span>` : ''}
    </div>
  </div>`;
}

function addRow(ctx, label = 'เพิ่มงาน') {
  return `<button class="add-row" data-act="quick" data-ctx="${esc(JSON.stringify(ctx))}">${icon('plus', 18)} ${label}</button>`;
}

function taskList(tasks, opts = {}, ctx = null) {
  return `<div class="list card tasks" ${opts.sortable ? 'data-sortable="1"' : ''}>
    ${tasks.map((t) => taskRow(t, opts)).join('')}
    ${ctx ? addRow(ctx) : ''}
  </div>`;
}

// ---------- วันนี้ ----------

function viewToday() {
  const t = today();
  const overdue = T.overdueTasks();
  const list = T.tasksOn(t);
  const done = T.doneTasksOn(t);
  const g = T.goals();
  return `
    <div class="view-head">
      <div><h2>วันนี้</h2><span class="muted small">วัน${TH_DAYS[weekday(t)]}ที่ ${fmtDate(t)}</span></div>
      <button class="goal-pill ${done.length >= g.daily ? 'hit' : ''}" data-act="stats" aria-label="เป้าวันนี้">${icon('check', 14)} ${done.length}/${g.daily}</button>
    </div>
    ${
      overdue.length
        ? `<div class="section-label row-between">
            <button class="link-plain fold ${hideOverdue ? 'closed' : ''}" data-act="toggle-overdue">เลยกำหนด <span class="neg">${overdue.length}</span></button>
            <button class="link" data-act="reschedule-overdue">เลื่อนทั้งหมด</button>
          </div>
          ${hideOverdue ? '' : taskList(overdue, {})}
          <h3 class="section-label">วันนี้</h3>`
        : ''
    }
    ${list.length || overdue.length ? '' : `<div class="all-clear">ไม่มีงานวันนี้ 🌿<span class="muted small">กดปุ่ม + หรือพิมพ์ "พรุ่งนี้ 9 โมง" ตอนเพิ่มงานได้เลย</span></div>`}
    ${taskList(list, { showDate: false, sortable: true }, { date: t })}
    ${done.length ? doneSection(done) : ''}
  `;
}

function doneSection(logs) {
  return `
    <button class="section-label link-plain fold ${showDone ? '' : 'closed'}" data-act="toggle-done">เสร็จแล้ววันนี้ (${logs.length})</button>
    ${
      showDone
        ? `<div class="list card">${logs
            .map((l) => {
              const t = store.get('tasks', l.taskId);
              const undoable = t?.done;
              return `<div class="row done-row">
                <button class="tcheck on" ${undoable ? `data-act="undo-log" data-task="${t.id}" aria-label="ยกเลิกเสร็จ"` : 'disabled'}>${icon('check', 14)}</button>
                <span class="row-text"><span class="t-title">${esc(l.title)}</span>${t?.recur ? `<span class="t-meta"><span>${icon('repeat', 12)} ${esc(T.recurLabel(t.recur))}</span></span>` : ''}</span>
              </div>`;
            })
            .join('')}</div>`
        : ''
    }`;
}

// ---------- ล่วงหน้า ----------

function viewUpcoming() {
  const t = today();
  const ws = weekStart(upWeek);
  const from = ws < t ? t : ws;
  const to = addDays(ws, 13);
  const overdue = ws <= t ? T.overdueTasks() : [];
  const groups = [];
  for (let d = from; d <= to; d = addDays(d, 1)) groups.push(d);
  const a = parseKey(ws);
  const b = parseKey(addDays(ws, 6));

  return `
    <div class="nav-row">
      <button class="icon-btn" data-act="up-nav" data-d="-1" aria-label="สัปดาห์ก่อน" ${ws <= weekStart(t) ? 'disabled' : ''}>${icon('left')}</button>
      <button class="link" data-act="up-nav" data-d="0">${a.getDate()} ${TH_MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${TH_MONTHS_SHORT[b.getMonth()]}</button>
      <button class="icon-btn" data-act="up-nav" data-d="1" aria-label="สัปดาห์ถัดไป">${icon('right')}</button>
    </div>
    <div class="up-strip">
      ${Array.from({ length: 7 }, (_, i) => {
        const d = addDays(ws, i);
        const n = d >= t ? T.tasksOn(d).length : 0;
        return `<button class="day-pill ${d === t ? 'today' : ''}" data-act="up-jump" data-date="${d}" ${d < t ? 'disabled' : ''}>
          <span class="dow">${TH_DAYS_SHORT[weekday(d)]}</span><span class="num">${parseKey(d).getDate()}</span>
          <span class="dot" style="opacity:${n ? 1 : 0}"></span>
        </button>`;
      }).join('')}
    </div>
    ${overdue.length ? `<h3 class="section-label neg">เลยกำหนด (${overdue.length})</h3>${taskList(overdue, {})}` : ''}
    ${groups
      .map((d) => {
        const diff = Math.round((parseKey(d) - parseKey(t)) / 864e5);
        const rel = diff === 0 ? ' · วันนี้' : diff === 1 ? ' · พรุ่งนี้' : '';
        return `<div class="day-head" id="day-${d}"><b>${parseKey(d).getDate()} ${TH_MONTHS_SHORT[parseKey(d).getMonth()]}</b> <span class="muted">วัน${TH_DAYS[weekday(d)]}${rel}</span></div>
          ${taskList(T.tasksOn(d), { showDate: false, sortable: true }, { date: d })}`;
      })
      .join('')}
  `;
}

// ---------- Inbox ----------

function viewInbox() {
  const list = T.inboxTasks();
  return `
    <div class="view-head"><div><h2>Inbox</h2><span class="muted small">งานที่ยังไม่ได้จัดเข้าโปรเจกต์</span></div></div>
    ${list.length ? '' : '<div class="all-clear">Inbox ว่างแล้ว ✨<span class="muted small">จดทุกอย่างที่นึกได้ไว้ที่นี่ก่อน แล้วค่อยจัดเข้าโปรเจกต์ทีหลัง</span></div>'}
    ${taskList(list, { showProject: false, sortable: true }, {})}
  `;
}

// ---------- โปรเจกต์ / ป้าย ----------

function viewProjects() {
  if (openProjectId) return viewProject(T.project(openProjectId));
  if (openLabel) return viewLabel(openLabel);
  const labels = T.allLabels();
  return `
    <div class="list card">
      <button class="row" data-act="goto-inbox">
        <span class="emoji-tile" style="--c:#64748b">${icon('inbox', 18)}</span>
        <span class="row-text"><span class="row-title">Inbox</span></span><span class="count">${T.inboxTasks().length || ''}</span>
      </button>
      ${T.projects()
        .map(
          (p) => `<button class="row" data-act="open-project" data-pid="${p.id}">
            <span class="emoji-tile" style="--c:${p.color}">${esc(p.icon || '📁')}</span>
            <span class="row-text"><span class="row-title">${esc(p.name)}</span></span><span class="count">${T.openCount(p.id) || ''}</span>
          </button>`
        )
        .join('')}
      <button class="add-row" data-act="new-project">${icon('plus', 18)} เพิ่มโปรเจกต์</button>
    </div>

    <h3 class="section-label">ป้ายกำกับ</h3>
    ${
      labels.length
        ? `<div class="label-chips">${labels.map(([l, n]) => `<button class="chip-btn" data-act="open-label" data-label="${esc(l)}">@${esc(l)} <span class="muted">${n}</span></button>`).join('')}</div>`
        : '<p class="hint">พิมพ์ @ตามด้วยชื่อป้ายตอนเพิ่มงาน เช่น @ด่วน @โทร แล้วป้ายจะมาอยู่ตรงนี้</p>'
    }

    <button class="row card history-link" data-act="stats">
      <span class="emoji-tile" style="--c:#16a37f">${icon('chart', 18)}</span>
      <span class="row-text"><span class="row-title">ความคืบหน้าและงานที่เสร็จแล้ว</span><span class="row-sub">เป้าต่อวัน สถิติ และประวัติย้อนหลัง</span></span>
      ${icon('right', 18)}
    </button>
  `;
}

function viewProject(p) {
  const secs = T.sections(p.id);
  const board = p.view === 'board';
  const head = `
    <div class="proj-head">
      <button class="icon-btn" data-act="back" aria-label="กลับ">${icon('left')}</button>
      <span class="emoji-tile" style="--c:${p.color}">${esc(p.icon || '📁')}</span>
      <h2>${esc(p.name)}</h2>
      <button class="icon-btn" data-act="project-menu" data-pid="${p.id}" aria-label="ตัวเลือกโปรเจกต์">${icon('more')}</button>
    </div>
    <div class="seg seg-sm proj-view">
      <label><input type="radio" name="pview" value="list" data-act="proj-view" data-pid="${p.id}" ${board ? '' : 'checked'}><span>${icon('list', 14)} รายการ</span></label>
      <label><input type="radio" name="pview" value="board" data-act="proj-view" data-pid="${p.id}" ${board ? 'checked' : ''}><span>${icon('board', 14)} บอร์ด</span></label>
    </div>`;
  const opts = { showProject: false, sortable: true };
  const loose = T.projectTasks(p.id, null);

  if (board) {
    const col = (title, tasks, sid) => `
      <section class="board-col">
        <div class="board-col-head">
          <b>${esc(title)}</b><span class="muted small">${tasks.length}</span>
          ${sid ? `<button class="icon-btn sm" data-act="section-menu" data-sid="${sid}" aria-label="ตัวเลือกหมวด">${icon('more', 16)}</button>` : ''}
        </div>
        ${taskList(tasks, opts, { projectId: p.id, sectionId: sid })}
      </section>`;
    return `${head}
      <div class="board">
        ${col('ทั่วไป', loose, null)}
        ${secs.map((s) => col(s.name, T.projectTasks(p.id, s.id), s.id)).join('')}
        <button class="board-add" data-act="new-section" data-pid="${p.id}">${icon('plus', 18)} เพิ่มหมวด</button>
      </div>`;
  }
  return `${head}
    ${taskList(loose, opts, { projectId: p.id })}
    ${secs
      .map(
        (s) => `<div class="section-label row-between sec-head"><b>${esc(s.name)}</b>
          <button class="icon-btn sm" data-act="section-menu" data-sid="${s.id}" aria-label="ตัวเลือกหมวด">${icon('more', 16)}</button></div>
          ${taskList(T.projectTasks(p.id, s.id), opts, { projectId: p.id, sectionId: s.id })}`
      )
      .join('')}
    <button class="add-section" data-act="new-section" data-pid="${p.id}">${icon('plus', 18)} เพิ่มหมวด</button>
  `;
}

function viewLabel(label) {
  return `
    <div class="proj-head">
      <button class="icon-btn" data-act="back" aria-label="กลับ">${icon('left')}</button>
      <span class="emoji-tile" style="--c:#8b5cf6">${icon('tag', 18)}</span>
      <h2>@${esc(label)}</h2>
    </div>
    ${taskList(T.labelTasks(label), {}, { labels: [label] })}
  `;
}

// ---------- ปัดซ้ายขวา (มือถือ): ขวา = เสร็จ, ซ้าย = เลื่อนวัน ----------

function swipeTask(e, item) {
  const task = () => store.get('tasks', item.dataset.id);
  startSwipe(e, item, {
    rowSel: '.task-row',
    onRight: () => task() && completeWithAnimation(item, task()),
    onLeft: () => task() && pickDate(task(), (v) => store.patch('tasks', item.dataset.id, v)),
  });
}

// ---------- ลากจัดลำดับ (จับที่จุด ⋮⋮) ----------

function startDrag(e, handle) {
  const item = handle.closest('.task-item');
  const list = item?.closest('[data-sortable]');
  if (!list) return;
  e.preventDefault();
  const others = [...list.querySelectorAll(':scope > .task-item')].filter((x) => x !== item);
  const y0 = e.clientY;
  let target = null;
  let after = false;
  item.classList.add('dragging');
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // ไม่มีผลต่อการลาก เพราะฟัง pointermove ที่ window อยู่แล้ว
  }

  // ไม่ย้าย DOM ระหว่างลาก แค่แสดงเส้นบอกตำแหน่งที่จะวาง แล้วค่อยบันทึกลำดับตอนปล่อย
  const move = (ev) => {
    item.style.transform = `translateY(${ev.clientY - y0}px)`;
    target = others.find((o) => {
      const r = o.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    after = !target;
    if (!target) target = others.at(-1) || null;
    others.forEach((o) => {
      o.classList.toggle('drop-before', o === target && !after);
      o.classList.toggle('drop-after', o === target && after);
    });
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    item.classList.remove('dragging');
    item.style.transform = '';
    others.forEach((o) => o.classList.remove('drop-before', 'drop-after'));
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 350);
    if (!target) return;
    const idx = others.indexOf(target) + (after ? 1 : 0);
    const get = (el) => el && store.get('tasks', el.dataset.id);
    const prev = get(others[idx - 1]);
    const next = get(others[idx]);
    const cur = store.get('tasks', item.dataset.id);
    const order = T.orderBetween(prev, next);
    if (cur && order !== cur.order) store.patch('tasks', cur.id, { order });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

// ---------- เพิ่มงาน (Quick Add) ----------

function findProject(name) {
  const n = name.toLowerCase();
  const list = T.projects();
  return list.find((p) => p.name.toLowerCase() === n) || list.find((p) => p.name.toLowerCase().startsWith(n)) || null;
}

export function openQuickAdd(ctx = {}) {
  const fresh = () => ({
    date: ctx.date ?? null,
    time: null,
    recur: null,
    priority: 4,
    projectId: ctx.projectId ?? null,
    sectionId: ctx.sectionId ?? null,
    labels: [...(ctx.labels || [])],
  });
  let state = fresh();
  let ignore = [];

  openSheet({
    title: 'เพิ่มงาน',
    body: `<form class="qa" novalidate>
      <input name="text" class="qa-input" placeholder="เช่น ส่งรายงาน พรุ่งนี้ บ่าย 2 #งาน p1" autocomplete="off" enterkeyhint="send" autofocus>
      <div class="qa-chips" data-chips></div>
      <textarea name="note" class="qa-note" rows="1" placeholder="คำอธิบาย (ถ้ามี)"></textarea>
      <div class="qa-tools">
        <button type="button" class="chip-btn" data-tool="date">${icon('plan', 16)} วันที่</button>
        <button type="button" class="chip-btn" data-tool="priority">${icon('flag', 16)} ความสำคัญ</button>
        <button type="button" class="chip-btn" data-tool="project">${icon('hash', 16)} โปรเจกต์</button>
        <button type="button" class="chip-btn" data-tool="labels">${icon('tag', 16)} ป้าย</button>
      </div>
      <div class="sheet-actions"><button class="btn btn-primary grow">เพิ่มงาน</button></div>
      <p class="hint">พิมพ์ในชื่องานได้เลย: วันนี้ · พรุ่งนี้ · วันศุกร์ · 20 ธ.ค. · 9 โมง · บ่าย 2 · ทุกวันจันทร์ · ทุกวันที่ 5 · #โปรเจกต์ · p1–p4 · @ป้าย</p>
    </form>`,
    onMount(sheet) {
      const form = sheet.querySelector('form');
      const input = form.elements.text;
      const chipsEl = sheet.querySelector('[data-chips]');

      // ค่าที่พิมพ์ในข้อความชนะค่าที่เลือกจากปุ่ม
      const compute = () => {
        const p = parseQuickAdd(input.value, { ignore });
        const proj = p.project ? findProject(p.project) : null;
        const projectId = p.project ? proj?.id ?? null : state.projectId;
        return {
          p,
          title: p.title,
          date: p.noDate ? null : p.date ?? state.date,
          time: p.noDate ? null : p.time ?? (p.date ? null : state.time),
          recur: p.recur ?? state.recur,
          priority: p.priority ?? state.priority,
          projectId,
          newProject: p.project && !proj ? p.project : null,
          sectionId: projectId === state.projectId ? state.sectionId : null,
          labels: [...new Set([...state.labels, ...p.labels])],
        };
      };

      const chip = (kind, html, extra = '') => `<span class="qa-chip ${kind}">${html}<button type="button" data-remove="${kind}" ${extra} aria-label="ไม่ใช้">${icon('x', 12)}</button></span>`;
      const drawChips = () => {
        const v = compute();
        const proj = T.project(v.projectId);
        const due = T.dueInfo(v.date, v.time);
        const parts = [];
        if (due) parts.push(chip('date', `${icon('plan', 13)} ${esc(due.label)}`));
        if (v.recur) parts.push(chip('recur', `${icon('repeat', 13)} ${esc(T.recurLabel(v.recur))}`));
        if (v.priority < 4) parts.push(chip('priority', `<i class="pdot" style="background:${T.PRIORITIES[v.priority].color}"></i>${T.PRIORITIES[v.priority].name}`));
        if (v.newProject) parts.push(chip('project', `${icon('hash', 13)} สร้าง "${esc(v.newProject)}"`));
        else if (proj) parts.push(chip('project', `${esc(proj.icon || '')} ${esc(proj.name)}`));
        for (const l of v.labels) parts.push(chip('label', `@${esc(l)}`, `data-label="${esc(l)}"`));
        chipsEl.innerHTML = parts.join('');
      };

      input.oninput = drawChips;
      drawChips();

      chipsEl.onclick = (e) => {
        const btn = e.target.closest('[data-remove]');
        if (!btn) return;
        const { p } = compute();
        const kind = btn.dataset.remove;
        if (kind === 'date') {
          ignore.push(...p.raws.date, ...p.raws.time);
          state.date = null;
          state.time = null;
        } else if (kind === 'recur') {
          ignore.push(...p.raws.recur);
          state.recur = null;
        } else if (kind === 'priority') {
          ignore.push(...p.raws.priority);
          state.priority = 4;
        } else if (kind === 'project') {
          ignore.push(...p.raws.project);
          state.projectId = null;
          state.sectionId = null;
        } else if (kind === 'label') {
          const l = btn.dataset.label;
          ignore.push(...p.raws.labels.filter((r) => r === `@${l}`));
          state.labels = state.labels.filter((x) => x !== l);
        }
        drawChips();
        input.focus();
      };

      sheet.querySelector('.qa-tools').onclick = (e) => {
        const tool = e.target.closest('[data-tool]')?.dataset.tool;
        const v = compute();
        if (tool === 'date')
          pickDate(v, (r) => {
            Object.assign(state, r);
            drawChips();
          });
        else if (tool === 'priority')
          pickPriority(v.priority, (n) => {
            state.priority = n;
            drawChips();
          });
        else if (tool === 'project')
          pickProject(v, (r) => {
            Object.assign(state, r);
            drawChips();
          });
        else if (tool === 'labels')
          pickLabels(v.labels, (labels) => {
            state.labels = labels;
            drawChips();
          });
      };

      form.onsubmit = (e) => {
        e.preventDefault();
        const v = compute();
        if (!v.title) {
          toast('พิมพ์ชื่องานก่อน');
          return input.focus();
        }
        let projectId = v.projectId;
        if (v.newProject) {
          projectId = store.put('projects', {
            name: v.newProject,
            icon: '📁',
            color: COLORS[T.projects().length % COLORS.length],
            order: T.projects().length,
            view: 'list',
          }).id;
        }
        store.put('tasks', {
          title: v.title,
          note: form.elements.note.value.trim(),
          date: v.date,
          time: v.date ? v.time : null,
          recur: v.date ? v.recur : null,
          priority: v.priority,
          projectId,
          sectionId: v.sectionId,
          labels: v.labels,
          done: false,
          order: T.nextOrder(),
          createdAt: Date.now(),
        });
        const due = T.dueInfo(v.date, v.time);
        toast(`เพิ่มแล้ว${due ? ` · ${due.label}` : ''}`);
        // พร้อมเพิ่มงานถัดไปทันที แบบ Todoist
        input.value = '';
        form.elements.note.value = '';
        state = fresh();
        ignore = [];
        drawChips();
        input.focus();
      };
    },
  });
}

// ---------- ตัวเลือกวันที่ / ความสำคัญ / โปรเจกต์ / ป้าย ----------

export function pickDate(cur, onPick, { allowRecur = true } = {}) {
  const t = today();
  const wd = weekday(t);
  const weekend = addDays(t, wd === 6 ? 7 : wd === 0 ? 6 : 6 - wd);
  const quick = [
    ['วันนี้', t],
    ['พรุ่งนี้', addDays(t, 1)],
    ['สุดสัปดาห์นี้', weekend],
    ['สัปดาห์หน้า', addDays(weekStart(t), 7)],
    ['ไม่มีวันที่', null],
  ];
  const r = cur.recur;
  const base = cur.date || t;
  const presets = {
    daily: { kind: 'daily' },
    workdays: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
    weekly: { kind: 'weekly', days: [weekday(base)] },
    monthly: { kind: 'monthly', day: Number(base.slice(8)) },
    yearly: { kind: 'yearly' },
  };
  const curKey = !r ? '' : Object.keys(presets).find((k) => T.recurLabel(presets[k]) === T.recurLabel(r)) || 'current';

  openSheet({
    title: 'กำหนดวัน',
    body: `<div class="form">
      <div class="date-quick">
        ${quick
          .map(
            ([label, d]) => `<button type="button" data-d="${d || ''}" class="${(cur.date || '') === (d || '') ? 'sel' : ''}">
              <span>${label}</span><small>${d ? `${TH_DAYS_SHORT[weekday(d)]} ${parseKey(d).getDate()}` : '—'}</small></button>`
          )
          .join('')}
      </div>
      <div class="field-row">
        <label class="field"><span>วันที่</span><input type="date" name="date" value="${cur.date || ''}"></label>
        <label class="field"><span>เวลา (ถ้ามี)</span><input type="time" name="time" value="${cur.time || ''}"></label>
      </div>
      ${
        allowRecur
          ? `<label class="field"><span>ทำซ้ำ</span>
              <select name="recur">
                <option value="">ไม่ทำซ้ำ</option>
                ${curKey === 'current' ? `<option value="current" selected>${esc(T.recurLabel(r))}</option>` : ''}
                ${Object.entries(presets).map(([k, v]) => `<option value="${k}" ${curKey === k ? 'selected' : ''}>${esc(T.recurLabel(v))}</option>`).join('')}
                <option value="custom">กำหนดเอง…</option>
              </select></label>
            <label class="field" data-custom hidden><span>พิมพ์รูปแบบ</span><input name="recurText" placeholder="เช่น ทุก 2 วัน, ทุกวันจันทร์และพฤหัส, ทุกวันที่ 15"></label>`
          : ''
      }
      <div class="sheet-actions"><button type="button" class="btn btn-primary grow" data-ok>ตกลง</button></div>
    </div>`,
    onMount(sheet, close) {
      const $ = (n) => sheet.querySelector(`[name=${n}]`);
      const recurSel = $('recur');
      const custom = sheet.querySelector('[data-custom]');
      if (recurSel) recurSel.onchange = () => (custom.hidden = recurSel.value !== 'custom');

      const readRecur = (date) => {
        if (!recurSel?.value) return null;
        if (recurSel.value === 'current') return r;
        if (recurSel.value === 'custom') return parseQuickAdd($('recurText').value).recur;
        const d = date || t;
        return { ...presets[recurSel.value], ...(recurSel.value === 'weekly' && { days: [weekday(d)] }), ...(recurSel.value === 'monthly' && { day: Number(d.slice(8)) }) };
      };
      // งานทำซ้ำ: เลื่อนวันกำหนดไปวันแรกที่ตรงรูปแบบ (เช่น ทุกจันทร์ แต่เลือกวันอังคาร -> จันทร์หน้า)
      const finish = (date) => {
        const recur = readRecur(date);
        if (recur) date = T.firstOccurrence(recur, date || t);
        onPick({ date: date || null, time: date ? $('time').value || null : null, recur: date ? recur : null });
        close();
      };
      sheet.querySelector('.date-quick').onclick = (e) => {
        const b = e.target.closest('[data-d]');
        if (b) finish(b.dataset.d || null);
      };
      sheet.querySelector('[data-ok]').onclick = () => finish($('date').value || null);
    },
  });
}

function pickPriority(cur, onPick) {
  openSheet({
    title: 'ความสำคัญ',
    body: `<div class="menu-list">${[1, 2, 3, 4]
      .map(
        (n) => `<button data-p="${n}"><span class="pflag" style="color:${T.PRIORITIES[n].color}">${icon('flag')}</span>
          ${T.PRIORITIES[n].name} · ${T.PRIORITIES[n].label}${n === cur ? ` <span class="muted">✓</span>` : ''}</button>`
      )
      .join('')}</div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = (e) => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        onPick(Number(b.dataset.p));
        close();
      };
    },
  });
}

function pickProject(cur, onPick) {
  const sel = (pid, sid) => (cur.projectId || null) === pid && (cur.sectionId || null) === sid;
  openSheet({
    title: 'ย้ายไปที่',
    body: `<div class="menu-list">
      <button data-pid="" data-sid="">${icon('inbox')} Inbox ${sel(null, null) ? '<span class="muted">✓</span>' : ''}</button>
      ${T.projects()
        .map(
          (p) => `<button data-pid="${p.id}" data-sid=""><span class="pemoji">${esc(p.icon || '📁')}</span> ${esc(p.name)} ${sel(p.id, null) ? '<span class="muted">✓</span>' : ''}</button>
            ${T.sections(p.id)
              .map((s) => `<button class="indent" data-pid="${p.id}" data-sid="${s.id}">${icon('subtask', 16)} ${esc(s.name)} ${sel(p.id, s.id) ? '<span class="muted">✓</span>' : ''}</button>`)
              .join('')}`
        )
        .join('')}
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = (e) => {
        const b = e.target.closest('[data-pid]');
        if (!b) return;
        onPick({ projectId: b.dataset.pid || null, sectionId: b.dataset.sid || null });
        close();
      };
    },
  });
}

function pickLabels(cur, onPick) {
  const chosen = new Set(cur);
  const all = [...new Set([...T.allLabels().map(([l]) => l), ...cur])];
  openSheet({
    title: 'ป้ายกำกับ',
    body: `<form class="form" novalidate>
      <div class="chips" data-list>
        ${all.map((l) => `<label class="chip"><input type="checkbox" value="${esc(l)}" ${chosen.has(l) ? 'checked' : ''}><span>@${esc(l)}</span></label>`).join('') || '<p class="hint">ยังไม่มีป้าย</p>'}
      </div>
      <label class="field"><span>ป้ายใหม่</span><input name="newLabel" placeholder="เช่น ด่วน, โทร, ข้างนอก" maxlength="24" autocomplete="off"></label>
      <div class="sheet-actions"><button class="btn btn-primary grow">ตกลง</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const labels = [...form.querySelectorAll('[data-list] input:checked')].map((x) => x.value);
        for (const l of form.elements.newLabel.value.split(/[,\s]+/)) {
          const name = l.replace(/^@/, '').trim();
          if (name && !labels.includes(name)) labels.push(name);
        }
        onPick(labels);
        close();
      };
    },
  });
}

// ---------- รายละเอียดงาน (บันทึกทันทีที่แก้) ----------

export function openTask(t) {
  const where = () => {
    const p = T.project(t.projectId);
    const s = t.sectionId ? store.get('sections', t.sectionId) : null;
    return p ? `${p.icon || '📁'} ${p.name}${s ? ` / ${s.name}` : ''}` : 'Inbox';
  };
  openSheet({
    title: where(),
    body: '<div data-task></div>',
    onMount(sheet, close) {
      const box = sheet.querySelector('[data-task]');
      const draw = () => {
        t = store.get('tasks', t.id);
        if (!t) return close();
        sheet.querySelector('.sheet-head h2').textContent = where();
        const p = T.prio(t);
        const due = T.dueInfo(t.date, t.time);
        const subs = T.subtasks(t.id);
        const subsDone = subs.filter((s) => s.done).length;
        box.innerHTML = `
          <div class="td-head">
            <button class="tcheck p${p} ${t.done ? 'on' : ''}" data-a="toggle" aria-label="ทำเสร็จ">${icon('check', 14)}</button>
            <input class="td-title" data-f="title" value="${esc(t.title)}" aria-label="ชื่องาน">
          </div>
          <textarea class="td-note" rows="2" data-f="note" placeholder="คำอธิบาย">${esc(t.note || '')}</textarea>
          <div class="td-props">
            <button class="td-prop" data-a="date">${icon('plan')}<span>วันที่</span>
              <b class="due ${due?.cls || ''}">${due ? esc(due.label) : 'ไม่มี'}${t.recur ? ` · ${esc(T.recurLabel(t.recur))}` : ''}</b></button>
            <button class="td-prop" data-a="priority"><span class="pflag" style="color:${T.PRIORITIES[p].color}">${icon('flag')}</span><span>ความสำคัญ</span>
              <b>${T.PRIORITIES[p].name} · ${T.PRIORITIES[p].label}</b></button>
            <button class="td-prop" data-a="project">${icon('hash')}<span>อยู่ใน</span><b>${esc(where())}</b></button>
            <button class="td-prop" data-a="labels">${icon('tag')}<span>ป้าย</span><b>${(t.labels || []).map((l) => `@${esc(l)}`).join(' ') || 'ไม่มี'}</b></button>
          </div>
          ${
            t.parentId
              ? ''
              : `<div class="section-label row-between"><span>งานย่อย</span><span class="muted">${subs.length ? `${subsDone}/${subs.length}` : ''}</span></div>
                ${subs.length ? progress(subsDone / subs.length) : ''}
                <div class="list card subs">
                  ${subs
                    .map(
                      (s) => `<div class="row sub-row ${s.done ? 'is-done' : ''}" data-sid="${s.id}">
                        <button class="tcheck p4 ${s.done ? 'on' : ''}" data-a="sub-toggle" aria-label="ทำเสร็จ">${icon('check', 12)}</button>
                        <input class="sub-title" value="${esc(s.title)}" data-sub-title aria-label="ชื่องานย่อย">
                        <button class="icon-btn sm" data-a="sub-del" aria-label="ลบงานย่อย">${icon('x', 16)}</button>
                      </div>`
                    )
                    .join('')}
                  <form class="add-sub" data-subform><span class="tcheck p4 ghost">${icon('plus', 12)}</span><input name="sub" placeholder="เพิ่มงานย่อย" autocomplete="off" enterkeyhint="done"></form>
                </div>`
          }
          <div class="sheet-actions td-foot">
            <span class="muted small grow">สร้างเมื่อ ${fmtDate(toKey(new Date(t.createdAt || Date.now())))}</span>
            <button class="btn btn-danger-ghost" data-a="delete">${icon('trash', 18)} ลบ</button>
          </div>`;
      };
      draw();

      box.addEventListener('change', (e) => {
        const f = e.target.dataset.f;
        if (f === 'title') {
          const v = e.target.value.trim();
          if (v) store.patch('tasks', t.id, { title: v });
          else e.target.value = t.title;
        } else if (f === 'note') store.patch('tasks', t.id, { note: e.target.value.trim() });
        else if (e.target.matches('[data-sub-title]')) {
          const sid = e.target.closest('[data-sid]').dataset.sid;
          const v = e.target.value.trim();
          if (v) store.patch('tasks', sid, { title: v });
        }
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('.td-title, [data-sub-title]')) e.target.blur();
      });
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.elements.sub;
        const title = input.value.trim();
        if (!title) return;
        store.put('tasks', { title, parentId: t.id, projectId: t.projectId || null, priority: 4, labels: [], done: false, order: T.nextOrder(), createdAt: Date.now() });
        draw();
        box.querySelector('[data-subform] input').focus();
      });
      box.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        const sid = e.target.closest('[data-sid]')?.dataset.sid;
        if (a === 'toggle') {
          toggleTask(t);
          return draw();
        }
        if (a === 'sub-toggle') {
          const s = store.get('tasks', sid);
          if (s.done) T.uncomplete(s);
          else T.complete(s);
          return draw();
        }
        if (a === 'sub-del') {
          store.remove('tasks', sid);
          return draw();
        }
        if (a === 'date') return pickDate(t, (v) => (store.patch('tasks', t.id, v), draw()));
        if (a === 'priority') return pickPriority(T.prio(t), (priority) => (store.patch('tasks', t.id, { priority }), draw()));
        if (a === 'project')
          return pickProject(t, (v) => {
            store.batch(() => {
              store.patch('tasks', t.id, v);
              for (const s of T.subtasks(t.id)) store.patch('tasks', s.id, { projectId: v.projectId });
            });
            draw();
          });
        if (a === 'labels') return pickLabels(t.labels || [], (labels) => (store.patch('tasks', t.id, { labels }), draw()));
        if (a === 'delete') {
          const n = T.subtasks(t.id).length;
          if (!(await confirmBox(`ลบงาน "${t.title}"${n ? ` และงานย่อย ${n} รายการ` : ''}?`, { ok: 'ลบ', danger: true }))) return;
          T.removeTask(t);
          close();
          toast('ลบแล้ว');
        }
      });
    },
  });
}

// ---------- โปรเจกต์และหมวด ----------

const PROJECT_ICONS = ['📁', '💼', '🏠', '📚', '🎯', '💡', '🛒', '✈️', '💰', '❤️', '🏃', '🎨', '🧑‍💻', '🍳', '🎓', '🌱'];

function editProject(p) {
  const isNew = !p;
  p ??= { name: '', icon: '📁', color: COLORS[T.projects().length % COLORS.length], view: 'list' };
  openSheet({
    title: isNew ? 'เพิ่มโปรเจกต์' : 'แก้ไขโปรเจกต์',
    body: `<form class="form" novalidate>
      <label class="field"><span>ชื่อโปรเจกต์</span><input name="name" value="${esc(p.name)}" maxlength="40" placeholder="เช่น ทริปญี่ปุ่น, ย้ายบ้าน" autofocus></label>
      <div class="field"><span>ไอคอน</span>
        <div class="emoji-pick inline">${PROJECT_ICONS.map((e) => `<label><input type="radio" name="icon" value="${e}" ${e === p.icon ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
      </div>
      <div class="field"><span>สี</span>${colorPicker(COLORS, p.color)}</div>
      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash', 18)} ลบ</button>`}
        <button class="btn btn-primary grow">บันทึก</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return form.elements.name.focus();
        const id = p.id || uid();
        // โปรเจกต์ใหม่: เปิดหน้าโปรเจกต์นั้นเลย (ตั้งค่าก่อนบันทึก หน้าจอจะวาดใหม่หลังบันทึก)
        if (isNew) {
          tab = 'projects';
          openProjectId = id;
          openLabel = null;
        }
        store.put('projects', { ...p, id, name, icon: form.elements.icon.value || '📁', color: form.elements.color.value, order: p.order ?? T.projects().length });
        close();
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const n = T.openCount(p.id);
        if (!(await confirmBox(`ลบโปรเจกต์ "${p.name}"?${n ? ` งาน ${n} รายการจะย้ายไป Inbox` : ''}`, { ok: 'ลบ', danger: true }))) return;
        deleteProject(p);
        close();
      });
    },
  });
}

function deleteProject(p) {
  store.batch(() => {
    for (const t of store.all('tasks')) if (t.projectId === p.id) store.patch('tasks', t.id, { projectId: null, sectionId: null });
    for (const s of T.sections(p.id)) store.remove('sections', s.id);
    store.remove('projects', p.id);
  });
  openProjectId = null;
  toast('ลบโปรเจกต์แล้ว');
}

function projectMenu(p) {
  openSheet({
    title: `${p.icon || '📁'} ${p.name}`,
    body: `<div class="menu-list">
      <button data-m="edit">${icon('edit')} แก้ไขชื่อ ไอคอน สี</button>
      <button data-m="section">${icon('plus')} เพิ่มหมวด</button>
      <button data-m="delete" class="danger">${icon('trash')} ลบโปรเจกต์</button>
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = async (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        close();
        if (m === 'edit') editProject(p);
        else if (m === 'section') editSection({ projectId: p.id });
        else if (await confirmBox(`ลบโปรเจกต์ "${p.name}"? งานที่ยังไม่เสร็จจะย้ายไป Inbox`, { ok: 'ลบ', danger: true })) deleteProject(p);
      };
    },
  });
}

function editSection(s) {
  const isNew = !s.id;
  openSheet({
    title: isNew ? 'เพิ่มหมวด' : 'แก้ไขหมวด',
    body: `<form class="form" novalidate>
      <label class="field"><span>ชื่อหมวด</span><input name="name" value="${esc(s.name || '')}" maxlength="40" placeholder="เช่น ต้องทำ, กำลังทำ, รอคนอื่น" autofocus></label>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return form.elements.name.focus();
        store.put('sections', { ...s, name, order: s.order ?? T.sections(s.projectId).length });
        close();
      };
    },
  });
}

function sectionMenu(s) {
  openSheet({
    title: s.name,
    body: `<div class="menu-list">
      <button data-m="edit">${icon('edit')} เปลี่ยนชื่อ</button>
      <button data-m="delete" class="danger">${icon('trash')} ลบหมวด</button>
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = async (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        close();
        if (m === 'edit') return editSection(s);
        if (!(await confirmBox(`ลบหมวด "${s.name}"? งานในหมวดนี้จะย้ายไปหมวด "ทั่วไป"`, { ok: 'ลบ', danger: true }))) return;
        store.batch(() => {
          for (const t of store.all('tasks')) if (t.sectionId === s.id) store.patch('tasks', t.id, { sectionId: null });
          store.remove('sections', s.id);
        });
      };
    },
  });
}

// ---------- ความคืบหน้า + ประวัติงานที่เสร็จ ----------

function openStats() {
  openSheet({
    title: 'ความคืบหน้า',
    body: '<div data-stats></div>',
    onMount(sheet) {
      const box = sheet.querySelector('[data-stats]');
      const draw = () => {
        const t = today();
        const g = T.goals();
        const counts = T.completedCounts();
        const todayN = counts.get(t) || 0;
        const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
        const max = Math.max(g.daily, ...days.map((d) => counts.get(d) || 0), 1);
        const total = store.all('taskLog').length;
        const history = [];
        for (let i = 0; i < 14; i++) {
          const d = addDays(t, -i);
          const logs = T.doneTasksOn(d);
          if (logs.length) history.push([d, logs]);
        }
        box.innerHTML = `
          <div class="ring-card">
            ${ring(todayN / g.daily, 'var(--accent)', 'วันนี้')}
            <div class="kv">
              <div><span>วันนี้</span><b>${todayN}/${g.daily} งาน</b></div>
              <div><span>สัปดาห์นี้</span><b>${T.weekDone()}/${g.weekly} งาน</b></div>
              <div><span>ถึงเป้าติดกัน</span><b>${T.goalStreak()} วัน</b></div>
              <div><span>ทำเสร็จทั้งหมด</span><b>${total} งาน</b></div>
            </div>
          </div>
          <div class="bars task-bars">
            ${days
              .map((d) => {
                const n = counts.get(d) || 0;
                return `<div class="bar-col ${d === t ? 'today' : ''}">
                  <span class="bar-num">${n || ''}</span>
                  <div class="bar ${n >= g.daily ? 'hit' : ''}"><span style="height:${Math.round((n / max) * 100)}%"></span></div>
                  <span class="bar-label">${TH_DAYS_SHORT[weekday(d)]}<br>${parseKey(d).getDate()}</span>
                </div>`;
              })
              .join('')}
          </div>
          <div class="field-row goal-fields">
            <label class="field"><span>เป้าต่อวัน (งาน)</span><input type="number" inputmode="numeric" min="1" max="99" data-goal="dailyGoal" value="${g.daily}"></label>
            <label class="field"><span>เป้าต่อสัปดาห์ (งาน)</span><input type="number" inputmode="numeric" min="1" max="500" data-goal="weeklyGoal" value="${g.weekly}"></label>
          </div>
          <h3 class="section-label">งานที่เสร็จ 14 วันล่าสุด</h3>
          ${
            history.length
              ? history
                  .map(
                    ([d, logs]) => `<div class="day-head"><b>${d === t ? 'วันนี้' : d === addDays(t, -1) ? 'เมื่อวาน' : `วัน${TH_DAYS[weekday(d)]} ${fmtDate(d)}`}</b> <span class="muted">${logs.length} งาน</span></div>
                    <div class="list card">${logs
                      .map((l) => {
                        const p = T.project(l.projectId);
                        return `<div class="row done-row"><span class="tcheck on">${icon('check', 12)}</span>
                          <span class="row-text"><span class="t-title">${esc(l.title)}</span>${p ? `<span class="t-meta"><span class="proj"><i style="background:${p.color}"></i>${esc(p.name)}</span></span>` : ''}</span></div>`;
                      })
                      .join('')}</div>`
                  )
                  .join('')
              : emptyState('ยังไม่มีงานที่ทำเสร็จ')
          }`;
      };
      draw();
      box.addEventListener('change', (e) => {
        const key = e.target.dataset.goal;
        if (!key) return;
        const v = Math.max(1, parseInt(e.target.value, 10) || 1);
        store.setSettings({ [key]: v });
        draw();
      });
    },
  });
}
