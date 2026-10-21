// Ask one question on the web core and through the real LINE webhook, each
// as a fresh customer, and report what came back and how many model calls
// it took. Must run inside withHarness.
import { processThongthaiChatCore } from '../../netlify/functions/thongthai-chat';
import { brainRequest, guestId, type Harness } from './canonical-core-harness';
import { deliverLineTexts } from './line-channel';

export type ChannelAnswer = { channel: 'web' | 'line'; reply: string; modelCalls: number };

export async function askBothChannels(harness: Harness, seed: string, text: string): Promise<ChannelAnswer[]> {
  let before = harness.modelCallCount();
  const web = await processThongthaiChatCore(brainRequest(text, guestId(`${seed}-web`), 'web'), `${seed}-web`);
  const webAnswer: ChannelAnswer = {
    channel: 'web',
    reply: String((web.payload as { message?: unknown }).message ?? ''),
    modelCalls: harness.modelCallCount() - before,
  };
  before = harness.modelCallCount();
  const line = await deliverLineTexts(harness, { userId: `U-${seed}`, texts: [text] });
  return [webAnswer, {
    channel: 'line',
    reply: line.replies[0]?.texts.join('\n') ?? '',
    modelCalls: harness.modelCallCount() - before,
  }];
}

/** Make every backend read whose URL contains `fragment` fail with HTTP 500. */
export function failReads(harness: Harness, fragment: string): void {
  const inner = harness.fetchMock;
  const failing = (async (url: string | URL, init: RequestInit = {}) =>
    String(url).includes(fragment) ? new Response('{"message":"read failed"}', { status: 500 }) : inner(url, init)) as typeof fetch;
  (harness as { fetchMock: typeof fetch }).fetchMock = failing;
  global.fetch = failing;
}
