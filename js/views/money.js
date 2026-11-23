// หน้าการเงินแบบ Ebbly: เหลือใช้จริง, พิมพ์/สแกนสลิป, รอยืนยัน, บิลที่ใกล้ถึง, กระเป๋า, ยืม/หาร, ลดหย่อนภาษี

import * as store from '../store.js';
import * as L from '../logic.js';
import * as F from '../finance.js';
import * as slips from '../slips.js';
import * as pp from '../promptpay.js';
import { esc, uid, today, monthOf, addMonths, fmtMonth, fmtDate, relDay, money, parseAmount, dayDiff, COLORS } from '../utils.js';
import { icon, openSheet, confirmBox, toast, progress, colorPicker, emptyState, startSwipe, shareOrCopy } from '../ui.js';

let tab = 'overview';
let month = monthOf(today());
let loanMode = 'loans';

const TABS = { overview: 'ภาพรวม', list: 'รายการ', bills: 'บิล', loans: 'ยืม/หาร', goals: 'เป้าออม' };

const catOf = (id) => store.get('categories', id) || { name: 'ไม่มีหมวด', color: '#9ca3af' };
const pending = () => store.all('transactions').filter((t) => t.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);

export function render(root) {
  root.innerHTML = `
    <header class="page-head">
      <h1>การเงิน</h1>
      <div class="head-actions">
        <button class="icon-btn" data-act="scan" aria-label="สแกนสลิป">${icon('scan', 22)}</button>
        <button class="icon-btn" data-act="menu" aria-label="เมนูการเงิน">${icon('more', 22)}</button>
      </div>
    </header>
    <nav class="tabs" role="tablist">
      ${Object.entries(TABS).map(([k, v]) => `<button role="tab" class="${k === tab ? 'sel' : ''}" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join('')}
    </nav>
    ${{ overview, list, bills: billsTab, loans: loansTab, goals }[tab]()}
    <div class="fab-space"></div>
    <button class="fab" data-act="add" aria-label="เพิ่ม">${icon('plus', 26)}</button>
    <input type="file" accept="image/*" multiple hidden data-slips>
  `;

  const fileInput = root.querySelector('[data-slips]');
  fileInput.onchange = () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) runImport(files, root);
  };

  root.onclick = async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      return render(root);
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.closest('[data-id]')?.dataset.id;
    switch (el.dataset.act) {
      case 'add':
        if (tab === 'bills') return editBill();
        if (tab === 'goals') return editGoal();
        if (tab === 'loans') return loanMode === 'loans' ? editLoan() : editSplit();
        return editTransaction();
      case 'scan':
        return fileInput.click();
      case 'menu':
        return moneyMenu(root);
      case 'month':
        month = el.dataset.d === '0' ? monthOf(today()) : addMonths(month, Number(el.dataset.d));
        return render(root);
      case 'tx':
        return editTransaction(store.get('transactions', id));
      case 'confirm':
        return confirmTx(store.get('transactions', id));
      case 'confirm-all':
        return confirmAll();
      case 'wallet':
        return walletSheet(store.get('wallets', id));
      case 'add-wallet':
        return editWallet();
      case 'set-balances':
        return walletsSheet();
      case 'budget':
        return editBudgets();
      case 'pay-bill': {
        const r = store.get('recurring', id);
        return payBillSheet(r, el.dataset.mk);
      }
      case 'bill':
        return editBill(store.get('recurring', id));
      case 'bill-suggest-add': {
        const s = F.billSuggestions().find((x) => x.key === el.dataset.key);
        return s && editBill(null, s);
      }
      case 'bill-suggest-no':
        F.dismissBillSuggestion(el.dataset.key);
        return toast('จะไม่แนะนำอีก');
      case 'rec-toggle': {
        const r = store.get('recurring', id);
        store.patch('recurring', id, { active: !r.active });
        if (!r.active) L.generateRecurring();
        return;
      }
      case 'loan-mode':
        loanMode = el.value;
        return render(root);
      case 'loan':
        return loanSheet(store.get('loans', id));
      case 'split':
        return splitSheet(store.get('splits', id));
      case 'goal':
        return editGoal(store.get('goals', id));
      case 'goal-add':
        return addToGoal(store.get('goals', id));
    }
  };

  // พิมพ์ด่วน: แสดงว่าแอปเข้าใจอะไรระหว่างพิมพ์
  const quick = root.querySelector('[data-quick]');
  if (quick) {
    const preview = root.querySelector('[data-preview]');
    const input = quick.elements.text;
    input.oninput = () => (preview.innerHTML = input.value.trim() ? quickPreview(F.parseMoney(input.value)) : '');
    quick.onsubmit = (e) => {
      e.preventDefault();
      const p = F.parseMoney(input.value);
      if (!p.amount) return toast('ใส่จำนวนเงินด้วย เช่น กาแฟ 65');
      const tx = saveTx({
        type: p.type,
        amount: p.amount,
        payee: p.type === 'transfer' ? '' : p.payee,
        categoryId: p.categoryId,
        walletId: p.walletId || F.defaultWalletId(),
        toWalletId: p.toWalletId,
        date: p.date || today(),
      });
      toast(`บันทึก ${money(tx.amount)}${tx.type === 'transfer' ? ' · โอน' : ` · ${catOf(tx.categoryId).name}`} · ${F.wallet(tx.walletId)?.name || ''}`);
      setTimeout(() => root.querySelector('[data-quick] input')?.focus(), 0);
    };
  }

  // ปัดรายการรอยืนยัน: ขวา = ยืนยัน, ซ้าย = แก้
  root.onpointerdown = (e) => {
    const item = e.target.closest('.pending-item');
    if (!item || e.pointerType === 'mouse') return;
    startSwipe(e, item, {
      onRight: () => confirmTx(store.get('transactions', item.dataset.id)),
      onLeft: () => editTransaction(store.get('transactions', item.dataset.id)),
    });
  };
}

function quickPreview(p) {
  const parts = [];
  if (p.type === 'transfer') parts.push(`โอน ${esc(F.wallet(p.walletId)?.name || '')} → ${esc(F.wallet(p.toWalletId)?.name || '')}`);
  else parts.push(p.type === 'income' ? 'รายรับ' : 'รายจ่าย');
  parts.push(p.amount ? `<b>${money(p.amount)}</b>` : '<span class="warn">ยังไม่มียอด</span>');
  if (p.type !== 'transfer') parts.push(esc(catOf(p.categoryId).name));
  if (p.type !== 'transfer') parts.push(esc(F.wallet(p.walletId || F.defaultWalletId())?.name || ''));
  parts.push(relDay(p.date || today()));
  return parts.join(' · ');
}

function saveTx(fields, { confirm = true } = {}) {
  const tx = { ...fields, createdAt: fields.createdAt || Date.now() };
  if (confirm) delete tx.status;
  if (tx.type !== 'transfer') delete tx.toWalletId;
  const saved = store.put('transactions', tx);
  F.rememberPayee(saved);
  if (saved.walletId && saved.walletId !== store.settings().lastWalletId) store.setSettings({ lastWalletId: saved.walletId }, { silent: true });
  return saved;
}

function confirmTx(t) {
  if (!t) return;
  if (!(t.amount > 0)) return editTransaction(t);
  saveTx(t);
  toast(`ยืนยันแล้ว ${money(t.amount)}`);
}

async function confirmAll() {
  const list = pending().filter((t) => t.amount > 0);
  if (!list.length) return;
  if (!(await confirmBox(`ยืนยันสลิปทั้งหมด ${list.length} รายการ?`, { ok: 'ยืนยันทั้งหมด' }))) return;
  store.batch(() => list.forEach((t) => saveTx(t)));
  toast(`ยืนยันแล้ว ${list.length} รายการ`);
}

async function runImport(files, root) {
  let close = () => {};
  openSheet({
    title: 'กำลังอ่านสลิป',
    body: `<div class="scan-progress">
      <div class="spinner" aria-hidden="true"></div>
      <p data-status>กำลังเตรียม…</p>
      <p class="hint">อ่านในเครื่อง รูปไม่ถูกส่งไปที่ไหน · ครั้งแรกต้องโหลดตัวอ่านภาษาไทย อาจใช้เวลาสักครู่</p>
    </div>`,
    onMount(sheet, c) {
      close = c;
    },
  });
  const status = document.querySelector('.scan-progress [data-status]');
  const steps = { 'loading tesseract core': 'กำลังโหลดตัวอ่าน', 'loading language traineddata': 'กำลังโหลดภาษาไทย', 'initializing api': 'กำลังเตรียม', 'recognizing text': 'กำลังอ่าน' };
  try {
    const r = await slips.importSlips(files, ({ index, total, status: s, progress: pr }) => {
      if (status) status.textContent = `สลิป ${index}/${total} · ${steps[s] || 'กำลังอ่าน'}${pr ? ` ${Math.round(pr * 100)}%` : ''}`;
    });
    close();
    tab = 'overview';
    const msg = [r.added && `อ่านแล้ว ${r.added} ใบ รอยืนยัน`, r.duplicates && `ซ้ำ ${r.duplicates} ใบ (ข้าม)`, r.failed && `อ่านไม่ได้ ${r.failed} ใบ`].filter(Boolean).join(' · ');
    toast(msg || 'ไม่มีสลิปใหม่');
    render(root);
  } catch (e) {
    console.error(e);
    close();
    toast('อ่านสลิปไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตตอนใช้ครั้งแรกแล้วลองใหม่');
  }
}

// ---------- ภาพรวม ----------

function overview() {
  const s = F.safeToSpend();
  const pend = pending();
  const upcoming = F.upcomingBills();
  const suggestions = F.billSuggestions();
  const ws = F.wallets();
  const total = ws.reduce((n, w) => n + (F.walletBalance(w) ?? 0), 0);
  const allSet = ws.length && ws.every((w) => w.initialBalance != null);
  const mk = monthOf(today());
  const sum = L.monthSummary(mk);
  const left = Math.max(0, s.left);
  const barTotal = s.spent + s.billsTotal + left || 1;

  return `
    <section class="card pad hero">
      <span class="muted small">เหลือใช้จริงเดือนนี้</span>
      <div class="hero-amount">${money(left)}</div>
      <div class="hero-bar" aria-hidden="true">
        <span class="spent" style="width:${(s.spent / barTotal) * 100}%"></span>
        <span class="bills" style="width:${(s.billsTotal / barTotal) * 100}%"></span>
        <span class="left" style="width:${(left / barTotal) * 100}%"></span>
      </div>
      <div class="hero-legend small">
        <span><i class="lg-spent"></i>ใช้ไป ${money(s.spent)}</span>
        <span><i class="lg-bills"></i>บิลที่ยังไม่จ่าย ${money(s.billsTotal)}</span>
      </div>
      <p class="hero-day">อีก ${s.daysLeft} วันสิ้นเดือน · ใช้ได้วันละ ~<b>${money(Math.floor(s.perDay))}</b></p>
      ${s.left < 0 ? `<p class="hero-note">ใช้เกินไป ${money(-s.left)} เดือนหน้าค่อยว่ากันใหม่ 🌱</p>` : ''}
      <p class="hint">${
        s.mode === 'wallets'
          ? `คิดจากเงินในกระเป๋า ${money(s.cash)} หักบิลที่ยังไม่จ่าย`
          : `คิดจากรายรับเดือนนี้ ${money(s.income)} · <button class="link" data-act="set-balances">ใส่ยอดในกระเป๋า</button> เพื่อคิดจากเงินที่มีจริง`
      }</p>
    </section>

    <form class="card money-quick" data-quick autocomplete="off">
      <input name="text" placeholder="พิมพ์หรือพูด เช่น กาแฟ 65 ทรูมันนี่" enterkeyhint="done" aria-label="บันทึกด่วน">
      <button type="button" class="icon-btn accent" data-act="scan" aria-label="สแกนสลิป">${icon('scan', 20)}</button>
    </form>
    <p class="quick-preview" data-preview></p>

    ${
      pend.length
        ? `<div class="section-label row-between"><span>สลิปรอยืนยัน <b class="badge">${pend.length}</b></span><button class="link" data-act="confirm-all">ยืนยันทั้งหมด</button></div>
          <div class="list card">${pend.map(pendingRow).join('')}</div>
          <p class="hint center">ปัดขวายืนยัน · ปัดซ้ายแก้ · หรือแตะเพื่อดูรายละเอียด</p>`
        : ''
    }

    ${suggestions
      .map(
        (x) => `<div class="card pad suggest">
          <div><b>เจอบิลประจำ</b> <span class="muted small">${x.months} เดือนติด</span></div>
          <div class="small">${esc(x.payee)} ${money(x.amount)} · ทุกวันที่ ${x.day}</div>
          <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="bill-suggest-add" data-key="${esc(x.key)}">เพิ่มเป็นบิลประจำ</button>
          <button class="btn btn-sm" data-act="bill-suggest-no" data-key="${esc(x.key)}">ไม่ใช่</button></div>
        </div>`
      )
      .join('')}

    <div class="section-label row-between"><span>บิลที่ใกล้ถึง</span><button class="link" data-tab="bills">ทั้งหมด</button></div>
    <div class="list card">${upcoming.length ? upcoming.map(billRow).join('') : emptyState('ไม่มีบิลที่ต้องจ่ายเร็วๆ นี้')}</div>

    <div class="section-label row-between"><span>กระเป๋า${allSet ? ` · รวม ${money(total)}` : ''}</span><button class="link" data-act="add-wallet">+ เพิ่ม</button></div>
    <div class="wallet-strip">
      ${ws
        .map(
          (w) => `<button class="wallet-card" data-act="wallet" data-id="${w.id}" style="--c:${w.color}">
            <span class="wbadge">${esc(w.badge || w.name.slice(0, 2))}</span>
            <span class="wname">${esc(w.name)}</span>
            <b class="${F.walletBalance(w) == null ? 'muted' : ''}">${F.fmtBalance(w)}</b>
          </button>`
        )
        .join('')}
    </div>

    <div class="section-label row-between"><span>${fmtMonth(mk)}</span><button class="link" data-act="budget">หมวดและงบ</button></div>
    ${summaryCard(sum)}
    ${budgetCard(sum)}
    ${categoryCard(sum)}
  `;
}

function pendingRow(t) {
  const c = catOf(t.categoryId);
  const w = F.wallet(t.walletId);
  const bill = t.recurringId ? store.get('recurring', t.recurringId) : null;
  return `<div class="pending-item swipe-item" data-id="${t.id}">
    <div class="swipe-bg" aria-hidden="true"><span class="sw-done">${icon('check', 18)} ยืนยัน</span><span class="sw-date">แก้ ${icon('edit', 18)}</span></div>
    <div class="row">
      <button class="row-main" data-act="tx">
        <span class="avatar" style="--c:${c.color}">${esc((t.payee || c.name).trim().slice(0, 1) || '?')}</span>
        <span class="row-text">
          <span class="row-title">${esc(t.payee || 'ไม่ทราบผู้รับ')}</span>
          <span class="row-sub">${bill ? `จับคู่บิล "${esc(bill.name)}" แล้ว` : `${esc(c.name)} · ${esc(w?.name || 'ไม่ระบุกระเป๋า')}`} · ${relDay(t.date)}</span>
        </span>
        <span class="amount ${t.type === 'income' ? 'income' : ''}">${t.amount ? `${t.type === 'income' ? '+' : '−'}${money(t.amount)}` : '<span class="warn">ใส่ยอด</span>'}</span>
      </button>
      <button class="icon-btn sm accent" data-act="confirm" aria-label="ยืนยัน">${icon('check', 18)}</button>
    </div>
  </div>`;
}

function billRow(b) {
  const diff = dayDiff(today(), b.date);
  const when = diff === 0 ? 'วันนี้' : diff === 1 ? 'พรุ่งนี้' : diff > 0 ? `อีก ${diff} วัน · ${fmtDate(b.date)}` : `เลยมา ${-diff} วัน`;
  return `<div class="row" data-id="${b.r.id}">
    <button class="row-main" data-act="bill">
      <span class="swatch" style="--c:${catOf(b.r.categoryId).color}"></span>
      <span class="row-text"><span class="row-title">${esc(b.r.name)}</span>
      <span class="row-sub ${diff < 0 ? 'warn' : ''}">${when}${b.r.installments ? ` · งวด ${b.index}/${b.r.installments}` : ''}</span></span>
      <span class="amount">${money(b.amount)}</span>
    </button>
    <button class="btn btn-sm" data-act="pay-bill" data-mk="${b.mk}">บันทึกจ่าย</button>
  </div>`;
}

export function summaryCard(s) {
  return `<div class="card pad summary">
    <div><span>รายรับ</span><b class="income">${money(s.income)}</b></div>
    <div><span>รายจ่าย</span><b>${money(s.expense)}</b></div>
    <div><span>คงเหลือ</span><b class="${s.balance < 0 ? 'warn' : ''}">${money(s.balance)}</b></div>
  </div>`;
}

function budgetCard(s) {
  if (!s.budgetTotal) return '';
  const budgeted = L.categories('expense').filter((c) => c.budget > 0);
  return `<div class="card pad">
    <div class="row-between small"><span>งบที่ตั้งไว้ ใช้ไป ${money(s.budgetUsed)}</span><span class="muted">จาก ${money(s.budgetTotal)}</span></div>
    ${progress(s.budgetUsed / s.budgetTotal, s.budgetUsed > s.budgetTotal ? 'var(--warn)' : '')}
    <div class="budget-list">
      ${budgeted
        .map((c) => {
          const used = s.byCat.get(c.id) || 0;
          const over = used > c.budget;
          return `<div class="budget-item">
            <div class="row-between small"><span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>
              <span class="${over ? 'warn' : 'muted'}">${money(used)} / ${money(c.budget)}</span></div>
            ${progress(used / c.budget, over ? 'var(--warn)' : c.color, 'thin')}
          </div>`;
        })
        .join('')}
    </div>
  </div>`;
}

function categoryCard(s) {
  const rows = [...s.byCat.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return `<div class="card pad">
    <div class="donut-wrap">${donut(rows.map(([id, v]) => [catOf(id).color, v]), s.expense)}
      <div class="legend">${rows
        .map(([id, v]) => `<div class="row-between small"><span><i class="dot" style="background:${catOf(id).color}"></i>${esc(catOf(id).name)}</span>
          <span>${money(v)} <span class="muted">${Math.round((v / s.expense) * 100)}%</span></span></div>`)
        .join('')}</div></div>
  </div>`;
}

function donut(parts, total) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = parts
    .map(([color, v]) => {
      const len = (v / total) * c;
      const seg = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${color}" stroke-width="14"
        stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return seg;
    })
    .join('');
  return `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="สัดส่วนรายจ่าย">
    <g transform="rotate(-90 60 60)">${segs}</g>
    <text x="60" y="56" text-anchor="middle" class="donut-label">รวม</text>
    <text x="60" y="72" text-anchor="middle" class="donut-value">${money(total)}</text>
  </svg>`;
}

// ---------- รายการ ----------

function monthNav() {
  const cur = monthOf(today());
  return `<div class="nav-row">
    <button class="icon-btn" data-act="month" data-d="-1" aria-label="เดือนก่อน">${icon('left')}</button>
    <button class="link" data-act="month" data-d="0">${fmtMonth(month)}</button>
    <button class="icon-btn" data-act="month" data-d="1" aria-label="เดือนถัดไป" ${month >= cur ? 'disabled' : ''}>${icon('right')}</button>
  </div>`;
}

function list() {
  const pend = pending();
  const txs = L.monthTransactions(month);
  const byDate = new Map();
  for (const t of txs) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return `
    ${monthNav()}
    ${pend.length ? `<div class="section-label row-between"><span>รอยืนยัน <b class="badge">${pend.length}</b></span><button class="link" data-act="confirm-all">ยืนยันทั้งหมด</button></div><div class="list card">${pend.map(pendingRow).join('')}</div>` : ''}
    ${
      txs.length
        ? [...byDate.entries()]
            .map(([date, items]) => {
              const net = items.filter(L.isSpendingTx).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
              return `<div class="section-label row-between"><span>${relDay(date)}</span><span class="muted">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</span></div>
                <div class="list card">${items.map(txRow).join('')}</div>`;
            })
            .join('')
        : `<div class="card">${emptyState('ยังไม่มีรายการเดือนนี้')}</div>`
    }
  `;
}

export function txRow(t) {
  const w = F.wallet(t.walletId);
  if (t.type === 'transfer') {
    return `<button class="row tx-row" data-act="tx" data-id="${t.id}">
      <span class="avatar" style="--c:#64748b">${icon('repeat', 16)}</span>
      <span class="row-text"><span class="row-title">โอน ${esc(w?.name || '')} → ${esc(F.wallet(t.toWalletId)?.name || '')}</span>${t.note ? `<span class="row-sub">${esc(t.note)}</span>` : ''}</span>
      <span class="amount muted">${money(t.amount)}</span>
    </button>`;
  }
  const c = catOf(t.categoryId);
  const title = t.payee || t.note || c.name;
  const sub = [t.payee || t.note ? c.name : '', w?.name || L.PAY_METHODS[t.method], t.excluded ? 'ยืม/หาร' : '', t.taxTag ? 'ลดหย่อนภาษี' : ''].filter(Boolean).join(' · ');
  return `<button class="row tx-row" data-act="tx" data-id="${t.id}">
    <span class="avatar" style="--c:${c.color}">${esc(title.trim().slice(0, 1))}</span>
    <span class="row-text"><span class="row-title">${esc(title)}${t.recurringId ? ` <span class="tag">${icon('repeat', 12)}</span>` : ''}${t.slipHash ? ` <span class="tag">${icon('scan', 12)}</span>` : ''}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    <span class="amount ${t.type === 'income' ? 'income' : ''} ${t.excluded ? 'muted' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span>
  </button>`;
}

// ---------- บิล ----------

function billsTab() {
  const mk = monthOf(today());
  const items = store.all('recurring').sort((a, b) => a.day - b.day);
  const sugg = F.billSuggestions();
  return `
    <p class="muted small intro">บิลประจำและรายการผ่อน แอปจะเตือนในหน้าภาพรวมและหักออกจาก "เหลือใช้จริง" ล่วงหน้า กด "จ่ายแล้ว" หรือสแกนสลิปแล้วระบบจะจับคู่ให้</p>
    ${sugg
      .map(
        (x) => `<div class="card pad suggest">
          <div><b>เจอบิลประจำ</b> <span class="muted small">${x.months} เดือนติด</span></div>
          <div class="small">${esc(x.payee)} ${money(x.amount)} · ทุกวันที่ ${x.day}</div>
          <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="bill-suggest-add" data-key="${esc(x.key)}">เพิ่มเป็นบิลประจำ</button>
          <button class="btn btn-sm" data-act="bill-suggest-no" data-key="${esc(x.key)}">ไม่ใช่</button></div>
        </div>`
      )
      .join('')}
    <div class="list card">
      ${
        items.length
          ? items
              .map((r) => {
                const c = catOf(r.categoryId);
                const b = F.billDue(r, mk);
                const index = L.installmentIndex(r, mk);
                const finished = r.installments && !index && mk > L.firstBillMonth(r);
                const status = !r.active
                  ? '<span class="muted small">ปิดอยู่</span>'
                  : finished
                    ? '<span class="chip-done">ผ่อนครบ</span>'
                    : !b
                      ? '<span class="muted small">ยังไม่ถึงรอบ</span>'
                      : b.paid
                        ? '<span class="chip-done">จ่ายแล้ว ✓</span>'
                        : r.type === 'income'
                          ? '<span class="muted small">รอรับ</span>'
                          : `<button class="btn btn-sm" data-act="pay-bill" data-mk="${mk}">บันทึกจ่าย</button>`;
                return `<div class="row" data-id="${r.id}">
                  <button class="row-main" data-act="bill">
                    <span class="swatch" style="--c:${c.color}"></span>
                    <span class="row-text"><span class="row-title">${esc(r.name)}</span>
                    <span class="row-sub">ทุกวันที่ ${r.day}${r.installments ? ` · งวด ${index || r.installments}/${r.installments}` : ''}${r.auto !== false ? ' · บันทึกอัตโนมัติ' : ''} · ${money(r.amount)}</span></span>
                  </button>
                  ${status}
                </div>`;
              })
              .join('')
          : emptyState('ยังไม่มีบิลประจำ เช่น ค่าเช่า ค่าเน็ต ค่าผ่อน')
      }
    </div>`;
}

function payBillSheet(r, mk) {
  openSheet({
    title: `จ่าย ${r.name}`,
    body: `<form class="form" novalidate>
      <label class="field amount-field"><span>ยอดที่จ่าย</span><input name="amount" inputmode="decimal" value="${r.amount}"></label>
      <div class="field-row">
        <label class="field"><span>จ่ายจาก</span>${walletSelect('walletId', r.walletId || F.defaultWalletId())}</label>
        <label class="field"><span>วันที่</span><input name="date" type="date" value="${today()}"></label>
      </div>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึกว่าจ่ายแล้ว</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = parseAmount(form.elements.amount.value);
        if (!(amount > 0)) return toast('ใส่ยอดก่อน');
        F.payBill({ ...r, amount }, mk, { walletId: form.elements.walletId.value, date: form.elements.date.value || today() });
        close();
        toast(`จ่าย ${r.name} แล้ว`);
      };
    },
  });
}

