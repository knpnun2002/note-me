import * as store from './store.js';
import * as L from './logic.js';
import * as sync from './sync.js';
import { icon } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as habits from './views/habits.js';
import * as plan from './views/plan.js';
import * as money from './views/money.js';
import * as settings from './views/settings.js';

const ROUTES = {
  home: { view: dashboard, label: 'หน้าหลัก', icon: 'home' },
  habits: { view: habits, label: 'กิจวัตร', icon: 'habits' },
  plan: { view: plan, label: 'แพลน', icon: 'plan' },
  money: { view: money, label: 'การเงิน', icon: 'money' },
  settings: { view: settings, label: 'ตั้งค่า', icon: 'settings' },
};

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const route = () => {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES[r] ? r : 'home';
};

function renderNav() {
  const cur = route();
  nav.innerHTML = `
    <div class="brand">Note Me <span class="sync-dot ${sync.status.state}" title="สถานะซิงค์"></span></div>
    ${Object.entries(ROUTES)
      .map(
        ([k, r]) =>
          `<a href="#/${k === 'home' ? '' : k}" class="${k === cur ? 'sel' : ''}" ${k === cur ? 'aria-current="page"' : ''}>${icon(r.icon, 22)}<span>${r.label}</span></a>`
      )
      .join('')}`;
}

let lastRoute = null;
function render() {
  const cur = route();
  ROUTES[cur].view.render(main);
  renderNav();
  if (cur !== lastRoute) {
    scrollTo(0, 0);
    lastRoute = cur;
  }
}

async function start() {
  await store.load();
  const redirect = sync.handleRedirect();
  L.generateRecurring();

  store.subscribe((opts) => {
    if (opts.silent) return;
    // ข้อมูลจากการซิงค์มาระหว่างกำลังพิมพ์: รอให้พิมพ์เสร็จก่อนค่อยวาดใหม่ ข้อความจะได้ไม่หาย
    const active = document.activeElement;
    if (opts.fromSync && main.contains(active) && active.matches('input, textarea')) {
      active.addEventListener('blur', () => setTimeout(render, 400), { once: true });
      return;
    }
    render();
  });
  sync.onStatus(() => {
    // หน้าตั้งค่าและหน้าหลักแสดงสถานะซิงค์ ที่เหลืออัปเดตแค่จุดสถานะ
    if (['settings', 'home'].includes(route())) render();
    else renderNav();
  });
  addEventListener('hashchange', render);

  // เปิดแอปข้ามวัน: วาดใหม่ให้ "วันนี้" ถูกต้อง และสร้างรายการประจำที่ถึงกำหนด
  let day = new Date().toDateString();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || new Date().toDateString() === day) return;
    day = new Date().toDateString();
    L.generateRecurring();
    render();
  });

  render();
  sync.init(redirect);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}

start().catch((e) => {
  console.error(e);
  main.innerHTML = `<div class="card pad"><b>เปิดแอปไม่สำเร็จ</b><p class="small muted">${String(e.message || e)}</p></div>`;
});
