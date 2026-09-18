import { readFileSync, writeFileSync } from 'node:fs';

const path='index.html';
let html=readFileSync(path,'utf8');
const startMarker='  // Fallback path — the existing, fully local engine. This is what actually';
const start=html.indexOf(startMarker);
if(start<0){
  if(!html.includes('Canonical endpoint unavailable — local business-intelligence fallback retired.')){
    throw new Error('Phase N fallback start marker not found');
  }
  process.exit(0);
}
const endMarker='\n}\nfunction escapeHtml';
const end=html.indexOf(endMarker,start);
if(end<0) throw new Error('Phase N fallback end marker not found');

const replacement=[
  '  // Canonical endpoint unavailable — local business-intelligence fallback retired.',
  '  // Never let the browser become a second source of business recommendations,',
  '  // prices, availability, or itinerary truth. The server-side One-Mind is',
  '  // authoritative; browser fallback is presentation-only.',
  '  await new Promise(r=> setTimeout(r, 220));',
  '  hideTyping();',
  "  const lang = window.I18N ? window.I18N.lang() : 'th';",
  '  const unavailableCopy = {',
  "    th:'ตอนนี้เชื่อมต่อทองไทยไม่ได้ชั่วคราวครับ ลองส่งอีกครั้งอีกสักครู่',",
  "    en:'Thongthai is temporarily unavailable. Please try again in a moment.',",
  "    zh:'Thongthai 暂时无法连接，请稍后再试。',",
  "    lo:'ຕອນນີ້ຍັງເຊື່ອມຕໍ່ທອງໄທບໍ່ໄດ້ ກະລຸນາລອງອີກຄັ້ງໃນອີກສັກຄູ່',",
  "    vi:'Thongthai tạm thời chưa kết nối được. Vui lòng thử lại sau ít phút.',",
  "  }[lang] || 'Thongthai is temporarily unavailable. Please try again in a moment.';",
  "  addMessage('bot', unavailableCopy);",
  "  window.JourneyProvider.pushChat('assistant', unavailableCopy);",
  "  statusEl.textContent = t('chat_status_ready');",
  '  renderQuickActions();',
].join('\n');

html=html.slice(0,start)+replacement+html.slice(end);
writeFileSync(path,html);
console.log('Phase N: retired active ConciergeProvider.reply fallback');