// ---------- ยืม / หาร ----------

function loansTab() {
  const seg = `<div class="seg seg-sm loan-seg">
    <label><input type="radio" name="lmode" value="loans" data-act="loan-mode" ${loanMode === 'loans' ? 'checked' : ''}><span>ยืม / ให้ยืม</span></label>
    <label><input type="radio" name="lmode" value="splits" data-act="loan-mode" ${loanMode === 'splits' ? 'checked' : ''}><span>หารกับเพื่อน</span></label>
  </div>`;
  if (loanMode === 'splits') {
    const items = store.all('splits').sort((a, b) => b.date.localeCompare(a.date));
    return `${seg}${
      items.length
        ? items
            .map((s) => {
              const info = F.splitInfo(s);
              return `<button class="card pad loan-card" data-act="split" data-id="${s.id}">
                <div class="row-between"><b>${esc(s.title)}</b><span class="muted small">${fmtDate(s.date)}</span></div>
                <div class="small">${money(s.total)} · หาร ${s.people.length + 1} คน · คนละ ${money(s.people[0]?.amount || s.myShare)}</div>
                ${progress(info.owed ? info.got / info.owed : 1)}
                <div class="row-between small"><span class="muted">${info.done ? 'ได้คืนครบแล้ว' : `ได้คืนแล้ว ${money(info.got)} จาก ${money(info.owed)}`}</span>
                <span class="people">${s.people.map((p) => `<i class="${p.paid ? 'paid' : ''}" title="${esc(p.name)}">${esc(p.name.slice(0, 1))}</i>`).join('')}</span></div>
              </button>`;
            })
            .join('')
        : `<div class="card">${emptyState('ยังไม่มีรายการหาร กดปุ่ม + เพื่อหารค่าอาหาร ค่าที่พัก ฯลฯ')}</div>`
    }`;
  }
  const items = store.all('loans').sort((a, b) => F.loanInfo(a).done - F.loanInfo(b).done || b.startDate.localeCompare(a.startDate));
  return `${seg}${
    items.length
      ? items
          .map((l) => {
            const i = F.loanInfo(l);
            return `<button class="card pad loan-card ${i.done ? 'is-done' : ''}" data-act="loan" data-id="${l.id}">
              <div class="row-between"><b>${esc(l.person)} ${l.direction === 'lent' ? 'ยืมไป' : '(เรายืม)'}</b><span class="muted small">${i.done ? 'ครบแล้ว ✓' : `งวดถัดไป ${relDay(i.nextDue)}`}</span></div>
              <div class="small">${money(l.principal)}${l.rate ? ` · ดอกเบี้ย ${l.rate}%/เดือน` : ''} · ${i.months} งวด งวดละ ${money(i.per)}</div>
              ${progress(i.total ? i.paid / i.total : 0)}
              <div class="row-between small"><span class="muted">${l.direction === 'lent' ? 'คืนแล้ว' : 'จ่ายแล้ว'} ${i.paidCount} จาก ${i.months} งวด</span><span>เหลือ <b>${money(i.remaining)}</b></span></div>
            </button>`;
          })
          .join('')
      : `<div class="card">${emptyState('ยังไม่มีรายการยืม กดปุ่ม + เพื่อจดว่าใครยืมเท่าไหร่')}</div>`
  }`;
}

