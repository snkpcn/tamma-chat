import { createHash } from 'node:crypto';
import {
  handlePersonalFinanceEvent,
  type PfDeps,
  type PfEvent,
  type PfOutcome,
  type SlipExtraction,
} from '../../netlify/functions/_personal-finance';
import type { LlmInterpreter } from '../../netlify/functions/_personal-finance-nlu';
import { freshDb } from './pf-pglite';

export const OWNER = 'U_owner_000000000000000000000001';
export const MEMBER = 'U_member_00000000000000000000002';
export const STRANGER = 'U_stranger_000000000000000000003';
export const GROUP = 'C_snk_money_group_0000000000000001';
export const OTHER_GROUP = 'C_some_other_group_00000000000002';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
// 10:00 Monday 5 Oct 2026, Asia/Bangkok
export const NOW = new Date('2026-10-05T03:00:00Z');

export type Harness = Awaited<ReturnType<typeof harness>>;

export async function harness(opts: {
  llm?: LlmInterpreter | null;
  businessBound?: string[];
  slips?: Record<string, SlipExtraction | 'fail'>;
  images?: Record<string, string>;
  /** false = production-like: no SNK_MONEY_OWNER_ID, the owner comes from a dashboard-issued binding code. */
  pinnedOwner?: boolean;
  env?: Record<string, string | undefined>;
} = {}) {
  const { db, ledger, rpc, owner } = await freshDb();
  const businessBound = new Set(opts.businessBound ?? []);
  const slips = opts.slips ?? {};
  const images = opts.images ?? {};
  const log: Array<{ event: string; data: Record<string, unknown> }> = [];
  let counter = 0;

  const deps: PfDeps = {
    rpc,
    envOwnerId: opts.pinnedOwner === false ? null : owner,
    llm: opts.llm ?? null,
    now: () => NOW,
    env: opts.env ?? (opts.pinnedOwner === false ? {} : { PF_OWNER_LINE_USER_IDS: OWNER, PF_FINANCE_MEMBER_LINE_USER_IDS: MEMBER }),
    hash: v => sha(v.trim().toLowerCase()),
    encrypt: v => `enc:${v}`,
    isBusinessBound: async g => businessBound.has(g),
    fetchImage: async messageId => {
      const bytes = Buffer.from(images[messageId] ?? `image-${messageId}`);
      return { bytes, mimeType: 'image/jpeg', sha256: sha(bytes.toString()) };
    },
    extractSlip: async bytes => {
      const key = Object.keys(images).find(k => (images[k] ?? `image-${k}`) === bytes.toString()) ?? bytes.toString().replace('image-', '');
      const slip = slips[key];
      if (!slip || slip === 'fail') throw new Error('extraction_failed');
      return slip;
    },
    log: (event, data) => log.push({ event, data }),
  };

  const event = (partial: Partial<PfEvent> & { text?: string; user?: string | null; group?: string; image?: boolean; id?: string }): PfEvent => ({
    type: partial.type ?? 'message',
    replyToken: 'rt',
    timestamp: NOW.getTime(),
    webhookEventId: `we-${++counter}`,
    source: { type: 'group', groupId: partial.group ?? GROUP, userId: partial.user === null ? undefined : (partial.user ?? OWNER) },
    message: partial.type && partial.type !== 'message' ? undefined : {
      id: partial.id ?? `msg-${++counter}`,
      type: partial.image ? 'image' : 'text',
      text: partial.image ? undefined : partial.text,
    },
  });

  const say = async (text: string, o: { user?: string; group?: string; id?: string } = {}): Promise<PfOutcome> =>
    handlePersonalFinanceEvent(event({ text, ...o }), deps);
  const image = async (id: string, o: { user?: string; group?: string } = {}): Promise<PfOutcome> =>
    handlePersonalFinanceEvent(event({ image: true, id, ...o }), deps);
  const raw = (partial: Parameters<typeof event>[0]) => handlePersonalFinanceEvent(event(partial), deps);

  const activate = async (group = GROUP) => {
    await raw({ type: 'join', group, user: null });
    return say('ยืนยันกลุ่มการเงิน', { group });
  };
  const accounts = async () => (await ledger.getAccounts()).accounts;
  const account = async (name: string) => (await accounts()).find(a => a.name.toLowerCase() === name.toLowerCase());
  const count = async (table: string, where = 'true') => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n);
  const balanceOf = async (name: string) => { const a = await account(name); return a?.balance === null || a === undefined ? null : Number(a.balance); };

  return { db, ledger, deps, say, image, raw, activate, accounts, account, count, balanceOf, log, businessBound };
}

/** Persona contract: Thai replies are male-voiced and end with ครับ. */
export function assertPersona(reply: string | null): void {
  if (reply === null) return;
  if (/ค่ะ|คะ/.test(reply)) throw new Error(`feminine particle in reply: ${reply}`);
  if (/[฀-๿]/.test(reply) && !/ครับ[\s!.…]*$/.test(reply)) throw new Error(`reply must end with ครับ: ${reply}`);
}
