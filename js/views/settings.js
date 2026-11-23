import * as store from '../store.js';
import * as L from '../logic.js';
import * as sync from '../sync.js';
import { APP_VERSION } from '../config.js';
import { esc, fmtDateTime } from '../utils.js';
import { icon, openSheet, confirmBox, toast, emptyState } from '../ui.js';
import { calendarItems, downloadCalendar, isIOS } from '../reminders.js';

const STATUS_TEXT = {
  off: 'ยังไม่ได้เชื่อมต่อ',
  idle: 'ซิงค์แล้ว',
  syncing: 'กำลังซิงค์…',
  offline: 'ออฟไลน์ — จะซิงค์เมื่อกลับมาออนไลน์',
  needAuth: 'ต้องเข้าสู่ระบบอีกครั้ง',
  error: 'ซิงค์ไม่สำเร็จ',
};

export function render(root) {
  const s = store.settings();
  const connected = sync.isConnected();
  const acct = sync.account();
  const archived = store.all('habits').filter((h) => h.archived);
  const calOpts = { tasks: s.calTasks !== false, allDay: !!s.calAllDay, habits: s.calHabits !== false };
  const cal = calendarItems(calOpts);

  root.innerHTML = `
    <header class="page-head"><h1>ตั้งค่า</h1></header>

    <h3 class="section-label">บัญชี Google และการซิงค์</h3>
    <div class="card pad stack">
      ${
        !sync.isConfigured()
          ? `<p class="small">ยังไม่ได้ใส่ Google Client ID ในไฟล์ <code>js/config.js</code> ตอนนี้ข้อมูลเก็บเฉพาะในเครื่องนี้</p>
             <p class="small muted">ดูวิธีตั้งค่าใน README.md · Redirect URI ที่ต้องลงทะเบียน:<br><code class="break">${esc(sync.redirectUri())}</code></p>`
          : connected
            ? `<div class="row-between">
                 <div><b>${esc(acct?.email || 'Google')}</b><div class="small muted">${STATUS_TEXT[sync.status.state] || ''}${sync.lastSync() ? ` · ล่าสุด ${fmtDateTime(sync.lastSync())}` : ''}</div></div>
                 <span class="sync-dot ${sync.status.state}"></span>
               </div>
               <div class="btn-row">
                 ${sync.status.state === 'needAuth' ? `<button class="btn btn-primary" data-act="connect">เข้าสู่ระบบอีกครั้ง</button>` : `<button class="btn" data-act="sync">${icon('cloud', 18)} ซิงค์ตอนนี้</button>`}
                 <button class="btn btn-danger-ghost" data-act="disconnect">ยกเลิกการเชื่อมต่อ</button>
               </div>
               <label class="toggle-row"><span>เข้าสู่ระบบอัตโนมัติเมื่อเปิดแอป<small>Google ให้สิทธิ์ครั้งละ 1 ชั่วโมง แอปจะขอใหม่ให้เองตอนเปิด</small></span>
                 <span class="switch"><input type="checkbox" data-set="autoConnect" ${s.autoConnect ? 'checked' : ''}><span></span></span></label>`
            : `<p class="small">เชื่อมต่อ Google เพื่อเก็บข้อมูลใน Google Drive ของคุณ และใช้ข้อมูลเดียวกันได้ทั้งมือถือและคอม</p>
               <p class="small muted">แอปเข้าถึงได้เฉพาะไฟล์ที่แอปสร้างเองในโฟลเดอร์ "Note Me" เท่านั้น</p>
               <button class="btn btn-primary" data-act="connect">เชื่อมต่อด้วย Google</button>`
      }
    </div>

    <h3 class="section-label">สำรองข้อมูล</h3>
    <div class="card pad stack">
      <label class="field inline"><span>สำรองอัตโนมัติทุก</span>
        <select data-set="backupIntervalDays">
          ${[[0, 'ปิด'], [1, '1 วัน'], [3, '3 วัน'], [7, '7 วัน'], [14, '14 วัน'], [30, '30 วัน']]
            .map(([v, l]) => `<option value="${v}" ${v === s.backupIntervalDays ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </label>
      <label class="field inline"><span>เก็บไฟล์สำรองล่าสุด</span>
        <select data-set="backupKeep">
          ${[5, 10, 20, 30, 60].map((v) => `<option value="${v}" ${v === s.backupKeep ? 'selected' : ''}>${v} ชุด</option>`).join('')}
        </select>
      </label>
      <p class="small muted">${s.lastBackupAt ? `สำรองล่าสุด ${fmtDateTime(s.lastBackupAt)}` : 'ยังไม่เคยสำรอง'} ·
        ${connected ? 'สำรองไว้ในโฟลเดอร์ Note Me/backups ใน Google Drive' : 'ยังไม่เชื่อม Google จะเตือนให้ดาวน์โหลดไฟล์เมื่อถึงกำหนด'}</p>
      <div class="btn-grid">
        <button class="btn" data-act="backup-now" ${connected ? '' : 'disabled'}>${icon('cloud', 18)} สำรองตอนนี้</button>
        <button class="btn" data-act="restore-drive" ${connected ? '' : 'disabled'}>${icon('repeat', 18)} กู้คืนจาก Drive</button>
        <button class="btn" data-act="download">${icon('download', 18)} ดาวน์โหลดลงเครื่อง</button>
        <button class="btn" data-act="import">${icon('upload', 18)} นำเข้าจากไฟล์</button>
      </div>
      <input type="file" accept="application/json,.json" hidden data-file>
    </div>

    <h3 class="section-label">ซิงค์กับปฏิทิน</h3>
    <div class="card pad stack">
      <p class="small">ส่งงานและกิจวัตรไปเป็นนัดในแอปปฏิทินของเครื่อง เพื่อให้มีเสียงเตือนตรงเวลาแม้ไม่ได้เปิด Note Me</p>
      <label class="toggle-row"><span>งานที่ตั้งเวลาไว้<small>เป็นนัดพร้อมเสียงเตือน (${cal.tasks.length} งาน)</small></span>
        <span class="switch"><input type="checkbox" data-set="calTasks" ${s.calTasks !== false ? 'checked' : ''}><span></span></span></label>
      <label class="toggle-row"><span>งานที่มีแค่วันที่<small>เป็นนัดทั้งวัน ไม่มีเสียงเตือน</small></span>
        <span class="switch"><input type="checkbox" data-set="calAllDay" ${s.calAllDay ? 'checked' : ''}><span></span></span></label>
      <label class="toggle-row"><span>กิจวัตรที่ตั้งเวลาเตือน<small>${cal.habits.length} กิจวัตร</small></span>
        <span class="switch"><input type="checkbox" data-set="calHabits" ${s.calHabits !== false ? 'checked' : ''}><span></span></span></label>
      <button class="btn btn-primary" data-act="calendar" ${cal.tasks.length + cal.habits.length ? '' : 'disabled'}>${icon('plan', 18)} ส่งไปที่ปฏิทิน (${cal.tasks.length + cal.habits.length} รายการ)</button>
      <p class="hint">ได้ไฟล์ .ics ${isIOS() ? 'บน iPhone ให้แตะเปิดไฟล์แล้วเลือก "เพิ่มทั้งหมด"' : 'เปิดด้วยปฏิทินของเครื่อง หรือนำเข้า Google Calendar'} · แนะนำให้เลือกเก็บในปฏิทินแยกชื่อ "Note Me" เวลาส่งใหม่หลังแก้งาน จะลบทั้งปฏิทินนั้นแล้วนำเข้าใหม่ได้ง่าย ไม่มีนัดซ้ำ</p>
    </div>

    <h3 class="section-label">กิจวัตรที่เก็บถาวร</h3>
    <div class="list card">
      ${
        archived.length
          ? archived
              .map(
                (h) => `<div class="row" data-id="${h.id}">
                  <span class="swatch" style="--c:${h.color}"></span>
                  <span class="row-text"><span class="row-title">${esc(h.name)}</span></span>
                  <button class="btn btn-sm" data-act="unarchive">นำกลับมา</button>
                </div>`
              )
              .join('')
          : emptyState('ไม่มี')
      }
    </div>

    <p class="footer-note">Note Me v${APP_VERSION}</p>
  `;

  root.querySelectorAll('[data-set]').forEach((el) => {
    el.onchange = () => {
      const v = el.type === 'checkbox' ? el.checked : Number(el.value);
      store.setSettings({ [el.dataset.set]: v });
    };
  });

  const fileInput = root.querySelector('[data-file]');
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!store.isValidDoc(data)) throw new Error('invalid');
      await restoreFrom(data, `ไฟล์ ${file.name}`);
    } catch {
      toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ Note Me');
    }
  };

  root.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.closest('[data-id]')?.dataset.id;
    switch (el.dataset.act) {
      case 'connect':
        return sync.connect();
      case 'sync':
        await sync.sync();
        return toast(sync.status.state === 'idle' ? 'ซิงค์แล้ว' : STATUS_TEXT[sync.status.state]);
      case 'disconnect':
        if (await confirmBox('ยกเลิกการเชื่อมต่อ Google? ข้อมูลในเครื่องและใน Drive ยังอยู่ครบ', { ok: 'ยกเลิกการเชื่อมต่อ' })) {
          sync.disconnect();
          render(root);
        }
        return;
      case 'backup-now':
        return runBusy(el, async () => {
          await sync.backupNow();
          toast('สำรองข้อมูลแล้ว');
        });
      case 'download':
        sync.downloadToDevice();
        return;
      case 'calendar':
        return toast(`ส่งไปปฏิทินแล้ว ${downloadCalendar(calOpts)} รายการ`);
      case 'import':
        return fileInput.click();
      case 'restore-drive':
        return chooseDriveBackup();
      case 'unarchive':
        store.patch('habits', id, { archived: false });
        return toast('นำกลับมาแล้ว');
    }
  };
}

async function runBusy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast('ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง');
  } finally {
    btn.disabled = false;
  }
}

async function restoreFrom(data, label) {
  if (!(await confirmBox(`กู้คืนข้อมูลจาก${label}? ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด (แนะนำให้ดาวน์โหลดไฟล์สำรองปัจจุบันเก็บไว้ก่อน)`, { ok: 'กู้คืน', danger: true }))) return;
  // ซิงค์ก่อน เพื่อให้ข้อมูลที่ยังไม่ได้ดึงจาก Drive ถูกแทนที่ด้วย ไม่โผล่กลับมาทีหลัง
  if (sync.isConnected()) await sync.sync();
  store.restore(data);
  L.generateRecurring();
  toast('กู้คืนข้อมูลแล้ว');
}

function chooseDriveBackup() {
  openSheet({
    title: 'กู้คืนจาก Google Drive',
    body: '<div data-list><p class="muted small">กำลังโหลด…</p></div>',
    async onMount(sheet, close) {
      const box = sheet.querySelector('[data-list]');
      try {
        const files = await sync.listBackups();
        box.innerHTML = files.length
          ? `<div class="list">${files
              .map(
                (f) => `<button class="row" data-file-id="${f.id}">
                  <span class="row-text"><span class="row-title">${fmtDateTime(Date.parse(f.createdTime))}</span>
                  <span class="row-sub">${esc(f.name)} · ${Math.max(1, Math.round((f.size || 0) / 1024))} KB</span></span>
                  ${icon('right', 18)}
                </button>`
              )
              .join('')}</div>`
          : emptyState('ยังไม่มีไฟล์สำรองใน Drive');
      } catch (e) {
        console.error(e);
        box.innerHTML = emptyState('โหลดรายการไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่');
      }
      box.onclick = async (e) => {
        const row = e.target.closest('[data-file-id]');
        if (!row) return;
        try {
          const data = await sync.downloadBackup(row.dataset.fileId);
          if (!store.isValidDoc(data)) throw new Error('invalid');
          close();
          await restoreFrom(data, 'ไฟล์สำรองวันที่ ' + row.querySelector('.row-title').textContent);
        } catch (err) {
          console.error(err);
          toast('เปิดไฟล์สำรองไม่สำเร็จ');
        }
      };
    },
  });
}