// ---------- เป้าออม ----------

function goals() {
  const items = store.all('goals').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!items.length) return `<div class="card">${emptyState('ยังไม่มีเป้าหมาย ลองตั้งเป้าแรก เช่น เงินสำรองฉุกเฉิน')}</div>`;
  return items.map(goalCard).join('');
}

export function goalCard(g) {
  const info = L.goalInfo(g);
  return `<div class="card pad goal" data-id="${g.id}" style="--c:${g.color || 'var(--accent)'}">
    <div class="row-between">
      <button class="link-plain" data-act="goal"><b>${esc(g.name)}</b></button>
      <span class="muted small">${Math.round(info.pct * 100)}%</span>
    </div>
    <div class="row-between small"><span>${money(g.saved || 0)}</span><span class="muted">เป้า ${money(g.target)}</span></div>
    ${progress(info.pct, g.color)}
    <div class="row-between small goal-foot">
      <span class="muted">${
        info.remaining <= 0
          ? 'ถึงเป้าแล้ว 🎉'
          : info.perMonth != null
            ? `อีก ${money(info.remaining)} · ควรออมเดือนละ ${money(Math.ceil(info.perMonth))}`
            : `อีก ${money(info.remaining)}`
      }</span>
      <button class="btn btn-sm" data-act="goal-add">${icon('plus', 16)} ออมเพิ่ม</button>
    </div>
  </div>`;
}

