// QR พร้อมเพย์พร้อมยอด (มาตรฐาน EMVCo ของ ธปท.) สร้างในเครื่อง ไม่ส่งข้อมูลออกไปไหน
// target: เบอร์มือถือ 10 หลัก, เลขบัตรประชาชน/ผู้เสียภาษี 13 หลัก หรือเลข e-Wallet 15 หลัก

import { loadScript } from './ui.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function isValidTarget(target) {
  const d = String(target || '').replace(/\D/g, '');
  return d.length === 10 || d.length === 13 || d.length === 15;
}

export function payload(target, amount) {
  const d = String(target).replace(/\D/g, '');
  let account;
  if (d.length === 15) account = tlv('03', d);
  else if (d.length === 13) account = tlv('02', d);
  else account = tlv('01', `0066${d.replace(/^0/, '')}`.padStart(13, '0'));
  // ลำดับฟิลด์ตามไลบรารีอ้างอิงที่ใช้กันแพร่หลาย (promptpay-qr)
  const body =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + account) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (amount ? tlv('54', Number(amount).toFixed(2)) : '') +
    '6304';
  return body + crc16(body);
}

// วาด QR ลง canvas (ใช้แชร์เป็นรูปได้)
export async function qrCanvas(text, size = 280) {
  await loadScript(QR_LIB);
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const cell = Math.floor(size / (n + margin * 2));
  const px = cell * (n + margin * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
  return canvas;
}

export const canvasBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
