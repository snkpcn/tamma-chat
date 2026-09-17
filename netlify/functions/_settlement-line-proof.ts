import { piiHash } from './_operations-db';

export type SettlementProofLineMessage = { type: string; [key: string]: unknown };

type Binding = { id: string; team_code: string };
type SettlementRow = {
  id: string;
  entity_code: string;
  team_code: string;
  amount_due: number;
  status: 'pending_transfer' | 'transfer_submitted' | 'transferred' | 'acknowledged' | 'cancelled';
  transfer_proof_path: string | null;
  updated_at: string;
};

const LINE_CONTENT_BASE = 'https://api-data.line.me/v2/bot/message';
const BACKOFFICE_SETTLEMENTS_URL = 'https://tamma-backoffice.netlify.app/settlements.html';
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Settlement database configuration missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`settlement_proof_db_${response.status}:${body.slice(0, 280)}`);
  }
  return response;
}

function money(value: number): string {
  return `${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

function teamLabel(teamCode: string): string {
  return teamCode === 'restaurant' ? 'ตำมา-ชาติ' : teamCode;
}

function encodedObjectPath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function bindingForTarget(targetId: string): Promise<Binding | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=id,team_code&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

async function settlementById(id: string): Promise<SettlementRow | null> {
  const response = await dbFetch(`team_settlements?id=eq.${encodeURIComponent(id)}&select=id,entity_code,team_code,amount_due,status,transfer_proof_path,updated_at&limit=1`);
  return (await response.json() as SettlementRow[])[0] ?? null;
}

async function pendingCandidates(binding: Binding): Promise<SettlementRow[]> {
  const teamFilter = binding.team_code === 'all' ? '' : `&team_code=eq.${encodeURIComponent(binding.team_code)}`;
  const response = await dbFetch(
    `team_settlements?status=eq.pending_transfer${teamFilter}&select=id,entity_code,team_code,amount_due,status,transfer_proof_path,updated_at&order=created_at.desc`,
  );
  return await response.json() as SettlementRow[];
}

async function latestSubmitted(binding: Binding): Promise<SettlementRow | null> {
  const teamFilter = binding.team_code === 'all' ? '' : `&team_code=eq.${encodeURIComponent(binding.team_code)}`;
  const response = await dbFetch(
    `team_settlements?status=eq.transfer_submitted${teamFilter}&select=id,entity_code,team_code,amount_due,status,transfer_proof_path,updated_at&order=updated_at.desc&limit=1`,
  );
  return (await response.json() as SettlementRow[])[0] ?? null;
}

async function mostRecentlyDeliveredCandidateId(channelId: string, candidateIds: string[]): Promise<string | null> {
  if (!candidateIds.length) return null;
  const response = await dbFetch(
    `ops_notification_deliveries?channel_id=eq.${channelId}&entity_type=eq.team_settlement&entity_id=in.(${candidateIds.join(',')})`
      + '&delivery_type=eq.settlement_pending_transfer_team&status=eq.sent&select=entity_id,created_at&order=created_at.desc&limit=1',
  );
  const rows = await response.json() as Array<{ entity_id: string }>;
  return rows[0]?.entity_id ?? null;
}

export type SettlementProofResolution =
  | { kind: 'none' }
  | { kind: 'resolved'; settlement: SettlementRow }
  | { kind: 'ambiguous'; settlements: SettlementRow[] };

export function chooseSettlementForProof(
  settlements: SettlementRow[],
  mostRecentlyDeliveredId: string | null,
): SettlementProofResolution {
  if (settlements.length === 0) return { kind: 'none' };
  if (settlements.length === 1) return { kind: 'resolved', settlement: settlements[0] };
  const delivered = mostRecentlyDeliveredId
    ? settlements.find(item => item.id === mostRecentlyDeliveredId)
    : undefined;
  if (delivered) return { kind: 'resolved', settlement: delivered };
  return { kind: 'ambiguous', settlements };
}

async function resolveSettlementForProof(binding: Binding): Promise<SettlementProofResolution> {
  const candidates = await pendingCandidates(binding);
  if (candidates.length <= 1) return chooseSettlementForProof(candidates, null);
  const deliveredId = await mostRecentlyDeliveredCandidateId(binding.id, candidates.map(item => item.id));
  return chooseSettlementForProof(candidates, deliveredId);
}

async function uploadLineProof(messageId: string, settlement: SettlementRow): Promise<string> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const content = await fetch(`${LINE_CONTENT_BASE}/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!content.ok) throw new Error(`settlement_line_content_${content.status}`);
  const mime = (content.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('unsupported_settlement_proof_type');
  const buffer = Buffer.from(await content.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_PROOF_BYTES) throw new Error('settlement_proof_size_invalid');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const safeMessageId = messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const objectPath = `${settlement.id}/line-${safeMessageId}.${ext}`;
  const c = config();
  const upload = await fetch(`${c.url}/storage/v1/object/settlement-proofs/${encodedObjectPath(objectPath)}`, {
    method: 'POST',
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': mime,
      'x-upsert': 'false',
    },
    body: buffer,
  });
  // A LINE webhook retry can hit the same deterministic path. Treat that as
  // already uploaded and continue with the state update rather than creating
  // a second proof object.
  if (!upload.ok && upload.status !== 409) {
    const body = await upload.text().catch(() => '');
    throw new Error(`settlement_proof_upload_${upload.status}:${body.slice(0, 180)}`);
  }
  return objectPath;
}