// ---------- ฟอร์มรายการ ----------

function walletSelect(name, selected, { allowNone = false } = {}) {
  return `<select name="${name}">
    ${allowNone ? `<option value="">ไม่บันทึกในกระเป๋า</option>` : ''}
    ${F.wallets().map((w) => `<option value="${w.id}" ${w.id === selected ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
  </select>`;
}

function categoryChips(type, selected) {
  return (
    L.categories(type)
      .map(
        (c) =>
          `<label class="chip cat-chip"><input type="radio" name="categoryId" value="${c.id}" ${c.id === selected ? 'checked' : ''}><span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span></label>`
      )
      .join('') + `<button type="button" class="cat-add" data-cat-add="${type}">+ เพิ่มหมวด</button>`
  );
}

// สร้างหมวดใหม่ (ถ้ามีชื่อซ้ำในประเภทเดียวกันอยู่แล้ว ใช้อันเดิม)
function addCategory(type, name) {
  const existing = L.categories(type).find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const n = L.categories().length;
  return store.put('categories', { name, type, color: COLORS[n % COLORS.length], budget: 0, order: n });
}

// ชิป "+ เพิ่มหมวด" ในฟอร์ม: แตะแล้วพิมพ์ชื่อ กด Enter ได้หมวดใหม่ที่เลือกไว้ทันที
function bindCategoryAdd(sheet) {
  sheet.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat-add]');
    if (!btn) return;
    const type = btn.dataset.catAdd;
    const box = btn.closest('[data-cats]');
    const input = document.createElement('input');
    input.className = 'cat-add-input';
    input.maxLength = 40;
    input.placeholder = 'ชื่อหมวดใหม่';
    input.setAttribute('aria-label', 'ชื่อหมวดใหม่');
    btn.replaceWith(input);
    input.focus();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name) {
        const c = addCategory(type, name);
        box.innerHTML = categoryChips(type, c.id);
        box.querySelector(`[name=categoryId][value="${c.id}"]`)?.dispatchEvent(new Event('change', { bubbles: true }));
        toast(`เพิ่มหมวด "${c.name}" แล้ว`);
      } else {
        const checked = box.querySelector('[name=categoryId]:checked')?.value;
        box.innerHTML = categoryChips(type, checked);
      }
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  });
}

export function editTransaction(tx, type = 'expense') {
  const isNew = !tx;
  const isPending = tx?.status === 'pending';
  tx ??= { type, amount: '', categoryId: '', date: today(), walletId: F.defaultWalletId(), payee: '', note: '' };
  const bill = tx.recurringId ? store.get('recurring', tx.recurringId) : null;
  let categoryTouched = !!tx.categoryId && !isPending;

  openSheet({
    title: isPending ? 'ตรวจสลิป' : isNew ? 'บันทึกรายการ' : 'แก้ไขรายการ',
    body: `<form class="form" novalidate>
      ${tx.slipHash ? '<div class="slip-preview" data-slip><span class="muted small">กำลังโหลดรูปสลิป…</span></div>' : ''}
      <div class="seg">
        <label><input type="radio" name="type" value="expense" ${tx.type === 'expense' ? 'checked' : ''}><span>รายจ่าย</span></label>
        <label><input type="radio" name="type" value="income" ${tx.type === 'income' ? 'checked' : ''}><span>รายรับ</span></label>
        <label><input type="radio" name="type" value="transfer" ${tx.type === 'transfer' ? 'checked' : ''}><span>โอนระหว่างกระเป๋า</span></label>
      </div>
      <label class="field amount-field"><span>จำนวนเงิน (บาท)</span>
        <input name="amount" inputmode="decimal" placeholder="0" value="${tx.amount ?? ''}" ${isNew ? 'autofocus' : ''} autocomplete="off">
      </label>
      <label class="field" data-show="expense income"><span data-payee-label>${tx.type === 'income' ? 'ได้จาก' : 'จ่ายให้ / ร้าน'}</span>
        <input name="payee" value="${esc(tx.payee || '')}" placeholder="เช่น ร้านข้าวมันไก่, ลูกค้า" maxlength="60" autocomplete="off">
      </label>
      <div class="field" data-show="expense income"><span>หมวดหมู่</span><div class="chips" data-cats>${categoryChips(tx.type === 'income' ? 'income' : 'expense', tx.categoryId)}</div></div>
      <div class="field-row">
        <label class="field"><span data-wallet-label>${tx.type === 'income' ? 'เข้ากระเป๋า' : 'จากกระเป๋า'}</span>${walletSelect('walletId', tx.walletId || F.defaultWalletId())}</label>
        <label class="field" data-show="transfer"><span>ไปกระเป๋า</span>${walletSelect('toWalletId', tx.toWalletId || F.wallets().find((w) => w.id !== tx.walletId)?.id)}</label>
        <label class="field" data-show="expense income"><span>วันที่</span><input name="date" type="date" value="${tx.date}"></label>
      </div>
      <label class="field" data-show="transfer"><span>วันที่</span><input name="date2" type="date" value="${tx.date}"></label>
      <label class="field"><span>โน้ต</span><input name="note" value="${esc(tx.note || '')}" placeholder="ถ้ามี" maxlength="120"></label>
      <label class="field" data-show="expense"><span>ลดหย่อนภาษี</span>
        <select name="taxTag"><option value="">ไม่ใช่</option>${Object.entries(F.TAX_TAGS).map(([k, v]) => `<option value="${k}" ${tx.taxTag === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      </label>
      ${bill ? `<p class="hint">จับคู่กับบิล "${esc(bill.name)}" ${tx.billMonth ? `เดือน ${fmtMonth(tx.billMonth)}` : ''}</p>` : ''}
      ${tx.excluded ? '<p class="hint">รายการนี้มาจากยืม/หาร ไม่นับเป็นรายรับรายจ่าย แต่มีผลกับยอดในกระเป๋า</p>' : ''}
      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash', 18)} ลบ</button>`}
        <button class="btn btn-primary grow">${isPending ? 'ยืนยัน' : 'บันทึก'}</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const f = form.elements;
      const show = () => {
        const type = f.type.value;
        for (const el of form.querySelectorAll('[data-show]')) el.hidden = !el.dataset.show.split(' ').includes(type);
        sheet.querySelector('[data-payee-label]').textContent = type === 'income' ? 'ได้จาก' : 'จ่ายให้ / ร้าน';
        sheet.querySelector('[data-wallet-label]').textContent = type === 'income' ? 'เข้ากระเป๋า' : 'จากกระเป๋า';
      };
      show();
      bindCategoryAdd(sheet);
      form.querySelectorAll('[name=type]').forEach((r) => {
        r.onchange = () => {
          if (r.value !== 'transfer') sheet.querySelector('[data-cats]').innerHTML = categoryChips(r.value, F.guessCategory(f.payee.value, r.value));
          show();
        };
      });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'categoryId') categoryTouched = true;
      });
      // เดาหมวดจากชื่อผู้รับ (ถ้ายังไม่ได้เลือกเอง)
      f.payee.oninput = () => {
        if (categoryTouched || f.type.value === 'transfer') return;
        const guess = F.guessCategory(f.payee.value, f.type.value);
        const radio = form.querySelector(`[name=categoryId][value="${guess}"]`);
        if (radio) radio.checked = true;
      };

      if (tx.slipHash) {
        slips.imageUrl(tx.id, tx.slipFileId).then((url) => {
          const box = sheet.querySelector('[data-slip]');
          if (box) box.innerHTML = url ? `<img src="${url}" alt="สลิป">` : '<span class="muted small">ไม่มีรูปสลิปในเครื่องนี้</span>';
        });
      }

      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = parseAmount(f.amount.value);
        if (!(amount > 0)) {
          toast('ใส่จำนวนเงินก่อน');
          return f.amount.focus();
        }
        const type = f.type.value;
        if (type === 'transfer' && f.walletId.value === f.toWalletId.value) return toast('เลือกกระเป๋าปลายทางที่ต่างกัน');
        const categoryId = type === 'transfer' ? null : form.querySelector('[name=categoryId]:checked')?.value || F.guessCategory(f.payee.value, type);
        saveTx({
          ...tx,
          type,
          amount,
          payee: type === 'transfer' ? '' : f.payee.value.trim(),
          categoryId,
          walletId: f.walletId.value,
          toWalletId: type === 'transfer' ? f.toWalletId.value : null,
          date: (type === 'transfer' ? f.date2.value : f.date.value) || today(),
          note: f.note.value.trim(),
          taxTag: type === 'expense' ? f.taxTag.value || null : null,
        });
        close();
        toast(isPending ? 'ยืนยันแล้ว' : isNew ? 'บันทึกแล้ว' : 'แก้ไขแล้ว');
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmBox(isPending ? 'ลบสลิปนี้?' : 'ลบรายการนี้?', { ok: 'ลบ', danger: true }))) return;
        store.remove('transactions', tx.id);
        close();
      });
    },
  });
}

// ---------- กระเป๋า ----------

