import { randomUUID } from 'node:crypto';

const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL?.trim()
  || 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

type Payload = Record<string, unknown> & { message?: unknown; intent?: unknown };

const messages = [
  'อินทนินตรงตาดโตนมีอะไรแนะนำบ้างครับ',
  'ผมหมายถึงเครื่องดื่มนะครับ ไม่ได้ถามของกิน',
  'อยากได้อะไรเย็นๆ ไม่หวานมาก แต่ก็ไม่เอาขมมากครับ',
  'ถ้าไม่กินกาแฟ มีอะไรแนะนำบ้างครับ',
  'ถามเผื่อแฟนนะครับ แต่วันนี้ผมมาคนเดียว',
  'เอาจริงๆ ยังไม่สั่งนะครับ แค่เลือกไว้ก่อน',
  'เมื่อกี้ตัวที่ไม่ใช่กาแฟ มีอะไรนะครับ',
  'แล้วถ้าไม่เอานมวัว มีตัวเลือกไหมครับ',
  'ไม่ใช่ครับ ผมไม่ได้แพ้นม แค่ช่วงนี้ไม่ค่อยอยากกินนมวัว',
  'งั้นกลับมาดูกาแฟก็ได้ครับ',
  'เอาเย็นนะครับ แต่ไม่ใส่น้ำตาลเลยทำได้ไหม',
  'เดี๋ยวก่อนครับ ยังไม่ต้องทำรายการนะ',
  'ร้านวันนี้เปิดถึงกี่โมงครับ',
  'ที่จอดรถสะดวกไหมครับ',
  'กลับมาเรื่องเครื่องดื่มครับ เมื่อกี้ผมสนใจอะไรไว้',
  'ตอนนี้มีรายการอะไรของผมถูกส่งไปที่ร้านหรือยังครับ',
] as const;

const forbiddenGlobal = [
  /ลาบปลาช่อน/u,
  /คอหมูย่าง/u,
  /เสือร้องไห้/u,
  /คิดช้ากว่าปกติ/u,
  /ลองพิมพ์อีกครั้งในอีกสักครู่/u,
  /ส่งคำขอ.*แล้ว/u,
  /สั่งเรียบร้อย/u,
];

function assertTurn(turn: number, response: string) {
  for (const pattern of forbiddenGlobal) {
    if (pattern.test(response)) throw new Error(`turn ${turn}: forbidden ${pattern} in: ${response}`);
  }

  const checks: Array<[number, RegExp]> = [
    [1, /Inthanin|อินทนิน/u],
    [3, /หวานน้อย/u],
    [3, /ไม่ขมมาก/u],
    [4, /ไม่เอากาแฟ/u],
    [5, /มาคนเดียว/u],
    [6, /ยังไม่ได้สั่ง|ไม่ได้สั่ง|ยังไม่ได้ส่ง/u],
    [8, /ไม่เอานมวัว/u],
    [9, /ไม่ใช่.*แพ้|ไม่ใช่อาการแพ้/u],
    [11, /ไม่ใส่น้ำตาล/u],
    [12, /ยังไม่ได้สั่ง|ไม่ได้สั่ง|ยังไม่ได้ส่ง/u],
    [13, /ยังไม่มีข้อมูล.*เวลา|ไม่มีข้อมูล.*เวลา|ไม่ขอเดา/u],
    [14, /ที่จอดรถ|ไม่ขอเดา/u],
    [16, /ยังไม่มีคำสั่งให้ส่ง|ยังไม่ได้.*ส่ง|ยังไม่มี.*ส่ง/u],
  ];
  for (const [expectedTurn, pattern] of checks) {
    if (turn === expectedTurn && !pattern.test(response)) {
      throw new Error(`turn ${turn}: expected ${pattern} in: ${response}`);
    }
  }
  if (turn === 10 && /ไม่เอากาแฟ/u.test(response)) {
    throw new Error(`turn 10: no_coffee preference was not cleared: ${response}`);
  }
}

async function main() {
  const guestId = randomUUID();
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < messages.length; i += 1) {
    const eventId = `messenger-prod-recert-${guestId}-${i + 1}`;
    const response = await fetch(PRODUCTION_URL, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        guestId,
        eventId,
        message:messages[i],
        language:'th',
        chatHistory:[],
        guestContext:{
          tripDuration:null,
          travelerType:null,
          group:{adults:null,children:null,elderly:null},
          interests:[],
          pace:null,
          budget:null,
          constraints:[],
        },
        journeyContext:{
          currentPlan:null,
          savedPlan:null,
          visitedExperiences:[],
          favorites:[],
          journalEntries:[],
        },
        pageContext:{section:'facebook'},
      }),
    });

    const payload = await response.json().catch(() => ({})) as Payload;
    const text = typeof payload.message === 'string' ? payload.message : '';
    if (response.status !== 200) throw new Error(`turn ${i + 1}: HTTP ${response.status}`);
    if (!text) throw new Error(`turn ${i + 1}: empty response`);
    assertTurn(i + 1, text);

    const result = {
      turn:i + 1,
      request:messages[i],
      httpStatus:response.status,
      intent:typeof payload.intent === 'string' ? payload.intent : null,
      response:text,
      pass:true,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }

  console.log(JSON.stringify({
    kind:'MESSENGER_PRODUCTION_RECERTIFICATION',
    productionUrl:PRODUCTION_URL,
    guestId,
    total:results.length,
    passed:results.length,
    failed:0,
  }, null, 2));
}

main().catch(error => {
  console.error('MESSENGER_PRODUCTION_RECERTIFICATION_FAILED', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