function proofConfirmationCard(settlement: SettlementRow): SettlementProofLineMessage {
  return {
    type: 'flex',
    altText: `ยืนยันสลิปโอน ${settlement.entity_code} ${money(settlement.amount_due)}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#7A5A32', paddingAll: '16px',
        contents: [
          { type: 'text', text: '🧾 ได้รับสลิปการโอนแล้ว', color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: teamLabel(settlement.team_code), color: '#F4E9D7', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: settlement.entity_code, weight: 'bold', wrap: true },
          { type: 'text', text: `ยอดที่ระบบรอโอน: ${money(settlement.amount_due)}`, weight: 'bold', wrap: true },
          { type: 'text', text: 'ทองไทยจับคู่จากรายการรอโอนของกลุ่มนี้แล้ว ตรวจรูปอีกครั้งก่อนยืนยัน', size: 'xs', color: '#766B60', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          {
            type: 'button', style: 'primary', color: '#245B51',
            action: { type: 'postback', label: '✅ ยืนยันว่าโอนแล้ว', data: `ops=settlement_proof&action=confirm&id=${settlement.id}`, displayText: `ยืนยันโอน ${settlement.entity_code}` },
          },
          {
            type: 'button', style: 'secondary',
            action: { type: 'postback', label: '❌ ไม่ใช่รายการนี้', data: `ops=settlement_proof&action=reject&id=${settlement.id}`, displayText: `สลิปไม่ใช่ ${settlement.entity_code}` },
          },
          { type: 'button', style: 'link', action: { type: 'uri', label: 'เปิดหลังบ้าน', uri: BACKOFFICE_SETTLEMENTS_URL } },
        ],
      },
    },
  };
}

export async function handleSettlementTransferProofImage(input: {
  targetId: string;
  userId?: string | null;
  messageId: string;
}): Promise<SettlementProofLineMessage[] | null> {
  const binding = await bindingForTarget(input.targetId);
  if (!binding) return null;

  const resolution = await resolveSettlementForProof(binding);
  if (resolution.kind === 'none') {
    // If the same proof was just accepted but LINE retries or the user sends
    // it again, re-show the confirmation card instead of silently swallowing
    // the image or misrouting it to another operational image handler.
    const submitted = await latestSubmitted(binding);
    if (!submitted?.transfer_proof_path) return null;
    return [
      { type: 'text', text: `ได้รับหลักฐานของ ${submitted.entity_code} แล้วครับ ยังรอยืนยันว่าโอนแล้ว` },
      proofConfirmationCard(submitted),
    ];
  }

  if (resolution.kind === 'ambiguous') {
    const list = resolution.settlements.map(item => `${item.entity_code} · ${money(item.amount_due)}`).join('\n');
    return [{
      type: 'text',
      text: `พบรายการรอโอนมากกว่า 1 รายการครับ ยังไม่ผูกสลิปให้อัตโนมัติเพื่อกันโอนผิดรายการ\n\n${list}\n\nเปิด Settlement Console เพื่อเลือกรายการ หรือส่งสลิปหลังจากเปิดการ์ดรายการที่ต้องการล่าสุดครับ`,
    }];
  }

  const settlement = resolution.settlement;
  const objectPath = await uploadLineProof(input.messageId, settlement);
  await dbFetch(`team_settlements?id=eq.${settlement.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'transfer_submitted',
      transfer_proof_path: objectPath,
    }),
  });
  const updated = { ...settlement, status: 'transfer_submitted' as const, transfer_proof_path: objectPath };
  return [
    { type: 'text', text: `🧾 รับสลิปโอน ${updated.entity_code} แล้วครับ\nยอดตามระบบ: ${money(updated.amount_due)}\nตรวจรูปให้ถูกแล้วกด “ยืนยันว่าโอนแล้ว” ได้เลย` },
    proofConfirmationCard(updated),
  ];
}

