import { createHash } from 'node:crypto';
import { decryptPii, piiHash } from './_operations-db';

export type SettlementStatus = 'pending_transfer' | 'transfer_submitted' | 'transferred' | 'acknowledged' | 'cancelled';

export type TeamSettlement = {
  id: string;
  payment_request_id: string;
  entity_type: string;
  entity_id: string;
  entity_code: string;
  team_code: string;
  gross_amount: number;
  adjustment_amount: number;
  amount_due: number;
  currency: string;
  status: SettlementStatus;
  environment: string;
  transfer_reference: string | null;
  transfer_proof_path: string | null;
  created_at: string;
  transferred_at: string | null;
  acknowledged_at: string | null;
  updated_at: string;
};

export type SettlementLineMessage = { type: string; [key: string]: unknown };
type Binding = { id: string; team_code: string; target_id_enc: string };
type DeliveryRow = { id: string; status: string };

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const BACKOFFICE_SETTLEMENTS_URL = 'https://tamma-backoffice.netlify.app/settlements.html';

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
    throw new Error(`settlement_db_${response.status}:${body.slice(0, 280)}`);
  }
  return response;
}

async function linePush(targetId: string, messages: SettlementLineMessage[]): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: targetId, messages: messages.slice(0, 5) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`settlement_line_push_${response.status}:${body.slice(0, 240)}`);
  }
}

function money(value: number): string {
  return `${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

function teamLabel(teamCode: string): string {
  return teamCode === 'restaurant' ? 'ตำมา-ชาติ' : teamCode;
}

// Pure decision logic, extracted for unit testing without a database --
// same pattern as _payments.ts's choosePaymentForReceipt.

export function settlementNotificationKind(status: SettlementStatus): 'pending_transfer' | 'transferred' | 'none' {
  if (status === 'pending_transfer') return 'pending_transfer';
  if (status === 'transferred') return 'transferred';
  return 'none';
}

export type AcknowledgeDecision =
  | { kind: 'already_acknowledged' }
  | { kind: 'not_transferred_yet'; status: SettlementStatus }
  | { kind: 'acknowledge' };

export function decideAcknowledge(status: SettlementStatus): AcknowledgeDecision {
  if (status === 'acknowledged') return { kind: 'already_acknowledged' };
  if (status !== 'transferred') return { kind: 'not_transferred_yet', status };
  return { kind: 'acknowledge' };
}

export function settlementTeamMatches(bindingTeamCode: string, settlementTeamCode: string): boolean {
  return bindingTeamCode === 'all' || bindingTeamCode === settlementTeamCode;
}

function thaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

async function settlementById(id: string): Promise<TeamSettlement | null> {
  const response = await dbFetch(`team_settlements?id=eq.${id}&select=*&limit=1`);
  return (await response.json() as TeamSettlement[])[0] ?? null;
}

async function bindingForTarget(targetId: string): Promise<Binding | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=id,team_code,target_id_enc&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

async function teamBinding(teamCode: string): Promise<Binding | null> {
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&team_code=eq.${teamCode}&enabled=eq.true&select=id,team_code,target_id_enc&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

// Same idempotent-delivery pattern as _payments.ts's beginDelivery/finishDelivery,
// keyed by settlement id + status + updated_at so a retried webhook or a
// re-fired trigger can never push the same card twice.
async function beginDelivery(input: { settlement: TeamSettlement; channelId: string }): Promise<{ id: string; shouldSend: boolean }> {
  const key = [
    'settlement', input.settlement.id, input.settlement.status,
    createHash('sha256').update(input.settlement.updated_at).digest('hex').slice(0, 12),
  ].join(':');
  const insert = await dbFetch('ops_notification_deliveries?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      channel_id: input.channelId,
      booking_id: null,
      entity_type: 'team_settlement',
      entity_id: input.settlement.id,
      idempotency_key: key,
      delivery_type: `settlement_${input.settlement.status}_team`,
      provider: 'line',
      status: 'pending',
      payload: { entity_code: input.settlement.entity_code },
    }),
  });
  const created = (await insert.json() as DeliveryRow[])[0];
  if (created?.id) return { id: created.id, shouldSend: true };
  const lookup = await dbFetch(
    `ops_notification_deliveries?idempotency_key=eq.${encodeURIComponent(key)}&select=id,status&limit=1`,
  );
  const existing = (await lookup.json() as DeliveryRow[])[0];
  return { id: existing?.id ?? '', shouldSend: false };
}

async function finishDelivery(id: string, error?: unknown): Promise<void> {
  if (!id) return;
  await dbFetch(`ops_notification_deliveries?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: error ? 'failed' : 'sent',
      error_message: error ? (error instanceof Error ? error.message.slice(0, 500) : 'unknown') : null,
    }),
  });
}

