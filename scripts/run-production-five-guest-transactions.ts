// Connected production-gateway certification: creates five clearly-labelled
// TEST records through the real Thongthai endpoint. The gateway receives
// environment='test' explicitly, and every downstream transaction write must
// preserve that environment so test records never become LIVE operations.

const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

if (process.env.ALLOW_PRODUCTION_WRITES !== '1') {
  throw new Error('Set ALLOW_PRODUCTION_WRITES=1 to create the five production E2E test records');
}

type Case = {
  label: string;
  message: string;
  success: RegExp;
  code: RegExp;
};

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const cases: readonly Case[] = [
  {
    label: 'restaurant-table',
    message: `สวัสดีครับ ขอจองโต๊ะร้านตำมา-ชาติวันที่ 15 ตุลาคม 2569 เวลา 18:30 จำนวน 4 คน ชื่อ E2E TEST ${stamp} ร้านอาหาร โทร 0000000001 ยืนยันจองจริงส่งเข้าระบบตอนนี้ครับ`,
    success: /รับคำขอจองโต๊ะเข้าระบบแล้ว/u,
    code: /เลขที่คำขอ\s+([A-Z0-9-]+)/u,
  },
  {
    label: 'activity-horse',
    message: `อยากขี่ม้ากับน้องภาราดร 30 นาที วันที่ 16 ตุลาคม 2569 เวลา 10:00 จำนวน 1 คน ชื่อ E2E TEST ${stamp} กิจกรรม โทร 0000000002 พิมพ์ไม่ค่อยเก่งแต่ยืนยันจองจริงส่งระบบตอนนี้นะครับ`,
    success: /ส่งคำขอจองเข้าระบบแล้ว/u,
    code: /เลขที่จอง\s+([A-Z0-9-]+)/u,
  },
  {
    label: 'stay',
    message: `ขอจองที่พักนภา 1 ห้องนอน วันที่ 17-18 ตุลาคม 2569 พัก 2 คน พาผู้สูงอายุไปด้วย ชื่อ E2E TEST ${stamp} ที่พัก โทร 0000000003 ยืนยันส่งจองเข้าระบบจริงตอนนี้ครับ`,
    success: /ส่งคำขอจองที่พักเข้าระบบแล้ว/u,
    code: /เลขที่จอง\s+([A-Z0-9-]+)/u,
  },
  {
    label: 'cafe-inquiry',
    message: `ขอสั่งลาเต้เย็น 5 แก้ว วันที่ 18 ตุลาคม 2569 เวลา 09:00 ชื่อ E2E TEST ${stamp} คาเฟ่ โทร 0000000004 ฝากส่งเรื่องให้อินทนิลจริงตอนนี้และให้โทรกลับครับ ทดสอบระบบเท่านั้น`,
    success: /สร้างรายการติดตามของ Inthanin Café แล้ว/u,
    code: /เลขที่ติดตาม\s+([A-Z0-9-]+)/u,
  },
  {
    label: 'otop-order',
    message: `ขอสั่งซื้อผ้าไหมมัดหมี่บ้านเขว้า 1 ชิ้น จัดส่ง ชื่อ E2E TEST ${stamp} OTOP โทร 0000000005 ที่อยู่ ทดสอบระบบ ห้ามจัดส่งจริง 99 หมู่ 1 ตำบลในเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000 ยืนยันสั่งซื้อจริงตอนนี้ครับ`,
    success: /สร้างออเดอร์ OTOP แล้ว/u,
    code: /เลขออเดอร์\s+([A-Z0-9-]+)/u,
  },
];

function guestId(index: number): string {
  const tail = `${Date.now()}${index}`.slice(-12).padStart(12, '0');
  return `e2e50000-1001-4000-8000-${tail}`;
}

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]!;
    const guest = guestId(index + 1);
    const eventId = `production-five-guest-${stamp}-${index + 1}`;
    const started = Date.now();
    const response = await fetch(PRODUCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guestId: guest,
        environment: 'test',
        eventId,
        message: item.message,
        language: 'th',
        chatHistory: [],
        guestContext: {
          tripDuration: null,
          travelerType: null,
          group: { adults: null, children: null, elderly: null },
          interests: [],
          pace: null,
          budget: null,
          constraints: [],
        },
        journeyContext: {
          currentPlan: null,
          savedPlan: null,
          visitedExperiences: [],
          favorites: [],
          journalEntries: [],
        },
        pageContext: { section: 'line' },
      }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const code = message.match(item.code)?.[1] ?? null;
    const pass = response.ok && item.success.test(message) && Boolean(code);
    const result = {
      guest: index + 1,
      label: item.label,
      guestId: guest,
      eventId,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      intent: payload.intent ?? null,
      code,
      response: message,
      pass,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }

  const failed = results.filter(result => result.pass !== true);
  console.log(JSON.stringify({
    kind: 'PRODUCTION_FIVE_GUEST_TRANSACTION_CERTIFICATION',
    productionUrl: PRODUCTION_URL,
    stamp,
    passed: results.length - failed.length,
    failed: failed.length,
    failedLabels: failed.map(result => result.label),
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('PRODUCTION_FIVE_GUEST_TRANSACTION_CERTIFICATION_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