async function deleteProofBestEffort(path: string | null): Promise<void> {
  if (!path) return;
  const c = config();
  await fetch(`${c.url}/storage/v1/object/settlement-proofs/${encodedObjectPath(path)}`, {
    method: 'DELETE',
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}` },
  }).catch(() => undefined);
}

export async function handleSettlementTransferProofPostback(input: {
  targetId: string;
  userId?: string | null;
  data: string;
}): Promise<SettlementProofLineMessage[] | null> {
  const params = new URLSearchParams(input.data);
  if (params.get('ops') !== 'settlement_proof') return null;
  const action = params.get('action') ?? '';
  const id = params.get('id') ?? '';
  const [binding, settlement] = await Promise.all([bindingForTarget(input.targetId), settlementById(id)]);
  if (!binding) return [{ type: 'text', text: 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ' }];
  if (!settlement) return [{ type: 'text', text: 'ไม่พบรายการโอนนี้ครับ' }];
  if (binding.team_code !== 'all' && binding.team_code !== settlement.team_code) {
    return [{ type: 'text', text: 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ' }];
  }

  if (action === 'confirm') {
    if (settlement.status === 'transferred' || settlement.status === 'acknowledged') {
      return [{ type: 'text', text: `✅ ${settlement.entity_code} บันทึกว่าโอนแล้วครับ` }];
    }
    if (settlement.status !== 'transfer_submitted' || !settlement.transfer_proof_path) {
      return [{ type: 'text', text: `ยังไม่มีหลักฐานการโอนที่รอยืนยันสำหรับ ${settlement.entity_code} ครับ` }];
    }
    const actor = input.userId ? `line:${piiHash(input.userId) ?? 'staff'}` : 'line:group';
    await dbFetch(`team_settlements?id=eq.${settlement.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'transferred',
        transferred_at: new Date().toISOString(),
        transferred_by: actor,
      }),
    });
    return [{ type: 'text', text: `✅ บันทึกโอน ${settlement.entity_code} · ${money(settlement.amount_due)} แล้วครับ\nทองไทยกำลังแจ้งร้านให้รับทราบ` }];
  }

  if (action === 'reject') {
    if (settlement.status !== 'transfer_submitted') {
      return [{ type: 'text', text: `ตอนนี้ ${settlement.entity_code} ไม่มีสลิปที่รอยกเลิกครับ` }];
    }
    const proofPath = settlement.transfer_proof_path;
    await dbFetch(`team_settlements?id=eq.${settlement.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'pending_transfer', transfer_proof_path: null }),
    });
    await deleteProofBestEffort(proofPath);
    return [{ type: 'text', text: `↩️ ยกเลิกสลิปของ ${settlement.entity_code} แล้ว กลับไปสถานะรอโอนครับ` }];
  }

  return null;
}