function walletSheet(w) {
  const recent = store
    .all('transactions')
    .filter((t) => t.status !== 'pending' && (t.walletId === w.id || t.toWalletId === w.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, 8);
  const bal = F.walletBalance(w);
  openSheet({
    title: w.name,
    body: `<div class="form">
      <div class="wallet-hero" style="--c:${w.color}"><span class="wbadge">${esc(w.badge || '')}</span>
        <div><span class="muted small">ยอดในกระเป๋า</span><b>${bal == null ? 'ยังไม่ได้ตั้งยอด' : money(bal)}</b></div></div>
      <form class="field-inline" data-balance>
        <label class="field grow"><span>ยอดจริงตอนนี้ (ดูจากแอปธนาคาร)</span><input name="balance" inputmode="decimal" placeholder="${bal ?? '0'}"></label>
        <button class="btn">อัปเดต</button>
      </form>
      <div class="btn-row">
        <button type="button" class="btn" data-transfer>${icon('repeat', 18)} โอนเงิน</button>
        <button type="button" class="btn" data-edit>${icon('edit', 18)} แก้ไข</button>
      </div>
      <h3 class="section-label">รายการล่าสุด</h3>
      <div class="list card">${recent.length ? recent.map(txRow).join('') : emptyState('ยังไม่มีรายการ')}</div>
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-balance]').onsubmit = (e) => {
        e.preventDefault();
        const v = parseAmount(e.target.elements.balance.value);
        if (!Number.isFinite(v)) return toast('ใส่ยอดเป็นตัวเลข');
        F.setWalletBalance(w, v);
        close();
        toast(`ตั้งยอด ${w.name} = ${money(v)}`);
      };
      sheet.querySelector('[data-transfer]').onclick = () => {
        close();
        editTransaction(null, 'transfer');
      };
      sheet.querySelector('[data-edit]').onclick = () => {
        close();
        editWallet(w);
      };
      sheet.querySelector('.list').onclick = (e) => {
        const row = e.target.closest('[data-id]');
        if (row) editTransaction(store.get('transactions', row.dataset.id));
      };
    },
  });
}

// ใส่ยอดทุกกระเป๋าในหน้าเดียว
function walletsSheet() {
  openSheet({
    title: 'ยอดเงินในกระเป๋า',
    body: `<form class="form" novalidate>
      <p class="muted small">ใส่ยอดจริงตอนนี้ของแต่ละกระเป๋า (ดูจากแอปธนาคาร) แอปจะบวกลบตามรายการที่บันทึกหลังจากนี้ แล้วใช้คำนวณ "เหลือใช้จริง"</p>
      ${F.wallets()
        .map((w) => `<label class="field inline"><span><i class="dot" style="background:${w.color}"></i>${esc(w.name)}</span><input name="${w.id}" inputmode="decimal" placeholder="${F.walletBalance(w) ?? '0'}"></label>`)
        .join('')}
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        store.batch(() => {
          for (const w of F.wallets()) {
            const raw = form.elements[w.id].value.trim();
            if (raw === '' && w.initialBalance != null) continue;
            const v = raw === '' ? 0 : parseAmount(raw);
            if (Number.isFinite(v)) F.setWalletBalance(w, v);
          }
        });
        close();
        toast('บันทึกยอดแล้ว');
      };
    },
  });
}

function editWallet(w) {
  const isNew = !w;
  w ??= { name: '', badge: '', color: COLORS[F.wallets().length % COLORS.length], aliases: [], initialBalance: null };
  openSheet({
    title: isNew ? 'เพิ่มกระเป๋า' : 'แก้ไขกระเป๋า',
    body: `<form class="form" novalidate>
      <div class="field-row">
        <label class="field"><span>ชื่อ</span><input name="name" value="${esc(w.name)}" placeholder="เช่น SCB, เงินสด" maxlength="24" autofocus></label>
        <label class="field"><span>ตัวย่อ (2 ตัว)</span><input name="badge" value="${esc(w.badge || '')}" maxlength="3" placeholder="SC"></label>
      </div>
      <label class="field"><span>คำที่ใช้เรียก (คั่นด้วย ,)</span><input name="aliases" value="${esc((w.aliases || []).join(', '))}" placeholder="เช่น scb, ไทยพาณิชย์"></label>
      <p class="hint">ใช้จับคำตอนพิมพ์ เช่น "กาแฟ 65 scb" และตอนอ่านสลิป</p>
      ${isNew ? `<label class="field"><span>ยอดตอนนี้ (ถ้ามี)</span><input name="balance" inputmode="decimal" placeholder="0"></label>` : ''}
      <div class="field"><span>สี</span>${colorPicker(COLORS, w.color)}</div>
      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-archive>${icon('archive', 18)} เก็บ</button>`}
        <button class="btn btn-primary grow">บันทึก</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const f = form.elements;
        const name = f.name.value.trim();
        if (!name) return f.name.focus();
        const saved = store.put('wallets', {
          ...w,
          name,
          badge: f.badge.value.trim() || name.slice(0, 2).toUpperCase(),
          aliases: f.aliases.value.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
          color: f.color.value,
          order: w.order ?? store.all('wallets').length,
        });
        const bal = isNew && f.balance.value.trim() ? parseAmount(f.balance.value) : NaN;
        if (Number.isFinite(bal)) F.setWalletBalance(saved, bal);
        close();
      };
      sheet.querySelector('[data-archive]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`เก็บกระเป๋า "${w.name}"? รายการเดิมยังอยู่ครบ แค่ไม่แสดงในหน้าภาพรวม`, { ok: 'เก็บ' }))) return;
        store.patch('wallets', w.id, { archived: true });
        close();
      });
    },
  });
}

// ---------- เมนู ----------

function moneyMenu(root) {
  openSheet({
    title: 'การเงิน',
    body: `<div class="menu-list">
      <button data-m="scan">${icon('scan')} สแกนสลิป (เลือกหลายใบได้)</button>
      <button data-m="balances">${icon('money')} ใส่ยอดเงินในกระเป๋า</button>
      <button data-m="wallet">${icon('plus')} เพิ่มกระเป๋า</button>
      <button data-m="promptpay">${icon('scan')} พร้อมเพย์ของฉัน (ใช้ทวงเงิน/หาร)</button>
      <button data-m="tax">${icon('flag')} สรุปลดหย่อนภาษี</button>
      <button data-m="csv">${icon('download')} ส่งออก CSV (เปิดใน Excel)</button>
    </div>`,
    onMount(sheet, close) {
      sheet.querySelector('.menu-list').onclick = (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        close();
        if (m === 'scan') root.querySelector('[data-slips]').click();
        else if (m === 'balances') walletsSheet();
        else if (m === 'wallet') editWallet();
        else if (m === 'promptpay') promptPaySheet();
        else if (m === 'tax') taxSheet(new Date().getFullYear());
        else if (m === 'csv') exportCsv();
      };
    },
  });
}

function exportCsv() {
  const blob = new Blob([F.transactionsCsv()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `noteme-transactions-${today()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast('ส่งออกแล้ว');
}

function taxSheet(year) {
  const { totals, txs } = F.taxSummary(year);
  openSheet({
    title: `ลดหย่อนภาษีปี ${year + 543}`,
    body: `<div class="form">
      <div class="tax-grid">${Object.entries(F.TAX_TAGS)
        .map(([k, v]) => `<div class="card pad"><span class="muted small">${esc(v)}</span><b>${money(totals[k] || 0)}</b></div>`)
        .join('')}</div>
      <p class="hint">ติดป้ายได้ที่ช่อง "ลดหย่อนภาษี" ในหน้าแก้ไขรายการ · ตรวจเพดานลดหย่อนของแต่ละประเภทกับกรมสรรพากรอีกครั้งก่อนยื่น</p>
      <div class="list card">${txs.length ? txs.map(txRow).join('') : emptyState('ยังไม่มีรายการที่ติดป้ายลดหย่อนในปีนี้')}</div>
    </div>`,
  });
}

// ---------- พร้อมเพย์ / QR ----------

function promptPaySheet(then) {
  const cur = store.settings().promptpay || '';
  openSheet({
    title: 'พร้อมเพย์ของฉัน',
    body: `<form class="form" novalidate>
      <label class="field"><span>เบอร์มือถือหรือเลขบัตรประชาชนที่ผูกพร้อมเพย์</span><input name="pp" inputmode="numeric" value="${esc(cur)}" placeholder="08x-xxx-xxxx" autofocus></label>
      <label class="field"><span>ชื่อที่แสดงตอนทวง (ถ้ามี)</span><input name="ppName" value="${esc(store.settings().promptpayName || '')}" placeholder="เช่น นุ่น" maxlength="30"></label>
      <p class="hint">เก็บไว้ในเครื่องและ Google Drive ของคุณเท่านั้น ใช้สร้าง QR พร้อมยอดให้เพื่อนสแกนโอนคืน</p>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = form.elements.pp.value.replace(/\D/g, '');
        if (!pp.isValidTarget(v)) return toast('ใส่เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก');
        store.setSettings({ promptpay: v, promptpayName: form.elements.ppName.value.trim() });
        close();
        then?.();
      };
    },
  });
}

async function qrSheet({ amount, title, message }) {
  const target = store.settings().promptpay;
  if (!target) return promptPaySheet(() => qrSheet({ amount, title, message }));
  openSheet({
    title,
    body: `<div class="qr-box">
      <div data-qr class="qr-img"><span class="muted small">กำลังสร้าง QR…</span></div>
      <b class="qr-amount">${money(amount)}</b>
      <span class="muted small">พร้อมเพย์ ${esc(store.settings().promptpayName || '')} ••${esc(target.slice(-4))}</span>
      <div class="btn-row"><button class="btn btn-primary" data-share>แชร์ (LINE ฯลฯ)</button></div>
    </div>`,
    async onMount(sheet) {
      let file = null;
      try {
        const canvas = await pp.qrCanvas(pp.payload(target, amount));
        sheet.querySelector('[data-qr]').replaceChildren(canvas);
        file = new File([await pp.canvasBlob(canvas)], 'promptpay.png', { type: 'image/png' });
      } catch (e) {
        console.error(e);
        sheet.querySelector('[data-qr]').innerHTML = '<span class="muted small">สร้าง QR ไม่สำเร็จ (ครั้งแรกต้องต่ออินเทอร์เน็ต)</span>';
      }
      sheet.querySelector('[data-share]').onclick = () => shareOrCopy({ text: message, file });
    },
  });
}

// ---------- ยืม / ให้ยืม ----------

