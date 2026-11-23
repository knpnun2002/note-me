import * as store from '../store.js';
import * as L from '../logic.js';
import * as sync from '../sync.js';
import { today, fmtDateLong, monthOf, money } from '../utils.js';
import { icon, progress, emptyState } from '../ui.js';
import { habitRow, habitAction } from './habits.js';
import * as T from '../tasks.js';
import * as F from '../finance.js';
import { taskRow, taskAction, openQuickAdd } from './plan.js';
import { summaryCard, txRow, goalCard, editTransaction, addToGoal } from './money.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'สวัสดีตอนเช้า';
  if (h < 16) return 'สวัสดีตอนบ่าย';
  if (h < 19) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

export function render(root) {
  const t = today();
  const hp = L.dayProgress(t);
  const habits = hp.list;
  const tasks = T.tasksOn(t);
  const openTasks = [...T.overdueTasks(), ...tasks];
  const doneToday = T.doneTasksOn(t).length;
  const s = L.monthSummary(monthOf(t));
  const safe = F.safeToSpend();
  const pendingSlips = store.all('transactions').filter((x) => x.status === 'pending').length;
  const recent = L.monthTransactions(monthOf(t)).slice(0, 3);
  const goals = store.all('goals').filter((g) => (g.saved || 0) < g.target).slice(0, 2);
  const hasData = store.all('habits').length + store.all('transactions').length + store.all('tasks').length > 0;

  let notice = '';
  if (sync.status.state === 'needAuth') {
    notice = `<div class="notice">${icon('cloud')}<span>ต้องเข้าสู่ระบบ Google อีกครั้งเพื่อซิงค์ข้อมูล</span><button class="btn btn-sm" data-act="reconnect">เชื่อมต่อ</button></div>`;
  } else if (!sync.isConnected() && hasData && sync.isBackupDue()) {
    notice = `<div class="notice">${icon('download')}<span>ถึงเวลาสำรองข้อมูลแล้ว</span><button class="btn btn-sm" data-act="backup">ดาวน์โหลด</button></div>`;
  }

  root.innerHTML = `
    <header class="hello">
      <p class="muted">${fmtDateLong(t)}</p>
      <h1>${greeting()}</h1>
    </header>
    ${notice}

    <section>
      <div class="section-label row-between"><span>กิจวัตรวันนี้</span><a class="link" href="#/habits">${hp.allDone ? 'ทำครบแล้ว 🎉' : hp.total ? `${hp.done}/${hp.total}` : 'ดูทั้งหมด'}</a></div>
      <div class="card">
        ${habits.length ? `${hp.total ? `<div class="pad-x">${progress(hp.done / hp.total)}</div>` : ''}<div class="list">${habits.map((h) => habitRow(h, t)).join('')}</div>` : emptyState('ยังไม่มีกิจวัตรสำหรับวันนี้')}
      </div>
    </section>

    <section>
      <div class="section-label row-between"><span>งานวันนี้</span><a class="link" href="#/plan">${openTasks.length ? `เหลือ ${openTasks.length}` : 'ดูทั้งหมด'}</a></div>
      <div class="list card tasks">
        ${openTasks.length ? openTasks.slice(0, 5).map((x) => taskRow(x, { showDate: x.date !== t })).join('') : emptyState(doneToday ? 'ทำครบทุกงานแล้ว 👏' : 'ไม่มีงานวันนี้')}
        <button class="add-row" data-act="quick-task">${icon('plus', 18)} เพิ่มงาน</button>
      </div>
    </section>

    <section>
      <div class="section-label row-between"><span>การเงินเดือนนี้</span><a class="link" href="#/money">ดูทั้งหมด</a></div>
      <a class="card pad hero mini" href="#/money">
        <span class="muted small">เหลือใช้จริงเดือนนี้</span>
        <div class="hero-amount">${money(Math.max(0, safe.left))}</div>
        <p class="hero-day">ใช้ได้วันละ ~<b>${money(Math.floor(safe.perDay))}</b> · อีก ${safe.daysLeft} วันสิ้นเดือน</p>
        ${pendingSlips ? `<p class="hero-note">สลิปรอยืนยัน ${pendingSlips} รายการ ›</p>` : ''}
      </a>
      ${summaryCard(s)}
      <div class="quick-money">
        <button class="btn" data-act="expense">${icon('minus', 18)} รายจ่าย</button>
        <button class="btn" data-act="income">${icon('plus', 18)} รายรับ</button>
      </div>
      ${recent.length ? `<div class="list card">${recent.map(txRow).join('')}</div>` : ''}
    </section>

    ${goals.length ? `<section><div class="section-label row-between"><span>เป้าออม</span><a class="link" href="#/money" data-goals>ดูทั้งหมด</a></div>${goals.map(goalCard).join('')}</section>` : ''}
  `;

  root.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.closest('[data-id]')?.dataset.id;
    if (el.closest('.habit-row') && habitAction(el.dataset.act, store.get('habits', id), t)) return;
    if (el.closest('.task-item') && taskAction(el.dataset.act, store.get('tasks', id))) return;
    switch (el.dataset.act) {
      case 'quick-task':
        return openQuickAdd({ date: t });
      case 'expense':
      case 'income':
        return editTransaction(null, el.dataset.act);
      case 'tx':
        return editTransaction(store.get('transactions', id));
      case 'goal':
        location.hash = '#/money';
        return;
      case 'goal-add':
        return addToGoal(store.get('goals', id));
      case 'reconnect':
        return sync.connect();
      case 'backup':
        sync.downloadToDevice();
        return render(root);
    }
  };
}
