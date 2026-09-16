import { decryptPii } from './_operations-db';
import { buildStaffBookingFlexMessage, type LineMessage } from './_ops-line-ui';

type TeamCode = 'restaurant' | 'stay' | 'activity';
type ChannelRow = {
  id: string;
  target_id_enc: string;
};
type DeliveryRow = { id: string; status: string };

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const BACKOFFICE_URL = 'https://tamma-backoffice.netlify.app/';

const TEAM_LABELS: Record<TeamCode, string> = {
  restaurant: 'ตำมา-ชาติ / ร้านอาหาร',
  stay: 'ทำมา-ชาติ เฮือนสเตย์',
  activity: 'ทำมา-ชาติ ผจญภัย',
};

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Operations database is not configured');
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
    throw new Error(`booking_flex_db_${response.status}:${body.slice(0, 260)}`);
  }
  return response;
}

function cleanText(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

async function channelForTeam(teamCode: TeamCode): Promise<ChannelRow | null> {
  const response = await dbFetch(
    `ops_notification_channels?team_code=eq.${teamCode}&provider=eq.line&enabled=eq.true&select=id,target_id_enc&limit=1`,
  );
  return (await response.json() as ChannelRow[])[0] ?? null;
}

async function customerInfo(customerId: string | null): Promise<{ name: string; phone: string }> {
  if (!customerId) return { name: '', phone: '' };
  const response = await dbFetch(
    `customer_accounts?id=eq.${customerId}&select=full_name_enc,phone_enc&limit=1`,
  );
  const row = (await response.json() as Array<{ full_name_enc: string | null; phone_enc: string | null }>)[0];
  return {
    name: decryptPii(row?.full_name_enc) ?? '',
    phone: decryptPii(row?.phone_enc) ?? '',
  };
}

async function pushLine(targetId: string, messages: LineMessage[]): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: targetId, messages: messages.slice(0, 5) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`line_flex_push_${response.status}:${body.slice(0, 260)}`);
  }
}

async function beginDelivery(input: {
  channelId: string;
  bookingId: string;
  teamCode: TeamCode;
  bookingCode: string;
}): Promise<{ id: string; shouldSend: boolean }> {
  const key = `booking_created:${input.bookingId}:${input.teamCode}`;
  const insert = await dbFetch('ops_notification_deliveries?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      channel_id: input.channelId,
      booking_id: input.bookingId,
      entity_type: 'booking',
      entity_id: input.bookingId,
      idempotency_key: key,
      delivery_type: 'booking_created',
      provider: 'line',
      status: 'pending',
      payload: { booking_code: input.bookingCode, ui: 'flex-v1' },
    }),
  });
  const created = (await insert.json() as DeliveryRow[])[0];
  if (created?.id) return { id: created.id, shouldSend: true };

  const lookup = await dbFetch(
    `ops_notification_deliveries?idempotency_key=eq.${encodeURIComponent(key)}&select=id,status&limit=1`,
  );
  const existing = (await lookup.json() as DeliveryRow[])[0];
  if (!existing) throw new Error('booking_flex_delivery_lookup_failed');
  if (existing.status === 'sent' || existing.status === 'pending') return { id: existing.id, shouldSend: false };

  await dbFetch(`ops_notification_deliveries?id=eq.${existing.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'pending', error_message: null, payload: { booking_code: input.bookingCode, ui: 'flex-v1' } }),
  });
  return { id: existing.id, shouldSend: true };
}

async function finishDelivery(id: string, error?: unknown): Promise<void> {
  await dbFetch(`ops_notification_deliveries?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: error ? 'failed' : 'sent',
      error_message: error ? (error instanceof Error ? error.message.slice(0, 500) : 'Unknown booking Flex error') : null,
    }),
  });
}

export async function dispatchBookingFlexNotification(
  id: string,
): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const bookingResponse = await dbFetch(
    `bookings?id=eq.${id}`
    + '&select=id,booking_code,customer_id,service_type,resource_id,start_at,end_at,party_size,quantity,status,source_channel,customer_note,environment&limit=1',
  );
  const booking = (await bookingResponse.json() as Array<{
    id: string;
    booking_code: string;
    customer_id: string | null;
    service_type: string;
    resource_id: string;
    start_at: string;
    end_at: string;
    party_size: number | null;
    quantity: number;
    status: string;
    source_channel: string;
    customer_note: string | null;
    environment: string;
  }>)[0];
  if (!booking || !['live', 'test'].includes(booking.environment)) return 'ignored';
  if (!['restaurant', 'stay', 'activity'].includes(booking.service_type)) return 'ignored';
  const teamCode = booking.service_type as TeamCode;

  const channel = await channelForTeam(teamCode);
  if (!channel) return 'not_bound';
  const targetId = decryptPii(channel.target_id_enc);
  if (!targetId) throw new Error(`LINE target for ${teamCode} cannot be decrypted`);

  const delivery = await beginDelivery({
    channelId: channel.id,
    bookingId: booking.id,
    teamCode,
    bookingCode: booking.booking_code,
  });
  if (!delivery.shouldSend) return 'duplicate';

  try {
    const [resourceResponse, customer] = await Promise.all([
      dbFetch(`service_resources?id=eq.${booking.resource_id}&select=name,metadata&limit=1`),
      customerInfo(booking.customer_id),
    ]);
    const resource = (await resourceResponse.json() as Array<{ name: string; metadata: Record<string, unknown> }>)[0];
    const activityCode = teamCode === 'activity' ? String(resource?.metadata?.activity_code ?? '') : '';
    const amount = teamCode === 'stay'
      ? `${booking.quantity || 1} หลัง${booking.party_size ? ` / ${booking.party_size} คน` : ''}`
      : `${booking.party_size ?? booking.quantity ?? 1} คน`;

    const message = buildStaffBookingFlexMessage({
      bookingCode: booking.booking_code,
      serviceName: resource?.name ?? TEAM_LABELS[teamCode],
      teamLabel: TEAM_LABELS[teamCode],
      status: booking.status,
      environment: booking.environment,
      startAt: booking.start_at,
      endAt: booking.end_at,
      customerName: customer.name || undefined,
      phone: customer.phone || undefined,
      amount,
      sourceChannel: booking.source_channel,
      note: booking.customer_note ? cleanText(booking.customer_note, 500) : undefined,
      activityCode: activityCode || undefined,
      backofficeUrl: teamCode === 'activity'
        ? 'https://tamma-backoffice.netlify.app/activity-bookings.html'
        : BACKOFFICE_URL,
    });

    await pushLine(targetId, [message]);
    await finishDelivery(delivery.id);
    return 'sent';
  } catch (error) {
    await finishDelivery(delivery.id, error).catch(() => undefined);
    throw error;
  }
}
