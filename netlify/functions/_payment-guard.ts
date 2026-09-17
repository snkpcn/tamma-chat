type PaymentRow = {
  entity_code: string;
  amount: number | null;
  status: 'quote_required' | 'awaiting_payment' | 'proof_submitted' | 'verified' | 'rejected' | 'cancelled';
};

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment guard database configuration missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string): Promise<Response> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`payment_guard_db_${response.status}`);
  return response;
}

function money(value: number | null): string {
  if (!value || !Number.isFinite(Number(value))) return 'ยังไม่ได้กำหนดยอด';
  return `${Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;
}

function blockedText(row: PaymentRow): string {
  if (row.status === 'quote_required') {
    return [
      `⛔ ยังรับงาน ${row.entity_code} ไม่ได้ เพราะยังไม่ได้กำหนดยอดชำระ`,
      'พิมพ์ราคาในกลุ่มนี้ได้เลย เช่น 300 หรือ 300 บาท รับงาน',
      `ถ้ามีหลายงานค้างอยู่ ค่อยใช้: ตั้งยอด ${row.entity_code} 300`,
      'เมื่อกำหนดยอดแล้ว ทองไทยจะส่ง QR PromptPay ช่องทางเดียวให้ลูกค้าอัตโนมัติครับ',
    ].join('\n');
  }
  if (row.status === 'awaiting_payment' || row.status === 'rejected') {
    return `⛔ ยังรับงาน ${row.entity_code} ไม่ได้ · รอลูกค้าชำระ ${money(row.amount)} และส่งสลิปก่อนครับ`;
  }
  if (row.status === 'proof_submitted') {
    return `⛔ ยังรับงาน ${row.entity_code} ไม่ได้ · ลูกค้าส่งสลิปแล้ว กรุณาตรวจสลิปและกด “รับเงินแล้ว” ก่อนครับ`;
  }
  if (row.status === 'cancelled') return `⛔ รายการชำระ ${row.entity_code} ถูกยกเลิกแล้วครับ`;
  return `⛔ ${row.entity_code} ยังไม่ผ่านการยืนยันชำระเงินครับ`;
}

async function byEntityCode(code: string): Promise<PaymentRow | null> {
  const response = await dbFetch(
    `payment_requests?entity_code=eq.${encodeURIComponent(code)}&select=entity_code,amount,status&order=created_at.desc&limit=1`,
  );
  return (await response.json() as PaymentRow[])[0] ?? null;
}

async function byPreorderId(id: string): Promise<PaymentRow | null> {
  const response = await dbFetch(
    `payment_requests?entity_type=eq.restaurant_preorder&entity_id=eq.${encodeURIComponent(id)}`
      + '&select=entity_code,amount,status&order=created_at.desc&limit=1',
  );
  return (await response.json() as PaymentRow[])[0] ?? null;
}

export async function paymentConfirmationGuard(postbackData: string): Promise<string | null> {
  const params = new URLSearchParams(postbackData);

  if (params.get('rpo') === 'confirm') {
    const id = params.get('id') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await byPreorderId(id);
    if (!row) return '⛔ ยังรับออเดอร์ไม่ได้ เพราะยังไม่พบรายการชำระเงินของออเดอร์นี้ครับ';
    return row.status === 'verified' ? null : blockedText(row);
  }

  if (params.get('ops') === 'booking' && params.get('action') === 'confirm') {
    const code = (params.get('code') ?? '').toUpperCase();
    if (!/^BK-\d{6}-[A-Z0-9]{8}$/.test(code)) return null;
    const row = await byEntityCode(code);
    if (!row) return `⛔ ยังรับงาน ${code} ไม่ได้ เพราะยังไม่พบรายการชำระเงินครับ`;
    return row.status === 'verified' ? null : blockedText(row);
  }

  return null;
}

export async function paymentTypedConfirmationGuard(text: string): Promise<string | null> {
  const clean = text.trim().replace(/\s+/g, ' ');
  const match = clean.match(/^ยืนยัน\s+(BK-\d{6}-[A-Z0-9]{8})$/iu);
  if (!match) return null;
  const code = match[1].toUpperCase();
  const row = await byEntityCode(code);
  if (!row) return `⛔ ยังรับงาน ${code} ไม่ได้ เพราะยังไม่พบรายการชำระเงินครับ`;
  return row.status === 'verified' ? null : blockedText(row);
}
