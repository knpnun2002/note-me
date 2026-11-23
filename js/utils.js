// วันที่เก็บเป็นสตริง 'YYYY-MM-DD' ตามเวลาท้องถิ่น และเดือนเป็น 'YYYY-MM'

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const pad = (n) => String(n).padStart(2, '0');

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toKey(new Date());

export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export const monthOf = (k) => k.slice(0, 7);

export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// 0 = อาทิตย์ ... 6 = เสาร์
export const weekday = (k) => parseKey(k).getDay();

// สัปดาห์เริ่มวันจันทร์
export function weekStart(k) {
  return addDays(k, -((weekday(k) + 6) % 7));
}

export function dayDiff(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 864e5);
}

export const TH_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
export const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// "17 พ.ย." หรือ "17 พ.ย. 69" ถ้าคนละปีกับปัจจุบัน
export function fmtDate(k) {
  const d = parseKey(k);
  const base = `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${String(d.getFullYear() + 543).slice(2)}`;
}

// "วันอังคารที่ 17 พฤศจิกายน 2569"
export function fmtDateLong(k) {
  const d = parseKey(k);
  return `วัน${TH_DAYS[d.getDay()]}ที่ ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export function fmtMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${TH_MONTHS[m - 1]} ${y + 543}`;
}

export function relDay(k) {
  const diff = dayDiff(today(), k);
  if (diff === 0) return 'วันนี้';
  if (diff === 1) return 'พรุ่งนี้';
  if (diff === -1) return 'เมื่อวาน';
  return fmtDate(k);
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(toKey(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const moneyInt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const moneyDec = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// แสดงทศนิยม 2 ตำแหน่งเฉพาะเมื่อมีเศษสตางค์
export function money(n) {
  const v = Math.round((n || 0) * 100) / 100;
  const s = `฿${(Number.isInteger(v) ? moneyInt : moneyDec).format(Math.abs(v))}`;
  return v < 0 ? `−${s}` : s;
}

export function parseAmount(s) {
  const n = parseFloat(String(s).replace(/[,\s฿]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// สีสดใสสำหรับกิจวัตร เป้าออม และหมวดหมู่
export const COLORS = ['#16a37f', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#ef4444', '#64748b'];