function editLoan(l) {
  const isNew = !l;
  l ??= { direction: 'lent', person: '', principal: '', rate: 0, months: 1, startDate: today(), dueDay: Number(today().slice(8)), note: '', payments: [], attachments: [] };
  openSheet({
    title: isNew ? 'จดเงินยืม' : 'แก้ไขเงินยืม',
    body: `<form class="form" novalidate>
      <div class="seg">
        <label><input type="radio" name="direction" value="lent" ${l.direction === 'lent' ? 'checked' : ''}><span>ให้คนอื่นยืม</span></label>
        <label><input type="radio" name="direction" value="borrowed" ${l.direction === 'borrowed' ? 'checked' : ''}><span>เรายืมคนอื่น</span></label>
      </div>
      <div class="field-row">
        <label class="field"><span>ชื่อ</span><input name="person" value="${esc(l.person)}" placeholder="เช่น ต้น" maxlength="30" autofocus></label>
        <label class="field"><span>เงินต้น (บาท)</span><input name="principal" inputmode="decimal" value="${l.principal}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>ดอกเบี้ย % ต่อเดือน</span><input name="rate" inputmode="decimal" value="${l.rate || ''}" placeholder="0"></label>
        <label class="field"><span>แบ่งจ่ายกี่งวด</span><input name="months" type="number" inputmode="numeric" min="1" max="120" value="${l.months}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>เริ่มวันที่</span><input name="startDate" type="date" value="${l.startDate}"></label>
        <label class="field"><span>คืนทุกวันที่</span><input name="dueDay" type="number" inputmode="numeric" min="1" max="31" value="${l.dueDay}"></label>
      </div>
      ${isNew ? `<label class="field"><span>เงินออก/เข้ากระเป๋าไหน</span>${walletSelect('walletId', F.defaultWalletId(), { allowNone: true })}</label>` : ''}
      <label class="field"><span>โน้ต</span><input name="note" value="${esc(l.note || '')}" maxlength="120"></label>
      <p class="hint" data-calc></p>
      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash', 18)} ลบ</button>`}
        <button class="btn btn-primary grow">บันทึก</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const f = form.elements;
      const read = () => ({
        ...l,
        direction: f.direction.value,
        person: f.person.value.trim(),
        principal: parseAmount(f.principal.value) || 0,
        rate: parseAmount(f.rate.value) || 0,
        months: Math.max(1, parseInt(f.months.value, 10) || 1),
        startDate: f.startDate.value || today(),
        dueDay: Math.min(31, Math.max(1, parseInt(f.dueDay.value, 10) || 1)),
        note: f.note.value.trim(),
      });
      const calc = () => {
        const v = read();
        const i = F.loanInfo(v);
        sheet.querySelector('[data-calc]').textContent = v.principal ? `รวม ${money(i.total)}${i.interest ? ` (ดอกเบี้ย ${money(i.interest)})` : ''} · ${i.months} งวด งวดละ ${money(i.per)}` : '';
      };
      form.oninput = calc;
      calc();
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = read();
        if (!v.person) return f.person.focus();
        if (!(v.principal > 0)) return toast('ใส่เงินต้นก่อน');
        const saved = store.put('loans', { ...v, createdAt: v.createdAt || Date.now() });
        // บันทึกเงินที่ออกจาก/เข้ากระเป๋าตอนเริ่มยืม (ไม่นับเป็นรายจ่าย/รายรับ)
        if (isNew && f.walletId.value) {
          saveTx({
            type: v.direction === 'lent' ? 'expense' : 'income',
            amount: v.principal,
            walletId: f.walletId.value,
            payee: v.person,
            note: v.direction === 'lent' ? `ให้ ${v.person} ยืม` : `ยืม ${v.person}`,
            date: v.startDate,
            excluded: true,
            loanId: saved.id,
            categoryId: L.categories(v.direction === 'lent' ? 'expense' : 'income').at(-1)?.id,
          });
        }
        close();
        if (isNew) loanSheet(saved);
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`ลบรายการยืมของ ${l.person}? รายการเงินเข้าออกที่บันทึกไว้ยังอยู่`, { ok: 'ลบ', danger: true }))) return;
        store.remove('loans', l.id);
        close();
      });
    },
  });
}

function loanSheet(l) {
  openSheet({
    title: `${l.person} ${l.direction === 'lent' ? 'ยืมไป' : '(เรายืม)'}`,
    body: '<div data-loan></div>',
    onMount(sheet, close) {
      const box = sheet.querySelector('[data-loan]');
      const draw = () => {
        l = store.get('loans', l.id);
        if (!l) return close();
        const i = F.loanInfo(l);
        const lent = l.direction === 'lent';
        box.innerHTML = `
          <div class="kv loan-kv">
            <div><span>เงินต้น</span><b>${money(l.principal)}</b></div>
            ${i.interest ? `<div><span>ดอกเบี้ยคงที่ ${l.rate}% ต่อเดือน</span><b>${money(i.interest)}</b></div>` : ''}
            <div><span>${i.months} งวด · งวดละ</span><b>${money(i.per)}</b></div>
            <div><span>${lent ? 'คืนแล้ว' : 'จ่ายแล้ว'} ${i.paidCount} จาก ${i.months} งวด</span><b>เหลือ ${money(i.remaining)}</b></div>
          </div>
          ${progress(i.total ? i.paid / i.total : 0)}
          ${i.done ? '<p class="all-done center">ครบแล้ว 🎉</p>' : `<p class="small muted">งวดที่ ${i.nextIndex} · ${money(i.nextAmount)} · ครบกำหนด ${relDay(i.nextDue)}</p>`}
          ${
            i.done
              ? ''
              : `<div class="btn-row">
                  <button class="btn btn-primary" data-a="pay">${lent ? 'รับคืน' : 'จ่ายคืน'} งวดที่ ${i.nextIndex}</button>
                  ${lent ? `<button class="btn" data-a="qr">${icon('scan', 18)} ทวงด้วย QR</button>` : ''}
                </div>`
          }
          <h3 class="section-label">ประวัติการ${lent ? 'รับคืน' : 'จ่ายคืน'}</h3>
          <div class="list card">${
            (l.payments || []).length
              ? l.payments
                  .map((p, n) => `<div class="row"><span class="row-text"><span class="row-title">งวดที่ ${n + 1} · ${money(p.amount)}</span><span class="row-sub">${fmtDate(p.date)}</span></span>
                    <button class="icon-btn sm" data-a="del-pay" data-pid="${p.id}" aria-label="ลบ">${icon('x', 16)}</button></div>`)
                  .join('')
              : emptyState('ยังไม่มี')
          }</div>
          <h3 class="section-label">หลักฐาน</h3>
          <div class="list card">
            ${(l.attachments || [])
              .map((a) => `<div class="row"><button class="row-main" data-a="open-att" data-att="${a.id}">${icon(a.kind === 'note' ? 'edit' : 'download', 18)}
                <span class="row-text"><span class="row-title">${esc(a.kind === 'note' ? a.text : a.name)}</span></span></button>
                <button class="icon-btn sm" data-a="del-att" data-att="${a.id}" aria-label="ลบ">${icon('x', 16)}</button></div>`)
              .join('')}
            <div class="row att-add">
              <label class="btn btn-sm">${icon('plus', 16)} แนบสลิป / รูป / PDF<input type="file" accept="image/*,application/pdf" hidden data-att-file></label>
              <button class="btn btn-sm" data-a="add-note">${icon('edit', 16)} โน้ต</button>
            </div>
          </div>
          <div class="sheet-actions"><button class="btn" data-a="edit">${icon('edit', 18)} แก้ไข</button></div>`;
        box.querySelector('[data-att-file]').onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const id = uid();
          await slips.saveImage(id, file);
          store.patch('loans', l.id, { attachments: [...(l.attachments || []), { id, kind: 'file', name: file.name, mime: file.type }] });
          slips.uploadPending();
          draw();
        };
      };
      draw();
      box.onclick = async (e) => {
        const btn = e.target.closest('[data-a]');
        if (!btn) return;
        const a = btn.dataset.a;
        const i = F.loanInfo(l);
        if (a === 'pay') return loanPaySheet(l, draw);
        if (a === 'qr') return qrSheet({ amount: i.nextAmount, title: `ทวง ${l.person} งวดที่ ${i.nextIndex}`, message: `${l.person} งวดที่ ${i.nextIndex}/${i.months} ยอด ${money(i.nextAmount)} ครบกำหนด ${fmtDate(i.nextDue)} สแกน QR พร้อมเพย์ได้เลยนะ 🙏` });
        if (a === 'edit') {
          close();
          return editLoan(l);
        }
        if (a === 'del-pay') {
          const p = l.payments.find((x) => x.id === btn.dataset.pid);
          if (!(await confirmBox(`ลบงวด ${money(p.amount)}?`, { ok: 'ลบ', danger: true }))) return;
          store.batch(() => {
            if (p.txId) store.remove('transactions', p.txId);
            store.patch('loans', l.id, { payments: l.payments.filter((x) => x.id !== p.id) });
          });
          return draw();
        }
        if (a === 'add-note') {
          return askText('โน้ตหลักฐาน', 'เช่น ยืมไปจ่ายค่าเทอม คุยกันทาง LINE วันที่ 5', (text) => {
            store.patch('loans', l.id, { attachments: [...(store.get('loans', l.id).attachments || []), { id: uid(), kind: 'note', text }] });
            draw();
          });
        }
        if (a === 'open-att') {
          const att = l.attachments.find((x) => x.id === btn.dataset.att);
          if (att.kind === 'note') return toast(att.text);
          const url = await slips.imageUrl(att.id, att.fileId);
          return url ? open(url, '_blank') : toast('ไม่มีไฟล์ในเครื่องนี้');
        }
        if (a === 'del-att') {
          store.patch('loans', l.id, { attachments: l.attachments.filter((x) => x.id !== btn.dataset.att) });
          return draw();
        }
      };
    },
  });
}

