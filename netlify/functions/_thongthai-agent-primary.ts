import { createHash } from 'node:crypto';
import type { BrainChannel } from './_thongthai-brain-v3';

const SUPPORTED_CHANNELS = new Set<BrainChannel>(['web','line','facebook']);

function boundedPercent(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function parseChannels(raw: string | undefined, fallback: string): Set<BrainChannel> {
  const values = (raw?.trim() || fallback)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.filter((value): value is BrainChannel =>
    value === 'web' || value === 'line' || value === 'facebook'
  ));
}

function configuredChannels(): Set<BrainChannel> {
  return parseChannels(process.env.THONGTHAI_AGENT_PRIMARY_CHANNELS, 'web');
}

function configuredPrepareChannels(): Set<BrainChannel> {
  return parseChannels(process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS, 'web');
}

function configuredPrepareGuestKeys(): Set<string> {
  const raw = process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS?.trim() || '';
  return new Set(raw.split(',').map(value => value.trim()).filter(Boolean));
}

export function configuredAgentPrimaryPercent(channel: BrainChannel): number {
  const channelSpecific = channel === 'web'
    ? process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_WEB
    : channel === 'line'
      ? process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_LINE
      : channel === 'facebook'
        ? process.env.THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK
        : undefined;

  // Channel-specific rollout values let WEB remain fully cut over while
  // LINE/Facebook start as small read-only canaries. The legacy global value
  // remains the fallback for backwards compatibility and emergency rollback.
  const selected = channelSpecific?.trim()
    ? channelSpecific
    : process.env.THONGTHAI_AGENT_PRIMARY_PERCENT;
  return boundedPercent(selected);
}

export function configuredAgentPreparePercent(channel: BrainChannel): number {
  const channelSpecific = channel === 'web'
    ? process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_WEB
    : channel === 'line'
      ? process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_LINE
      : channel === 'facebook'
        ? process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_FACEBOOK
        : undefined;
  const selected = channelSpecific?.trim()
    ? channelSpecific
    : process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT;
  return boundedPercent(selected);
}

export function stableAgentCanaryBucket(guestKey: string): number {
  const digest = createHash('sha256').update(`thongthai-agent-primary:${guestKey}`, 'utf8').digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 10_000;
}

export function stableAgentPrepareCanaryBucket(guestKey: string): number {
  const digest = createHash('sha256').update(`thongthai-agent-prepare:${guestKey}`, 'utf8').digest('hex');
  return parseInt(digest.slice(0, 8), 16) % 10_000;
}

export function shouldUseThongthaiAgentTransactionPrepare(input: {
  guestKey: string;
  guestDbId: string | null;
  channel: BrainChannel;
}): boolean {
  if (process.env.THONGTHAI_AGENT_PRIMARY_ENABLED !== '1') return false;
  if (process.env.THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED !== '1') return false;
  if (!input.guestDbId || !input.guestKey) return false;
  if (!SUPPORTED_CHANNELS.has(input.channel)) return false;
  if (!configuredChannels().has(input.channel)) return false;
  if (!configuredPrepareChannels().has(input.channel)) return false;

  // Exact guest allowlisting is a production-certification escape hatch:
  // it lets us prove prepare-only behavior against a synthetic guest while
  // the public percentage remains zero. It never bypasses the master enable
  // switch or channel allowlists.
  if (configuredPrepareGuestKeys().has(input.guestKey)) return true;

  const percent = configuredAgentPreparePercent(input.channel);
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return stableAgentPrepareCanaryBucket(input.guestKey) < Math.round(percent * 100);
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

  // Transaction turns remain outside normal read-only routing. The caller may
  // explicitly re-admit a transaction turn only after the separate prepare-
  // only gate has selected that guest/channel. Weather/location remain on
  // their established deterministic paths.
  if (input.explicitTransactionIntent || input.weatherRequest || input.locationRequest) return false;

  const percent = configuredAgentPrimaryPercent(input.channel);
  if (percent <= 0) return false;
  if (percent >= 100) return true;

  return stableAgentCanaryBucket(input.guestKey) < Math.round(percent * 100);
}
