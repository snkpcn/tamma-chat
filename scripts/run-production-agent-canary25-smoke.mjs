import { createHash } from 'node:crypto';

const url = 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';
const cases = [
  {
    guestId: '35a670d1-4511-53c9-9f7e-5eb1b79c56ff',
    eventId: 'prod-agent-canary25-smoke-g1-turn1',
    message: 'ขี่ม้ามีราคาเท่าไหร่ แล้วเหมาะกับมือใหม่ไหมครับ',
  },
  {
    guestId: 'bdc9a504-9893-549a-97be-b5d766bc59a2',
    eventId: 'prod-agent-canary25-smoke-g2-turn1',
    message: 'เฮือนสเตย์มีห้องแบบไหน เช็กอินเช็กเอาต์กี่โมงครับ',
  },
  {
    guestId: '30364940-837f-5783-8995-c6bbf68ea928',
    eventId: 'prod-agent-canary25-smoke-g3-turn1',
    message: 'แฟนแพ้กุ้งและไม่กินเผ็ด มีเมนูอะไรแนะนำ 3 อย่างครับ',
  },
  {
    guestId: '07aabeea-ba60-5da9-8cbc-9e3230db91b5',
    eventId: 'prod-agent-canary25-smoke-g4-turn1',
    message: 'มากับเด็กกับผู้สูงอายุ อยากทำกิจกรรมเบาๆ แนะนำหน่อยครับ',
  },
  {
    guestId: 'e81cdc55-19e1-52e7-bb0c-67e1d06fe309',
    eventId: 'prod-agent-canary25-smoke-g5-turn1',
    message: 'OTOP มีอะไรน่าสนใจบ้าง เล่าแบบสั้นๆ ให้หน่อยครับ',
  },
];

function bucket(guestId) {
  const digest = createHash('sha256')
    .update(`thongthai-agent-primary:${guestId}`, 'utf8')
    .digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 10_000;
}

for (const item of cases) {
  const b = bucket(item.guestId);
  if (b >= 2500) throw new Error(`Smoke guest ${item.guestId} is outside 25% bucket: ${b}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guestId: item.guestId,
        eventId: item.eventId,
        message: item.message,
        language: 'th',
        chatHistory: [],
        guestContext: {},
        journeyContext: {},
        pageContext: { section: 'home' },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`Production smoke failed ${item.eventId}: HTTP ${response.status} ${text.slice(0, 240)}`);

  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new Error(`Production smoke returned non-JSON for ${item.eventId}: ${text.slice(0, 240)}`);
  }
  if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
    throw new Error(`Production smoke returned no customer message for ${item.eventId}`);
  }
  if (!/ครับ/u.test(payload.message)) {
    throw new Error(`Thongthai male persona particle missing for ${item.eventId}: ${payload.message.slice(0, 240)}`);
  }
  if (/ลองใหม่|คิดช้ากว่าปกติ|AI provider not configured|request failed/iu.test(payload.message)) {
    throw new Error(`Degraded/error reply detected for ${item.eventId}: ${payload.message.slice(0, 240)}`);
  }

  console.log(JSON.stringify({
    eventId: item.eventId,
    guestId: item.guestId,
    bucket: b,
    message: payload.message,
  }));
}

console.log('PRODUCTION_AGENT_CANARY25_SMOKE_PASS');