function loanPaySheet(l, after) {
  const i = F.loanInfo(l);
  const lent = l.direction === 'lent';
  openSheet({
    title: `${lent ? 'รับคืน' : 'จ่ายคืน'} งวดที่ ${i.nextIndex}`,
    body: `<form class="form" novalidate>
      <label class="field amount-field"><span>ยอด</span><input name="amount" inputmode="decimal" value="${i.nextAmount}"></label>
      <div class="field-row">
        <label class="field"><span>${lent ? 'เข้ากระเป๋า' : 'จากกระเป๋า'}</span>${walletSelect('walletId', F.defaultWalletId(), { allowNone: true })}</label>
        <label class="field"><span>วันที่</span><input name="date" type="date" value="${today()}"></label>
      </div>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = parseAmount(form.elements.amount.value);
        if (!(amount > 0)) return toast('ใส่ยอดก่อน');
        const date = form.elements.date.value || today();
        let txId = null;
        if (form.elements.walletId.value) {
          txId = saveTx({
            type: lent ? 'income' : 'expense',
            amount,
            walletId: form.elements.walletId.value,
            payee: l.person,
            note: `${lent ? 'รับคืนจาก' : 'คืน'} ${l.person} งวดที่ ${i.nextIndex}`,
            date,
            excluded: true,
            loanId: l.id,
            categoryId: L.categories(lent ? 'income' : 'expense').at(-1)?.id,
          }).id;
        }
        store.patch('loans', l.id, { payments: [...(l.payments || []), { id: uid(), date, amount, txId }] });
        close();
        after?.();
        toast('บันทึกแล้ว');
      };
    },
  });
}

// ---------- หารกับเพื่อน ----------

function editSplit() {
  openSheet({
    title: 'หารกับเพื่อน',
    body: `<form class="form" novalidate>
      <label class="field"><span>ค่าอะไร</span><input name="title" placeholder="เช่น หมูกระทะ" maxlength="40" autofocus></label>
      <label class="field amount-field"><span>ยอดรวมที่เราจ่ายไปก่อน</span><input name="total" inputmode="decimal" placeholder="0"></label>
      <label class="field"><span>หารกับใครบ้าง (คั่นด้วย , หรือขึ้นบรรทัดใหม่)</span><textarea name="people" rows="2" placeholder="ต้น, มายด์, เบส"></textarea></label>
      <label class="toggle-row"><span>รวมเราด้วย<small>ปิดถ้าเราจ่ายแทนแต่ไม่ได้กิน/ใช้ด้วย</small></span><span class="switch"><input type="checkbox" name="me" checked><span></span></span></label>
      <div class="field"><span>หมวด (ส่วนของเรา)</span><div class="chips" data-cats>${categoryChips('expense', 'c_food')}</div></div>
      <div class="field-row">
        <label class="field"><span>จ่ายจาก</span>${walletSelect('walletId', F.defaultWalletId())}</label>
        <label class="field"><span>วันที่</span><input name="date" type="date" value="${today()}"></label>
      </div>
      <p class="hint" data-calc></p>
      <div class="sheet-actions"><button class="btn btn-primary grow">หาร</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const f = form.elements;
      bindCategoryAdd(sheet);
      const read = () => {
        const total = parseAmount(f.total.value) || 0;
        const names = f.people.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        const n = names.length + (f.me.checked ? 1 : 0);
        const share = n ? Math.ceil((total / n) * 100) / 100 : 0;
        const myShare = f.me.checked ? Math.max(0, Math.round((total - share * names.length) * 100) / 100) : 0;
        return { total, names, share, myShare };
      };
      const calc = () => {
        const v = read();
        sheet.querySelector('[data-calc]').textContent = v.total && v.names.length ? `หาร ${v.names.length + (f.me.checked ? 1 : 0)} คน · คนละ ${money(v.share)}${f.me.checked ? ` · ส่วนของเรา ${money(v.myShare)}` : ''}` : '';
      };
      form.oninput = calc;
      form.onchange = calc;
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = read();
        const title = f.title.value.trim() || 'หารค่าใช้จ่าย';
        if (!(v.total > 0)) return toast('ใส่ยอดรวมก่อน');
        if (!v.names.length) return toast('ใส่ชื่อเพื่อนอย่างน้อย 1 คน');
        const id = uid();
        const date = f.date.value || today();
        const walletId = f.walletId.value;
        const categoryId = form.querySelector('[name=categoryId]:checked')?.value || 'c_food';
        store.batch(() => {
          const txIds = [];
          if (v.myShare > 0) txIds.push(saveTx({ type: 'expense', amount: v.myShare, walletId, categoryId, payee: title, note: `ส่วนของเรา (หาร)`, date, splitId: id }).id);
          txIds.push(saveTx({ type: 'expense', amount: Math.round((v.total - v.myShare) * 100) / 100, walletId, categoryId, payee: title, note: 'ออกให้เพื่อนก่อน', date, excluded: true, splitId: id }).id);
          store.put('splits', { id, title, date, total: v.total, myShare: v.myShare, walletId, categoryId, txIds, people: v.names.map((name) => ({ id: uid(), name, amount: v.share, paid: false })) });
        });
        close();
        splitSheet(store.get('splits', id));
      };
    },
  });
}

function splitSheet(s) {
  openSheet({
    title: s.title,
    body: '<div data-split></div>',
    onMount(sheet, close) {
      const box = sheet.querySelector('[data-split]');
      const draw = () => {
        s = store.get('splits', s.id);
        if (!s) return close();
        const info = F.splitInfo(s);
        box.innerHTML = `
          <p class="small">${money(s.total)} · ${fmtDate(s.date)} · หาร ${s.people.length + (s.myShare ? 1 : 0)} คน${s.myShare ? ` · ส่วนของเรา ${money(s.myShare)}` : ''}</p>
          ${progress(info.owed ? info.got / info.owed : 1)}
          <p class="small muted">${info.done ? 'ได้คืนครบแล้ว 🎉' : `ได้คืนแล้ว ${money(info.got)} จาก ${money(info.owed)}`}</p>
          <div class="list card">
            ${s.people
              .map(
                (p) => `<div class="row" data-pid="${p.id}">
                  <span class="avatar" style="--c:${p.paid ? 'var(--accent)' : '#9aa1ab'}">${esc(p.name.slice(0, 1))}</span>
                  <span class="row-text"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${p.paid ? 'จ่ายแล้ว' : `รอโอน ${money(p.amount)}`}</span></span>
                  ${p.paid ? '' : `<button class="icon-btn sm" data-a="qr" aria-label="QR ของ ${esc(p.name)}">${icon('scan', 18)}</button>`}
                  <button class="btn btn-sm ${p.paid ? '' : 'btn-primary'}" data-a="toggle">${p.paid ? 'ยกเลิก' : 'ได้คืนแล้ว'}</button>
                </div>`
              )
              .join('')}
          </div>
          <div class="btn-row">
            ${info.done ? '' : `<button class="btn btn-primary" data-a="share">ส่งสรุปเข้ากลุ่ม</button>`}
            <button class="btn btn-danger-ghost" data-a="delete">${icon('trash', 18)} ลบ</button>
          </div>`;
      };
      draw();
      box.onclick = async (e) => {
        const btn = e.target.closest('[data-a]');
        if (!btn) return;
        const p = s.people.find((x) => x.id === btn.closest('[data-pid]')?.dataset.pid);
        const a = btn.dataset.a;
        if (a === 'toggle') {
          store.batch(() => {
            let txId = p.txId;
            if (!p.paid) txId = saveTx({ type: 'income', amount: p.amount, walletId: s.walletId, payee: p.name, note: `${p.name} คืนค่า${s.title}`, date: today(), excluded: true, splitId: s.id, categoryId: L.categories('income').at(-1)?.id }).id;
            else if (txId) store.remove('transactions', txId);
            store.patch('splits', s.id, { people: s.people.map((x) => (x.id === p.id ? { ...x, paid: !x.paid, txId: x.paid ? null : txId } : x)) });
          });
          return draw();
        }
        if (a === 'qr') return qrSheet({ amount: p.amount, title: `${p.name} · ${s.title}`, message: `${p.name} ค่า${s.title} ${money(p.amount)} สแกน QR พร้อมเพย์ได้เลย 🙏` });
        if (a === 'share') {
          const waiting = s.people.filter((x) => !x.paid);
          const text = `หารค่า${s.title} ${money(s.total)}\n${waiting.map((x) => `• ${x.name} ${money(x.amount)}`).join('\n')}\nสแกน QR พร้อมเพย์ได้เลย 🙏`;
          const same = waiting.every((x) => x.amount === waiting[0].amount);
          if (same && store.settings().promptpay) {
            try {
              const canvas = await pp.qrCanvas(pp.payload(store.settings().promptpay, waiting[0].amount));
              const file = new File([await pp.canvasBlob(canvas)], 'promptpay.png', { type: 'image/png' });
              return shareOrCopy({ text, file });
            } catch {
              // ส่งแค่ข้อความ
            }
          }
          return shareOrCopy({ text });
        }
        if (a === 'delete') {
          if (!(await confirmBox(`ลบรายการหาร "${s.title}" และรายการเงินที่เกี่ยวข้อง?`, { ok: 'ลบ', danger: true }))) return;
          store.batch(() => {
            for (const id of [...(s.txIds || []), ...s.people.map((x) => x.txId).filter(Boolean)]) store.remove('transactions', id);
            store.remove('splits', s.id);
          });
          close();
        }
      };
    },
  });
}

// ---------- บิลประจำ (ฟอร์ม) ----------