function pendingTransferCard(settlement: TeamSettlement): SettlementLineMessage {
  const prefix = settlement.environment === 'test' ? '🧪 TEST • ' : '';
  return {
    type: 'flex',
    altText: `${prefix}💸 รอโอนเงินเข้าร้าน ${settlement.entity_code}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#7A5A32', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${prefix}💸 รอโอนเงินเข้าร้าน`, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: teamLabel(settlement.team_code), color: '#F4E9D7', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: settlement.entity_code, weight: 'bold', wrap: true },
          { type: 'text', text: `ลูกค้าชำระแล้ว ${money(settlement.gross_amount)}`, wrap: true },
          { type: 'text', text: `ยอดที่ต้องโอนให้${teamLabel(settlement.team_code)}: ${money(settlement.amount_due)}`, wrap: true, weight: 'bold' },
          { type: 'text', text: 'สถานะ: รอเจ้าของโอน', size: 'sm', color: '#8b5e2e' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          { type: 'button', style: 'primary', color: '#7A5A32', action: { type: 'uri', label: 'เปิดหลังบ้าน', uri: BACKOFFICE_SETTLEMENTS_URL } },
        ],
      },
    },
  };
}

function transferredCard(settlement: TeamSettlement): SettlementLineMessage {
  const prefix = settlement.environment === 'test' ? '🧪 TEST • ' : '';
  return {
    type: 'flex',
    altText: `${prefix}✅ โอนเงินเข้าร้านแล้ว ${settlement.entity_code}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#245b51', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${prefix}✅ โอนเงินเข้าร้านแล้ว`, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: teamLabel(settlement.team_code), color: '#DCEFE9', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: settlement.entity_code, weight: 'bold', wrap: true },
          { type: 'text', text: `ยอด ${money(settlement.amount_due)}`, wrap: true },
          { type: 'text', text: `เวลา ${thaiDateTime(settlement.transferred_at ?? settlement.updated_at)}`, size: 'sm', wrap: true },
          ...(settlement.transfer_reference
            ? [{ type: 'text', text: `อ้างอิง: ${settlement.transfer_reference}`, size: 'sm', wrap: true, color: '#6B6B6B' }]
            : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          {
            type: 'button', style: 'primary', color: '#245b51',
            action: { type: 'postback', label: '✅ ร้านได้รับเงินแล้ว', data: `ops=settlement&action=acknowledge&id=${settlement.id}`, displayText: '✅ ร้านได้รับเงินแล้ว' },
          },
        ],
      },
    },
  };
}

/**
 * Called from ops-settlement-notify.ts, itself invoked by the DB triggers
 * on team_settlements insert / status-to-transferred update. Dispatches by
 * the settlement's CURRENT status, same pattern as _payments.ts's
 * dispatchPaymentNotification -- so a re-fire (retry, or a manual replay
 * for a backfilled row) always reflects the real current state.
 */
export async function dispatchSettlementNotification(id: string): Promise<string> {
  const settlement = await settlementById(id);
  if (!settlement) return 'missing';
  if (!['live', 'test'].includes(settlement.environment)) return 'ignored';

  const kind = settlementNotificationKind(settlement.status);
  const card = kind === 'pending_transfer' ? pendingTransferCard(settlement)
    : kind === 'transferred' ? transferredCard(settlement)
    : null;
  if (!card) return 'ignored';

  const binding = await teamBinding(settlement.team_code);
  if (!binding) return 'team_not_bound';
  const target = decryptPii(binding.target_id_enc);
  if (!target) return 'team_not_reachable';

  const delivery = await beginDelivery({ settlement, channelId: binding.id });
  if (!delivery.shouldSend) return 'duplicate';
  try {
    await linePush(target, [card]);
    await finishDelivery(delivery.id);
    return 'sent';
  } catch (error) {
    await finishDelivery(delivery.id, error).catch(() => undefined);
    throw error;
  }
}

export async function handleSettlementPostback(input: {
  targetId: string;
  data: string;
}): Promise<SettlementLineMessage[] | null> {
  const params = new URLSearchParams(input.data);
  if (params.get('ops') !== 'settlement') return null;
  const action = params.get('action') ?? '';
  const id = params.get('id') ?? '';

  const [binding, settlement] = await Promise.all([bindingForTarget(input.targetId), settlementById(id)]);
  if (!binding) return [{ type: 'text', text: 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ' }];
  if (!settlement) return [{ type: 'text', text: 'ไม่พบรายการโอนนี้ครับ' }];
  if (!settlementTeamMatches(binding.team_code, settlement.team_code)) {
    return [{ type: 'text', text: 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ' }];
  }

  if (action === 'acknowledge') {
    const decision = decideAcknowledge(settlement.status);
    if (decision.kind === 'already_acknowledged') {
      return [{ type: 'text', text: `✅ ${settlement.entity_code} รับทราบแล้วครับ` }];
    }
    if (decision.kind === 'not_transferred_yet') {
      return [{ type: 'text', text: `ตอนนี้ ${settlement.entity_code} ยังไม่ได้อยู่สถานะโอนแล้วครับ` }];
    }
    await dbFetch(`team_settlements?id=eq.${settlement.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }),
    });
    return [{ type: 'text', text: `✅ รับทราบการโอน ${settlement.entity_code} · ${money(settlement.amount_due)} แล้วครับ` }];
  }

  return null;
}
