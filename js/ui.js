import { esc } from './utils.js';

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  habits: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
  plan: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  money: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19M16 15h2.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>',
  more: '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>',
  flag: '<path d="M5 21V4h12l-2.5 4 2.5 4H5"/>',
  hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  subtask: '<path d="M6 4v9a3 3 0 0 0 3 3h9"/><path d="m15 13 3 3-3 3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
};

export function icon(name, size = 20) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

// ---------- Sheet (ล่างจอบนมือถือ, กลางจอบนคอม) ----------

const openSheets = [];

export function openSheet({ title, body, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="ปิด">${icon('x')}</button>
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.append(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('open'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets.splice(openSheets.indexOf(close), 1);
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    if (!openSheets.length) document.body.classList.remove('no-scroll');
    onClose?.();
  };
  openSheets.push(close);

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-backdrop')) close();
  });
  const sheet = wrap.querySelector('.sheet');
  onMount?.(sheet, close);
  const auto = sheet.querySelector('[autofocus]');
  if (auto && matchMedia('(hover: hover)').matches) auto.focus();
  return close;
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1]();
});

export function confirmBox(message, { ok = 'ยืนยัน', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title: 'ยืนยัน',
      body: `<p class="confirm-text">${esc(message)}</p>
        <div class="sheet-actions">
          <button type="button" class="btn" data-close>ยกเลิก</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
        </div>`,
      onMount(el, close) {
        el.querySelector('[data-ok]').onclick = () => {
          answered = true;
          resolve(true);
          close();
        };
      },
      onClose: () => answered || resolve(false),
    });
  });
}

let toastTimer;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// แถบสีความคืบหน้า
export function progress(ratio, color, cls = '') {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return `<div class="progress ${cls}"><span style="width:${pct.toFixed(1)}%;${color ? `background:${color}` : ''}"></span></div>`;
}

// วงแหวนเปอร์เซ็นต์ (ratio = null แสดงขีด)
export function ring(ratio, color = 'var(--accent)', caption = '') {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = ratio == null ? null : Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return `<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${pct ?? 0}%">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${(((pct || 0) / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="${caption ? 31 : 36}" text-anchor="middle" class="ring-value">${pct == null ? '—' : `${pct}%`}</text>
    ${caption ? `<text x="32" y="43" text-anchor="middle" class="ring-caption">${esc(caption)}</text>` : ''}
  </svg>`;
}

export function colorPicker(colors, selected, name = 'color') {
  return `<div class="color-pick">${colors
    .map(
      (c) =>
        `<label style="--c:${c}"><input type="radio" name="${name}" value="${c}" ${c === selected ? 'checked' : ''}><span></span></label>`
    )
    .join('')}</div>`;
}

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

// โหลดไลบรารีจาก CDN ครั้งเดียวเมื่อจำเป็น (QR, อ่านสลิป)
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          scripts.delete(src);
          reject(new Error(`โหลด ${src} ไม่สำเร็จ`));
        };
        document.head.append(s);
      })
    );
  }
  return scripts.get(src);
}

// ปัดซ้าย/ขวาบนแถว (มือถือ): item ต้องมี .swipe-bg และแถวด้านในที่จะเลื่อน (rowSel)
// ปัดเกิน 80px แล้วปล่อย = เรียก onRight / onLeft และกันไม่ให้นับเป็นการแตะ
export function startSwipe(e, item, { rowSel = '.row', onRight, onLeft }) {
  const row = item.querySelector(rowSel);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dx = 0;
  let active = false;
  const move = (ev) => {
    const mx = ev.clientX - x0;
    const my = ev.clientY - y0;
    if (!active) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return cleanup();
      if (Math.abs(mx) < 12) return;
      active = true;
      item.classList.add('swiping');
    }
    dx = mx;
    row.style.transform = `translateX(${dx}px)`;
    item.dataset.dir = dx > 0 ? 'right' : 'left';
    item.classList.toggle('armed', Math.abs(dx) > 80);
  };
  const up = () => {
    cleanup();
    if (!active) return;
    const swallow = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, { capture: true }), 400);
    row.style.transition = 'transform .18s';
    row.style.transform = '';
    setTimeout(() => {
      row.style.transition = '';
      item.classList.remove('swiping', 'armed');
    }, 200);
    if (dx > 80) onRight?.(item);
    else if (dx < -80) onLeft?.(item);
  };
  const cleanup = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

// แชร์ข้อความ (และรูป) ผ่านเมนูแชร์ของเครื่อง เช่น ส่งเข้า LINE ถ้าแชร์ไม่ได้ให้คัดลอกข้อความแทน
export async function shareOrCopy({ text, file }) {
  try {
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ text, files: [file] });
    if (navigator.share) return await navigator.share({ text });
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  await navigator.clipboard?.writeText(text);
  toast('คัดลอกข้อความแล้ว วางใน LINE ได้เลย');
}