function editBill(r, suggestion) {
  const isNew = !r;
  r ??= {
    name: suggestion?.payee || '',
    payee: suggestion?.payee || '',
    type: 'expense',
    amount: suggestion?.amount || '',
    categoryId: suggestion?.categoryId || '',
    walletId: suggestion?.walletId || F.defaultWalletId(),
    day: suggestion?.day || 1,
    startDate: today(),
    installments: null,
    auto: false,
    active: true,
  };
  openSheet({
    title: isNew ? 'เพิ่มบิลประจำ' : 'แก้ไขบิลประจำ',
    body: `<form class="form" novalidate>
      <div class="seg">
        <label><input type="radio" name="type" value="expense" ${r.type === 'expense' ? 'checked' : ''}><span>บิล / รายจ่าย</span></label>
        <label><input type="radio" name="type" value="income" ${r.type === 'income' ? 'checked' : ''}><span>รายรับประจำ</span></label>
      </div>
      <label class="field"><span>ชื่อ</span><input name="name" value="${esc(r.name)}" placeholder="เช่น ค่าผ่อนรถ, Netflix" maxlength="60" autofocus></label>
      <div class="field-row">
        <label class="field"><span>ยอด</span><input name="amount" inputmode="decimal" value="${r.amount}" placeholder="0"></label>
        <label class="field"><span>ทุกวันที่</span>
          <select name="day">${Array.from({ length: 31 }, (_, i) => `<option ${i + 1 === r.day ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
        </label>
      </div>
      <label class="field"><span>ชื่อผู้รับในสลิป (ใช้จับคู่ ถ้ามี)</span><input name="payee" value="${esc(r.payee || '')}" placeholder="เช่น NETFLIX.COM" maxlength="60"></label>
      <div class="field"><span>หมวดหมู่</span><div class="chips" data-cats>${categoryChips(r.type, r.categoryId)}</div></div>
      <div class="field-row">
        <label class="field"><span>จ่ายจาก / เข้า</span>${walletSelect('walletId', r.walletId || F.defaultWalletId())}</label>
        <label class="field"><span>ผ่อนกี่งวด (ถ้ามี)</span><input name="installments" type="number" inputmode="numeric" min="1" value="${r.installments || ''}" placeholder="ไม่จำกัด"></label>
      </div>
      <label class="field"><span>เริ่มตั้งแต่</span><input name="startDate" type="date" value="${r.startDate}"></label>
      <label class="toggle-row"><span>บันทึกให้อัตโนมัติเมื่อถึงวัน<small>เหมาะกับรายการที่ตัดบัตร/ตัดบัญชีเอง ถ้าปิด แอปจะเตือนให้กด "จ่ายแล้ว"</small></span>
        <span class="switch"><input type="checkbox" name="auto" ${r.auto !== false ? 'checked' : ''}><span></span></span></label>
      <div class="sheet-actions">
        ${isNew ? '' : `<button type="button" class="btn btn-danger-ghost" data-delete>${icon('trash', 18)} ลบ</button>`}
        <button class="btn btn-primary grow">บันทึก</button>
      </div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const f = form.elements;
      bindCategoryAdd(sheet);
      form.querySelectorAll('[name=type]').forEach((x) => {
        x.onchange = () => (sheet.querySelector('[data-cats]').innerHTML = categoryChips(x.value, ''));
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        const amount = parseAmount(f.amount.value);
        if (!name) return f.name.focus();
        if (!(amount > 0)) return toast('ใส่ยอดก่อน');
        const type = f.type.value;
        store.put('recurring', {
          ...r,
          name,
          type,
          amount,
          payee: f.payee.value.trim(),
          categoryId: form.querySelector('[name=categoryId]:checked')?.value || L.categories(type).at(-1)?.id,
          walletId: f.walletId.value,
          day: Number(f.day.value),
          installments: parseInt(f.installments.value, 10) || null,
          startDate: f.startDate.value || today(),
          auto: f.auto.checked,
          createdAt: r.createdAt || Date.now(),
        });
        L.generateRecurring();
        close();
        toast('บันทึกแล้ว');
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`ลบบิล "${r.name}"? รายการที่จ่ายไปแล้วยังอยู่`, { ok: 'ลบ', danger: true }))) return;
        store.remove('recurring', r.id);
        close();
      });
    },
  });
}

// ---------- งบ / เป้าออม ----------

// แผ่น "หมวดและงบ": ตั้งงบรายเดือน + เพิ่ม/แก้ชื่อ/เปลี่ยนสี/ลบหมวด
function editBudgets() {
  openSheet({
    title: 'หมวดและงบ',
    body: `<form class="form" novalidate>
      <p class="muted small">แตะชื่อหมวดเพื่อแก้ชื่อ เปลี่ยนสี หรือลบ · ใส่งบต่อเดือนของหมวดรายจ่าย เว้นว่างถ้าไม่ต้องการตั้งงบ</p>
      <div class="stack" data-list></div>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึกงบ</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const list = sheet.querySelector('[data-list]');
      const nameBtn = (c) =>
        `<button type="button" class="cat-name" data-edit="${c.id}"><i class="dot" style="background:${c.color}"></i>${esc(c.name)}${icon('edit', 14)}</button>`;
      // วาดใหม่หลังแก้หมวด โดยเก็บงบที่พิมพ์ค้างไว้ไม่ให้หาย
      const draw = () => {
        const typed = Object.fromEntries([...list.querySelectorAll('input[data-budget]')].map((i) => [i.name, i.value]));
        list.innerHTML = ['expense', 'income']
          .map(
            (type) => `<div class="cat-group">
              <div class="row-between"><b class="small">${type === 'expense' ? 'รายจ่าย' : 'รายรับ'}</b>
                <button type="button" class="link" data-new="${type}">+ เพิ่มหมวด</button></div>
              ${
                L.categories(type)
                  .map((c) =>
                    type === 'expense'
                      ? `<div class="field inline">${nameBtn(c)}<input name="${c.id}" data-budget inputmode="decimal" placeholder="—" value="${esc(typed[c.id] ?? (c.budget || ''))}" aria-label="งบ ${esc(c.name)}"></div>`
                      : `<div class="cat-line">${nameBtn(c)}</div>`
                  )
                  .join('') || '<p class="muted small">ยังไม่มีหมวด</p>'
              }
            </div>`
          )
          .join('');
      };
      draw();
      list.onclick = (e) => {
        const edit = e.target.closest('[data-edit]');
        const add = e.target.closest('[data-new]');
        if (edit) editCategory(store.get('categories', edit.dataset.edit), draw);
        else if (add) editCategory({ type: add.dataset.new }, draw);
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        store.batch(() => {
          for (const input of list.querySelectorAll('input[data-budget]')) {
            const c = store.get('categories', input.name);
            if (!c) continue;
            const v = parseAmount(input.value);
            const budget = v > 0 ? v : 0;
            if (budget !== (c.budget || 0)) store.patch('categories', c.id, { budget });
          }
        });
        close();
        toast('บันทึกงบแล้ว');
      };
    },
  });
}

// แก้หรือเพิ่มหมวด (c ไม่มี id = หมวดใหม่ของประเภท c.type)
function editCategory(c, after) {
  const isNew = !c.id;
  const color = c.color || COLORS[L.categories().length % COLORS.length];
  openSheet({
    title: isNew ? `เพิ่มหมวด${c.type === 'income' ? 'รายรับ' : 'รายจ่าย'}` : 'แก้ไขหมวด',
    body: `<form class="form" novalidate>
      <label class="field"><span>ชื่อหมวด</span><input name="name" value="${esc(c.name || '')}" maxlength="40" autofocus></label>
      <div class="field"><span>สี</span>${colorPicker(COLORS, color)}</div>
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
        if (L.categories(c.type).some((x) => x.id !== c.id && x.name.trim().toLowerCase() === name.toLowerCase())) return toast('มีหมวดชื่อนี้อยู่แล้ว');
        store.put('categories', {
          budget: 0,
          ...c,
          name,
          color: form.elements.color.value,
          order: c.order ?? L.categories().length,
        });
        close();
        after?.();
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`ลบหมวด "${c.name}"? รายการเดิมในหมวดนี้จะแสดงเป็น "ไม่มีหมวด"`, { ok: 'ลบ', danger: true }))) return;
        store.remove('categories', c.id);
        close();
        after?.();
      });
    },
  });
}

function editGoal(g) {
  const isNew = !g;
  g ??= { name: '', target: '', saved: 0, deadline: '', color: COLORS[store.all('goals').length % COLORS.length] };
  openSheet({
    title: isNew ? 'ตั้งเป้าออม' : 'แก้ไขเป้าออม',
    body: `<form class="form" novalidate>
      <label class="field"><span>ชื่อเป้าหมาย</span><input name="name" value="${esc(g.name)}" placeholder="เช่น เงินสำรองฉุกเฉิน, เที่ยวญี่ปุ่น" maxlength="60" autofocus></label>
      <div class="field-row">
        <label class="field"><span>เป้าหมาย (บาท)</span><input name="target" inputmode="decimal" value="${g.target}" placeholder="0"></label>
        <label class="field"><span>ออมแล้ว (บาท)</span><input name="saved" inputmode="decimal" value="${g.saved || ''}" placeholder="0"></label>
      </div>
      <label class="field"><span>อยากถึงเป้าภายในเดือน (ถ้ามี)</span><input name="deadline" type="month" value="${g.deadline || ''}"></label>
      <div class="field"><span>สี</span>${colorPicker(COLORS, g.color)}</div>
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
        const targetAmt = parseAmount(form.elements.target.value);
        if (!name) return form.elements.name.focus();
        if (!(targetAmt > 0)) return toast('ใส่จำนวนเงินเป้าหมายก่อน');
        store.put('goals', {
          ...g,
          name,
          target: targetAmt,
          saved: parseAmount(form.elements.saved.value) || 0,
          deadline: form.elements.deadline.value,
          color: form.elements.color.value,
          createdAt: g.createdAt || Date.now(),
        });
        close();
      };
      sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`ลบเป้าหมาย "${g.name}"?`, { ok: 'ลบ', danger: true }))) return;
        store.remove('goals', g.id);
        close();
      });
    },
  });
}

export function addToGoal(g) {
  openSheet({
    title: `ออมเพิ่ม: ${g.name}`,
    body: `<form class="form" novalidate>
      <label class="field amount-field"><span>จำนวนเงิน (บาท)</span><input name="amount" inputmode="decimal" placeholder="0" autofocus autocomplete="off"></label>
      <p class="hint">ใส่ค่าติดลบได้ ถ้าถอนออกจากเป้านี้</p>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const amt = parseAmount(form.elements.amount.value);
        if (!amt) return form.elements.amount.focus();
        const cur = store.get('goals', g.id);
        store.patch('goals', g.id, { saved: Math.max(0, Math.round(((cur.saved || 0) + amt) * 100) / 100) });
        close();
        toast(amt > 0 ? `ออมเพิ่ม ${money(amt)} แล้ว` : 'บันทึกแล้ว');
      };
    },
  });
}

function askText(title, placeholder, onOk) {
  openSheet({
    title,
    body: `<form class="form" novalidate>
      <textarea name="text" rows="3" class="note-input" placeholder="${esc(placeholder)}" autofocus></textarea>
      <div class="sheet-actions"><button class="btn btn-primary grow">บันทึก</button></div>
    </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = form.elements.text.value.trim();
        if (text) onOk(text);
        close();
      };
    },
  });
}
