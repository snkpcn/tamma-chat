import { createHash } from 'node:crypto';
import type { BrainChannel } from './_thongthai-brain-v3';

const SUPPORTED_CHANNELS = new Set<BrainChannel>(['web','line','facebook']);

function boundedPercent(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function configuredChannels(): Set<BrainChannel> {
  const raw = process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS?.trim() || 'web';
  const values = raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return new Set(values.filter((value): value is BrainChannel =>
    value === 'web' || value === 'line' || value === 'facebook'
  ));
}

export function stableAgentCanaryBucket(guestKey: string): number {
  const digest = createHash('sha256').update(`thongthai-agent-primary:${guestKey}`, 'utf8').digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 10_000;
}

export function shouldUseThongthaiAgentPrimary(input: {
  guestKey: string;
  guestDbId: string | null;
  channel: BrainChannel;
  explicitTransactionIntent: boolean;
  weatherRequest: boolean;
  locationRequest: boolean;
}): boolean {
  if (process.env.THONGTHAI_AGENT_PRIMARY_ENABLED !== '1') return false;
  if (!input.guestDbId || !input.guestKey) return false;
  if (!SUPPORTED_CHANNELS.has(input.channel)) return false;
  if (!configuredChannels().has(input.channel)) return false;

  // First production cutover is read-only. Existing, already-proven legacy
  // executors continue to own writes/weather/location until those verticals
  // are explicitly cut over.
  if (input.explicitTransactionIntent || input.weatherRequest || input.locationRequest) return false;

  const percent = boundedPercent(process.env.THONGTHAI_AGENT_PRIMARY_PERCENT);
  if (percent <= 0) return false;
  if (percent >= 100) return true;

  return stableAgentCanaryBucket(input.guestKey) < Math.round(percent * 100);
}
