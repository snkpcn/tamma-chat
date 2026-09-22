import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { interpretStayBookingTurn } from './_thongthai-brain-v3';
import { CONTEXT_TTL_MS } from './_conversation-context';
import { findKnownActivityAssetSelection } from './_deterministic-semantic-turn';
import { isTerminalTaskStatus, loadTaskState } from './_task-state';
import { extractDate as extractDateShared } from './_slot-parsers';

export type OpsChannel = 'web' | 'line' | 'facebook' | 'messenger' | 'backoffice';
export type ServiceType = 'restaurant' | 'stay' | 'activity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  if (!c) throw new Error('Operations database is not configured');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Operations database request failed ${res.status}: ${body.slice(0, 240)}`);
  }
  return res;
}

function piiKey(): Buffer {
  const raw = process.env.CUSTOMER_PII_ENCRYPTION_KEY;
  if (!raw) throw new Error('CUSTOMER_PII_ENCRYPTION_KEY is not configured');
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  const key = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) throw new Error('CUSTOMER_PII_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptPii(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', piiKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptPii(value: string | null | undefined): string | null {
  if (!value) return null;
  const [version, ivRaw, tagRaw, dataRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', piiKey(), Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function piiHash(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  return text ? createHash('sha256').update(text, 'utf8').digest('hex') : null;
}

function cleanPhone(value: string | null | undefined): string | null {
  const text = value?.replace(/[^0-9+]/g, '').trim();
  return text && text.length >= 8 && text.length <= 20 ? text : null;
}

function cleanEmail(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

export async function guestDbIdFromAnonymousId(anonymousId: string | undefined): Promise<string | null> {
  if (!anonymousId || !UUID_RE.test(anonymousId)) return null;
  const res = await dbFetch(`guests?anonymous_id=eq.${encodeURIComponent(anonymousId)}&select=id&limit=1`);
  const rows = await res.json() as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export interface CustomerInput {
  guestDbId?: string | null;
  authUserId?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContact?: 'line' | 'phone' | 'email' | null;
  marketingOptIn?: boolean;
  researchOptIn?: boolean;
  birthDate?: string | null;
  gender?: 'male' | 'female' | 'non_binary' | 'self_described' | 'prefer_not_to_say' | null;
  genderSelfDescription?: string | null;
  isTest?: boolean;
  testLabel?: string | null;
}

export async function upsertCustomerAccount(input: CustomerInput): Promise<string> {
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone);
  const emailHash = piiHash(email);
  const phoneHash = piiHash(phone);
  const clauses: string[] = [];
  if (input.authUserId && UUID_RE.test(input.authUserId)) clauses.push(`auth_user_id=eq.${encodeURIComponent(input.authUserId)}`);
  if (input.guestDbId && UUID_RE.test(input.guestDbId)) clauses.push(`guest_id=eq.${encodeURIComponent(input.guestDbId)}`);
  if (emailHash) clauses.push(`email_hash=eq.${emailHash}`);
  if (phoneHash) clauses.push(`phone_hash=eq.${phoneHash}`);

  let existing: { id: string } | undefined;
  if (input.authUserId && input.guestDbId) {
    const merged = await dbFetch('rpc/merge_member_identity', {
      method: 'POST',
      body: JSON.stringify({ p_auth_user_id: input.authUserId, p_guest_id: input.guestDbId, p_source_channel: 'web' }),
    });
    const id = await merged.json() as string;
    if (id) existing = { id };
  }
  for (const clause of clauses) {
    if (existing) break;
    const res = await dbFetch(`customer_accounts?${clause}&select=id&limit=1`);
    const rows = await res.json() as Array<{ id: string }>;
    if (rows[0]) { existing = rows[0]; break; }
  }

  const body: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.authUserId && UUID_RE.test(input.authUserId)) body.auth_user_id = input.authUserId;
  if (input.guestDbId && UUID_RE.test(input.guestDbId)) body.guest_id = input.guestDbId;
  if (input.fullName?.trim()) body.full_name_enc = encryptPii(input.fullName);
  if (email) { body.email_enc = encryptPii(email); body.email_hash = emailHash; }
  if (phone) { body.phone_enc = encryptPii(phone); body.phone_hash = phoneHash; }
  if (input.preferredContact) body.preferred_contact = input.preferredContact;
  if (typeof input.marketingOptIn === 'boolean') body.marketing_opt_in = input.marketingOptIn;
  if (typeof input.researchOptIn === 'boolean') body.research_opt_in = input.researchOptIn;
  if (input.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) body.birth_date = input.birthDate;
  if (input.gender) body.gender = input.gender;
  if (input.gender === 'self_described' && input.genderSelfDescription?.trim()) {
    body.gender_self_description = input.genderSelfDescription.trim().slice(0, 120);
  }
  if (input.authUserId) {
    body.member_status = 'member';
  }
  if (input.isTest === true) body.is_test = true;
  if (input.testLabel?.trim()) body.test_label = input.testLabel.trim().slice(0, 120);

  if (existing) {
    await dbFetch(`customer_accounts?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (typeof input.marketingOptIn === 'boolean' || typeof input.researchOptIn === 'boolean') {
      const consentRows = [];
      if (typeof input.marketingOptIn === 'boolean') consentRows.push({ customer_id: existing.id, consent_type: 'marketing', granted: input.marketingOptIn, consent_version: 'v1', source_channel: 'web' });
      if (typeof input.researchOptIn === 'boolean') consentRows.push({ customer_id: existing.id, consent_type: 'research', granted: input.researchOptIn, consent_version: 'v1', source_channel: 'web' });
      await dbFetch('customer_consents', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(consentRows) });
    }
    return existing.id;
  }

  const res = await dbFetch('customer_accounts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...body,
      created_at: new Date().toISOString(),
      ...(input.authUserId ? { membership_started_at: new Date().toISOString(), acquisition_source: 'web' } : {}),
    }),
  });
  const rows = await res.json() as Array<{ id: string }>;
  if (!rows[0]?.id) throw new Error('Customer account was not created');
  const consentRows = [];
  if (typeof input.marketingOptIn === 'boolean') consentRows.push({ customer_id: rows[0].id, consent_type: 'marketing', granted: input.marketingOptIn, consent_version: 'v1', source_channel: 'web' });
  if (typeof input.researchOptIn === 'boolean') consentRows.push({ customer_id: rows[0].id, consent_type: 'research', granted: input.researchOptIn, consent_version: 'v1', source_channel: 'web' });
  if (consentRows.length) await dbFetch('customer_consents', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(consentRows) });
  return rows[0].id;
}

async function ensureGuest(anonymousId: string): Promise<string | null> {
  if (!UUID_RE.test(anonymousId)) return null;
  const existing = await guestDbIdFromAnonymousId(anonymousId);
  if (existing) return existing;
  const response = await dbFetch('guests?on_conflict=anonymous_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ anonymous_id: anonymousId, language: 'th', last_seen_at: new Date().toISOString() }),
  });
  const rows = await response.json() as Array<{ id: string }>;
  return rows[0]?.id ?? await guestDbIdFromAnonymousId(anonymousId);
}

export async function registerLineContact(anonymousId: string, rawLineUserId: string): Promise<{ customerId: string; guestDbId: string } | null> {
  if (!rawLineUserId || rawLineUserId.length > 160) return null;
  const guestDbId = await ensureGuest(anonymousId);
  if (!guestDbId) return null;
  const hash = piiHash(rawLineUserId);
  if (!hash) return null;

  const contactResponse = await dbFetch(
    `customer_channel_contacts?provider=eq.line&external_id_hash=eq.${hash}&select=customer_id&limit=1`,
  );
  const contacts = await contactResponse.json() as Array<{ customer_id: string }>;
  let customerId = contacts[0]?.customer_id ?? null;

  if (customerId) {
    const accountResponse = await dbFetch(
      `customer_accounts?id=eq.${customerId}&select=id,auth_user_id,guest_id&limit=1`,
    );
    const account = (await accountResponse.json() as Array<{ id: string; auth_user_id: string | null; guest_id: string | null }>)[0];
    if (account?.auth_user_id && account.guest_id !== guestDbId) {
      const mergeResponse = await dbFetch('rpc/merge_member_identity', {
        method: 'POST',
        body: JSON.stringify({ p_auth_user_id: account.auth_user_id, p_guest_id: guestDbId, p_source_channel: 'line' }),
      });
      customerId = await mergeResponse.json() as string;
    } else if (account && !account.guest_id) {
      await dbFetch(`customer_accounts?id=eq.${customerId}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ guest_id: guestDbId }),
      });
    }
  } else {
    customerId = await upsertCustomerAccount({ guestDbId, preferredContact: 'line' });
  }

  await dbFetch('customer_channel_contacts?on_conflict=provider,external_id_hash', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      customer_id: customerId,
      provider: 'line',
      external_id_enc: encryptPii(rawLineUserId),
      external_id_hash: hash,
      reachable: true,
      verified: true,
      last_seen_at: new Date().toISOString(),
    }),
  });
  return { customerId, guestDbId };
}

type LineMembershipStep = 'birth_date' | 'gender' | 'gender_description' | 'marketing' | 'research' | 'edit_choice';
type LineMembershipState = { step?: LineMembershipStep };

function parseBirthDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
  if (!match) return null;
  let year: number; let month: number; let day: number;
  if (match[1].length === 4) { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
  else { day = Number(match[1]); month = Number(match[2]); year = Number(match[3]); }
  if (year > 2400) year -= 543;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day && parsed <= new Date() ? iso : null;
}

function parseGender(value: string): { gender: string; description?: string } | null {
  const text = value.trim().toLowerCase();
  if (/^(ชาย|ผู้ชาย|male)$/.test(text)) return { gender: 'male' };
  if (/^(หญิง|ผู้หญิง|female)$/.test(text)) return { gender: 'female' };
  if (/^(นอนไบนารี|non.?binary)$/.test(text)) return { gender: 'non_binary' };
  if (/^(ไม่ระบุ|ไม่ต้องการระบุ|ไม่ประสงค์ระบุ|prefer not to say)$/.test(text)) return { gender: 'prefer_not_to_say' };
  if (/^(ระบุเอง|อื่นๆ|อื่น ๆ|self.?described)$/.test(text)) return { gender: 'self_described' };
  return null;
}

function parseConsent(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (/^(ยินยอม|ตกลง|รับ|yes|y|ok|โอเค)$/.test(text)) return true;
  if (/^(ไม่ยินยอม|ไม่ตกลง|ไม่รับ|no|n|ไม่)$/.test(text)) return false;
  return null;
}

async function membershipState(guestDbId: string): Promise<LineMembershipState> {
  const response = await dbFetch(`guest_agent_state?guest_id=eq.${guestDbId}&select=state&limit=1`);
  const row = (await response.json() as Array<{ state: Record<string, unknown> }>)[0];
  const membership = row?.state?.line_membership;
  return membership && typeof membership === 'object' ? membership as LineMembershipState : {};
}

async function setMembershipStep(guestDbId: string, step?: LineMembershipStep): Promise<void> {
  const response = await dbFetch(`guest_agent_state?guest_id=eq.${guestDbId}&select=state&limit=1`);
  const row = (await response.json() as Array<{ state: Record<string, unknown> }>)[0];
  const state = { ...(row?.state ?? {}) };
  if (step) state.line_membership = { step };
  else delete state.line_membership;
  await dbFetch('guest_agent_state?on_conflict=guest_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ guest_id: guestDbId, state, updated_at: new Date().toISOString() }),
  });
}

async function updateLineMember(guestDbId: string, fields: Record<string, unknown>): Promise<string> {
  const response = await dbFetch('rpc/upsert_line_member_profile', {
    method: 'POST', body: JSON.stringify({ p_guest_id: guestDbId, ...fields }),
  });
  return await response.json() as string;
}

async function recordMembershipStarted(customerId: string, guestDbId: string): Promise<void> {
  const response = await dbFetch(
    `customer_membership_events?customer_id=eq.${customerId}&event_type=eq.signup_started&select=id&limit=1`,
  );
  if ((await response.json() as Array<{ id: number }>).length) return;
  await dbFetch('customer_membership_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ customer_id: customerId, guest_id: guestDbId, event_type: 'signup_started', source_channel: 'line', metadata: { line_first: true } }),
  });
}

async function memberSummary(customerId: string): Promise<string> {
  const response = await dbFetch(
    `customer_accounts?id=eq.${customerId}&select=member_status,birth_date,gender,marketing_opt_in,research_opt_in,profile_completed_at&limit=1`,
  );
  const row = (await response.json() as Array<Record<string, unknown>>)[0];
  if (!row || row.member_status !== 'member') return 'ตอนนี้ยังเป็นข้อมูลผู้สนใจอยู่ครับ พิมพ์ “สมัครสมาชิก” เพื่อสมัครใน LINE ได้เลย';
  const gender = ({ male: 'ชาย', female: 'หญิง', non_binary: 'นอนไบนารี', self_described: 'ระบุเอง', prefer_not_to_say: 'ไม่ประสงค์ระบุ' } as Record<string, string>)[String(row.gender)] || 'ยังไม่ระบุ';
  return `สถานะสมาชิก: สมาชิก${row.profile_completed_at ? ' · โปรไฟล์ครบ' : ''}\nวันเกิด: ${row.birth_date || 'ยังไม่ระบุ'}\nเพศ: ${gender}\nการตลาด: ${row.marketing_opt_in ? 'ยินยอม' : 'ไม่ยินยอม'}\nวิจัย: ${row.research_opt_in ? 'ยินยอม' : 'ไม่ยินยอม'}`;
}

/** Deterministic LINE-first membership flow. Returns null when normal Thongthai should answer. */
export async function handleLineMembershipMessage(anonymousId: string, rawLineUserId: string, message: string): Promise<string | null> {
  const identity = await registerLineContact(anonymousId, rawLineUserId);
  if (!identity) return null;
  const text = message.trim();
  const state = await membershipState(identity.guestDbId);
  const isStart = /^(สมัครสมาชิก|อยากเป็นสมาชิก|เป็นสมาชิก)$/u.test(text);
  const isProfile = /^(สมาชิก|ข้อมูลสมาชิก|ดูโปรไฟล์)$/u.test(text);
  const isEdit = /^แก้ข้อมูลสมาชิก$/u.test(text);
  const isWebLink = /^เชื่อมบัญชีเว็บ$/u.test(text);

  if (isWebLink) return 'ได้ครับ บัญชีเว็บเป็นทางเลือก เปิดหน้า account.html แล้วเข้าสู่ระบบด้วยอีเมล จากอุปกรณ์ที่มี Journey เดิม ระบบจะเชื่อมเข้ากับ Customer ID เดียวกันครับ\nhttps://tamma-chat.netlify.app/account.html';
  if (isProfile && !state.step) return memberSummary(identity.customerId);
  if (isEdit) {
    await setMembershipStep(identity.guestDbId, 'edit_choice');
    return 'ได้ครับ อยากแก้ส่วนไหน: วันเกิด, เพศ, การตลาด หรือวิจัย?';
  }
  if (state.step === 'edit_choice') {
    if (/วันเกิด/u.test(text)) { await setMembershipStep(identity.guestDbId, 'birth_date'); return 'ส่งวันเกิดเป็น วว/ดด/ปปปป ได้เลยครับ'; }
    if (/เพศ/u.test(text)) { await setMembershipStep(identity.guestDbId, 'gender'); return 'ระบุเพศได้เลยครับ: ชาย, หญิง, นอนไบนารี, ระบุเอง หรือไม่ประสงค์ระบุ'; }
    if (/การตลาด/u.test(text)) { await setMembershipStep(identity.guestDbId, 'marketing'); return 'ยินยอมรับข่าวสารและสิทธิพิเศษทางการตลาดไหมครับ? ตอบ “ยินยอม” หรือ “ไม่ยินยอม”'; }
    if (/วิจัย/u.test(text)) { await setMembershipStep(identity.guestDbId, 'research'); return 'ยินยอมให้นำข้อมูลแบบไม่ระบุตัวตนไปใช้พัฒนาบริการและงานวิจัยไหมครับ? ตอบ “ยินยอม” หรือ “ไม่ยินยอม”'; }
    return 'เลือกได้ 1 อย่างครับ: วันเกิด, เพศ, การตลาด หรือวิจัย';
  }
  if (isStart) {
    const accountResponse = await dbFetch(`customer_accounts?id=eq.${identity.customerId}&select=member_status,birth_date,gender&limit=1`);
    const account = (await accountResponse.json() as Array<{ member_status: string; birth_date: string | null; gender: string | null }>)[0];
    if (account?.member_status === 'member' && account.birth_date && account.gender) return memberSummary(identity.customerId);
    await recordMembershipStarted(identity.customerId, identity.guestDbId);
    if (!account?.birth_date) { await setMembershipStep(identity.guestDbId, 'birth_date'); return 'ยินดีครับ เดี๋ยวทองไทยช่วยสมัครให้ในแชตนี้เลย ขอวันเกิดก่อนครับ ส่งเป็น วว/ดด/ปปปป ได้เลย'; }
    await setMembershipStep(identity.guestDbId, 'gender');
    return 'ขอเพศสำหรับโปรไฟล์ครับ: ชาย, หญิง, นอนไบนารี, ระบุเอง หรือไม่ประสงค์ระบุ';
  }
  if (!state.step) return null;

  if (state.step === 'birth_date') {
    const birthDate = parseBirthDate(text);
    if (!birthDate) return 'วันเกิดยังอ่านไม่ออกครับ ลองส่งแบบ 15/04/2533 หรือ 1990-04-15';
    await updateLineMember(identity.guestDbId, { p_birth_date: birthDate, p_finalize: false });
    await setMembershipStep(identity.guestDbId, 'gender');
    return 'ขอบคุณครับ ต่อไปขอเพศ: ชาย, หญิง, นอนไบนารี, ระบุเอง หรือไม่ประสงค์ระบุ';
  }
  if (state.step === 'gender') {
    const value = parseGender(text);
    if (!value) return 'เลือกได้ว่า ชาย, หญิง, นอนไบนารี, ระบุเอง หรือไม่ประสงค์ระบุครับ';
    await updateLineMember(identity.guestDbId, { p_gender: value.gender, p_finalize: false });
    if (value.gender === 'self_described') { await setMembershipStep(identity.guestDbId, 'gender_description'); return 'บอกคำที่อยากใช้ระบุเพศได้เลยครับ'; }
    await setMembershipStep(identity.guestDbId, 'marketing');
    return 'ยินยอมรับข่าวสารและสิทธิพิเศษทางการตลาดไหมครับ? ตอบ “ยินยอม” หรือ “ไม่ยินยอม” ได้เลย บริการพื้นฐานใช้ได้เหมือนเดิมไม่ว่าจะเลือกแบบไหน';
  }
  if (state.step === 'gender_description') {
    const description = text.slice(0, 120);
    if (!description) return 'บอกคำสั้น ๆ ที่อยากใช้ระบุเพศได้เลยครับ';
    await updateLineMember(identity.guestDbId, { p_gender: 'self_described', p_gender_self_description: description, p_finalize: false });
    await setMembershipStep(identity.guestDbId, 'marketing');
    return 'ยินยอมรับข่าวสารและสิทธิพิเศษทางการตลาดไหมครับ? ตอบ “ยินยอม” หรือ “ไม่ยินยอม”';
  }
  if (state.step === 'marketing') {
    const consent = parseConsent(text);
    if (consent === null) return 'ตอบ “ยินยอม” หรือ “ไม่ยินยอม” ได้เลยครับ การเลือกนี้ไม่กระทบบริการพื้นฐาน';
    await updateLineMember(identity.guestDbId, { p_marketing_opt_in: consent, p_finalize: false });
    await setMembershipStep(identity.guestDbId, 'research');
    return 'อีกข้อแยกกันครับ ยินยอมให้นำข้อมูลแบบไม่ระบุตัวตนไปใช้พัฒนาบริการและงานวิจัยไหมครับ? ตอบ “ยินยอม” หรือ “ไม่ยินยอม”';
  }
  if (state.step === 'research') {
    const consent = parseConsent(text);
    if (consent === null) return 'ตอบ “ยินยอม” หรือ “ไม่ยินยอม” ได้เลยครับ ข้อนี้แยกจากการตลาดและไม่กระทบบริการพื้นฐาน';
    await updateLineMember(identity.guestDbId, { p_research_opt_in: consent, p_finalize: true });
    await setMembershipStep(identity.guestDbId);
    return 'สมัครสมาชิกเรียบร้อยแล้วครับ ✅ ความจำ Journey การจอง และรางวัลเดิมยังอยู่กับ Customer ID เดียวกัน อีเมลไม่จำเป็นสำหรับสมาชิกผ่าน LINE ครับ';
  }
  return null;
}

export type LineBookingSession = {
  service_type: ServiceType | null;
  resource_code: string | null;
  requested_date: string | null;
  requested_time: string | null;
  end_date: string | null;
  party_size: number | null;
  quantity: number;
  special_request: string | null;
  status: 'collecting' | 'awaiting_phone' | 'awaiting_special_request' | 'needs_slot' | 'ready' | 'submitted' | 'failed' | 'cancelled';
  booking_code: string | null;
  updated_at?: string | null;
};

function bangkokDateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function validIsoDate(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? iso : null;
}

function bookingDateFromText(text: string): string | null {
  // "/" and "-" only, deliberately NOT ".": a period is also the activity
  // time separator ("13.00" = 13:00, see activityTimeFromText), so a message
  // stating both a date and a time ("3 ตุลาคม เวลา 13.00") would otherwise
  // have its time misread as a malformed DD.MM date (month 00, invalid) --
  // silently short-circuiting before the Thai-month check below ever ran.
  const numeric = text.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?:\s|$)/);
  if (numeric) {
    const today = bangkokDateParts();
    let year = numeric[3] ? Number(numeric[3]) : today.year;
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    const resolved = validIsoDate(year, Number(numeric[2]), Number(numeric[1]));
    if (resolved) return resolved;
  }
  const matched = text.match(/วันที่\s*(\d{1,2})(?:\s*(?:เดือน)?\s*(นี้|หน้า))?/u);
  if (matched) {
    const today = bangkokDateParts();
    let month = today.month + (matched[2] === 'หน้า' ? 1 : 0);
    let year = today.year;
    if (month > 12) { month = 1; year += 1; }
    return validIsoDate(year, month, Number(matched[1]));
  }
  // "3 ตุลาคม" / "3 ต.ค." -- a day + Thai month NAME, which neither pattern
  // above recognizes. Reuses the SAME shared parser _deterministic-semantic-
  // turn.ts's turn derivation already uses, rather than a second copy of the
  // Thai month lexicon here.
  return extractDateShared(text);
}

function checkoutDateFromText(text: string, checkIn: string | null): string | null {
  const explicit = text.match(/(?:เช็กเอาต์|เชกเอาต์|เช็คเอาท์|เช็คเอาต์|เชคเอาท์|เชคเอาต์|checkout|ออก)(?:\s*วันที่)?\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?)?/iu);
  if (!explicit) return null;
  if (explicit[2]) {
    const today = bangkokDateParts();
    let year = explicit[3] ? Number(explicit[3]) : today.year;
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    return validIsoDate(year, Number(explicit[2]), Number(explicit[1]));
  }
  if (!checkIn) return null;
  const [yearRaw, monthRaw, startDayRaw] = checkIn.split('-').map(Number);
  let year = yearRaw; let month = monthRaw;
  const day = Number(explicit[1]);
  if (day <= startDayRaw) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return validIsoDate(year, month, day);
}

export function contextualCheckoutDateFromText(text: string, checkIn: string | null): string | null {
  if (!checkIn) return null;
  // During an active booking where checkout is the pending question, the state
  // disambiguates a bare date even when the customer misspells or omits "checkout".
  const hasDateCue = /วันที่\s*\d/u.test(text);
  const hasCheckoutCue = /(?:เช[^\s]{0,12}(?:เอา|เอ้า|เอาต์|เอาท์)|ออก)/u.test(text);
  if (!hasDateCue && !hasCheckoutCue) return null;
  const matched = hasDateCue
    ? text.match(/วันที่\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?)?/u)
    : text.match(/(?:เช[^\s]{0,16}|ออก)[^\d]{0,16}(\d{1,2})(?:\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?)?/u);
  if (!matched) return null;
  const [checkInYear, checkInMonth, checkInDay] = checkIn.split('-').map(Number);
  let year = matched[3] ? Number(matched[3]) : checkInYear;
  let month = matched[2] ? Number(matched[2]) : checkInMonth;
  const day = Number(matched[1]);
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543;
  if (!matched[2] && day <= checkInDay) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  const candidate = validIsoDate(year, month, day);
  return candidate && candidate > checkIn ? candidate : null;
}

function partySizeFromText(text: string): number | null {
  const matched = text.match(/(\d{1,2})\s*(?:คน|ท่าน)/u);
  const thaiMatched = text.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:คน|ท่าน)/u);
  const thaiNumbers: Record<string, number> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10 };
  const count = matched ? Number(matched[1]) : thaiMatched ? thaiNumbers[thaiMatched[1]] : 0;
  return count >= 1 && count <= 50 ? count : null;
}

function roomQuantityFromText(text: string): number | null {
  const matched = text.match(/(\d{1,2})\s*ห้อง/u);
  const thaiMatched = text.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|หก)\s*ห้อง/u);
  const thaiNumbers: Record<string, number> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6 };
  const count = matched ? Number(matched[1]) : thaiMatched ? thaiNumbers[thaiMatched[1]] : 0;
  return count >= 1 && count <= 6 ? count : null;
}

function phoneFromText(text: string): string | null {
  return cleanPhone(text.match(/(?:\+?66|0)\d(?:[\s-]?\d){7,9}/)?.[0]);
}

function primaryGuestNameFromText(text: string): string | null {
  const withoutPhone = text.replace(/(?:\+?66|0)\d(?:[\s-]?\d){7,9}/g, ' ');
  const named = withoutPhone.match(/(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:เบอร์|โทร|ครับ|ค่ะ|คะ|$))/u)?.[1];
  const candidate = (named ?? (/^[\p{L}.\s]{2,80}$/u.test(withoutPhone.trim()) ? withoutPhone : '')).trim();
  return candidate ? candidate.replace(/^(?:คุณ|นาย|นาง|นางสาว)\s*/u, '').slice(0, 120) : null;
}

async function loadLineBookingSession(guestDbId: string): Promise<LineBookingSession | null> {
  const response = await dbFetch(
    `booking_sessions?guest_id=eq.${guestDbId}&select=service_type,resource_code,requested_date,requested_time,end_date,party_size,quantity,special_request,status,booking_code,updated_at&limit=1`,
  );
  return (await response.json() as LineBookingSession[])[0] ?? null;
}

async function saveLineBookingSession(guestDbId: string, environment: 'live' | 'test', body: Partial<LineBookingSession>): Promise<void> {
  await dbFetch('booking_sessions?on_conflict=guest_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ guest_id: guestDbId, environment, ...body, updated_at: new Date().toISOString() }),
  });
}

async function bookingStatusReply(bookingCode: string | null): Promise<string | null> {
  if (!bookingCode) return null;
  const response = await dbFetch(
    `bookings?booking_code=eq.${encodeURIComponent(bookingCode)}`
    + '&select=booking_code,status,service_type,start_at,end_at,party_size,quantity&limit=1',
  );
  const booking = (await response.json() as Array<{
    booking_code: string;
    status: string;
    service_type: ServiceType;
    start_at: string;
    end_at: string;
    party_size: number | null;
    quantity: number;
  }>)[0];
  if (!booking) return null;
  const detail = `${booking.booking_code}\n${booking.service_type === 'stay' ? 'เฮือนสเตย์' : booking.service_type}`
    + ` · ${thaiShortDate(booking.start_at)} – ${thaiShortDate(booking.end_at)}`;
  if (booking.status === 'confirmed') return `ยืนยันการจองแล้วครับ ✅\n${detail}\nสถานะ: ยืนยันแล้ว ทีมงานได้รับรายการเรียบร้อยครับ`;
  if (booking.status === 'cancelled') return `รายการจองถูกยกเลิกแล้วครับ\n${detail}\nหากต้องการเปลี่ยนวันหรือให้ทองไทยช่วยหาแผนใหม่ บอกได้เลยครับ`;
  if (booking.status === 'completed') return `รายการนี้เสร็จสมบูรณ์แล้วครับ ✅\n${detail}`;
  if (booking.status === 'no_show') return `รายการ ${booking.booking_code} ปิดแล้วครับ หากต้องการให้ทีมงานตรวจสอบเพิ่มเติม บอกทองไทยได้เลยครับ`;
  return `รับคำขอจองไว้แล้วครับ ✅\nเลขที่คำขอ: ${booking.booking_code}\nสถานะ: รอทีมงานตรวจสอบห้องว่างและยืนยันกลับทาง LINE นี้ครับ`;
}

async function lineBookingContact(customerId: string): Promise<{ fullName: string | null; phone: string | null; isTest: boolean }> {
  const response = await dbFetch(`customer_accounts?id=eq.${customerId}&select=full_name_enc,phone_enc,is_test&limit=1`);
  const row = (await response.json() as Array<{ full_name_enc: string | null; phone_enc: string | null; is_test: boolean }>)[0];
  return { fullName: decryptPii(row?.full_name_enc), phone: decryptPii(row?.phone_enc), isTest: row?.is_test === true };
}

async function createUnscheduledStayRequest(input: {
  guestDbId: string;
  customerId: string;
  date: string;
  endDate: string;
  partySize: number;
  quantity: number;
  environment: 'live' | 'test';
  specialRequest?: string | null;
}): Promise<{ bookingCode: string; status: string; startAt: string; endAt: string }> {
  const resourceResponse = await dbFetch('service_resources?service_type=eq.stay&active=eq.true&select=id&order=created_at.asc&limit=1');
  const resource = (await resourceResponse.json() as Array<{ id: string }>)[0];
  if (!resource?.id) throw new Error('resource_not_found');
  const startAt = `${input.date}T00:00:00+07:00`;
  const endAt = `${input.endDate}T00:00:00+07:00`;
  const response = await dbFetch('bookings', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      customer_id: input.customerId,
      guest_id: input.guestDbId,
      service_type: 'stay',
      resource_id: resource.id,
      start_at: startAt,
      end_at: endAt,
      party_size: input.partySize,
      quantity: input.quantity,
      status: 'requested',
      source_channel: 'line',
      customer_note: input.specialRequest?.slice(0, 1000) ?? null,
      staff_note: 'ยังไม่มีตารางจริงสำหรับช่วงนี้ — กรุณาตรวจสอบห้องว่างก่อนยืนยัน',
      contact_status: 'pending',
      environment: input.environment,
    }),
  });
  const booking = (await response.json() as Array<{ booking_code: string; status: string }>)[0];
  if (!booking?.booking_code) throw new Error('booking_not_created');
  return { bookingCode: booking.booking_code, status: booking.status, startAt, endAt };
}

function thaiShortDate(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+07:00` : iso));
}

function shiftBangkokDate(days: number): string {
  const today = bangkokDateParts();
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  return d.toISOString().slice(0, 10);
}

function activityDateFromText(text: string): string | null {
  if (/(?:พรุ่งนี้|tomorrow)/iu.test(text)) return shiftBangkokDate(1);
  if (/(?:วันนี้|today)/iu.test(text)) return shiftBangkokDate(0);
  return bookingDateFromText(text);
}

function activityResourceFromText(text: string): string | null {
  if (/\bATV\b|เอทีวี/iu.test(text)) return 'activity-atv';
  if (/ยิงธนู|archery/iu.test(text)) return 'activity-archery';
  if (/ขี่ม้า|horse(?:\s*riding)?/iu.test(text)) return 'activity-horse';
  return null;
}

function activityDurationFromText(text: string): 30 | 60 | 90 | null {
  if (/(?:ครึ่ง\s*ชั่วโมง|half\s*(?:an\s*)?hour)/iu.test(text)) return 30;
  if (/(?:ชั่วโมง\s*ครึ่ง|one\s*and\s*a\s*half\s*hours?)/iu.test(text)) return 90;
  if (/(?:1|หนึ่ง)\s*(?:ชั่วโมง|ชม\.?|hour)/iu.test(text)) return 60;
  // No trailing boundary requirement after "นาที": Thai politeness particles
  // (ครับ/ค่ะ/นะ) are routinely written directly attached to the preceding
  // word with no space ("30 นาทีครับ"), which is the overwhelmingly common
  // real phrasing -- requiring whitespace-or-end right after "นาที" rejected
  // exactly that and was itself part of why a duration stated this way fell
  // through to a different system that had never seen it (see
  // tests/line-booking-cross-system-state.test.ts).
  const m = text.match(/(?:^|\s)(30|60|90)\s*(?:นาที|min(?:ute)?s?)/iu);
  const n = Number(m?.[1]);
  return n === 30 || n === 60 || n === 90 ? n : null;
}

export function activityDurationFromSession(session: LineBookingSession | null): 30 | 60 | 90 | null {
  const fromQuantity = Number(session?.quantity);
  if (fromQuantity === 30 || fromQuantity === 60 || fromQuantity === 90) return fromQuantity;
  const fromNote = session?.special_request?.match(/activity_duration:(30|60|90)/)?.[1];
  const n = Number(fromNote);
  return n === 30 || n === 60 || n === 90 ? n : null;
}

/** The specific named asset (e.g. "ภาราดร") a customer selects mid-
 *  conversation is otherwise never captured by this legacy transactional
 *  flow -- resourceCode only ever carries the ACTIVITY TYPE ("activity-
 *  horse"), never which of the 2 real horses. Reuses the SAME bounded,
 *  owner-verified lexicon the deterministic semantic layer already uses
 *  (_deterministic-semantic-turn.ts's ACTIVITY_ASSET_SELECTIONS) so there is
 *  exactly one source of truth for "which named assets exist", not a second
 *  copy of the list. */
export function activityAssetFromText(text: string): { name: string; assetCode: string } | null {
  const match = findKnownActivityAssetSelection(text);
  if (!match) return null;
  const assetCode = match.entityId.replace(/^activity_asset:/, '');
  return { name: match.name, assetCode };
}

export function activityAssetFromSession(session: LineBookingSession | null): { name: string; assetCode: string } | null {
  const fromNote = session?.special_request?.match(/activity_asset:([a-z0-9-]+):([^;]*)/u);
  return fromNote ? { assetCode: fromNote[1]!, name: decodeURIComponent(fromNote[2]!) } : null;
}

export function activitySessionMarker(durationMinutes: 30 | 60 | 90 | null, asset: { name: string; assetCode: string } | null): string | null {
  const parts: string[] = [];
  if (durationMinutes) parts.push(`activity_duration:${durationMinutes}`);
  if (asset) parts.push(`activity_asset:${asset.assetCode}:${encodeURIComponent(asset.name)}`);
  return parts.length ? parts.join(';') : null;
}

/** The durable, cross-repo contract for "which named asset did the
 *  customer pick": a `[asset:<code>]` tag appended to the booking's own
 *  customer_note, where <code> is the real activity_assets.asset_code
 *  (e.g. "horse-pharadon"). tamma-backoffice's operations adapter parses
 *  this same tag back out to resolve the schedule-grid cell -- keep this
 *  format in sync with that repo's booking-asset normalization if it ever
 *  changes here. Human-readable name stays in front so customer_note is
 *  still plain text everywhere else it's already displayed. */
export function formatActivityAssetNote(asset: { name: string; assetCode: string }): string {
  return `เลือก: ${asset.name} [asset:${asset.assetCode}]`;
}

export type ActivityTaskStateFallback = {
  resourceCode: string | null;
  durationMinutes: 30 | 60 | 90 | null;
  date: string | null;
  time: string | null;
  partySize: number | null;
  asset: { name: string; assetCode: string } | null;
};

/**
 * The legacy LINE booking flow (this file) and the One-Mind conversational
 * layer (_deterministic-semantic-turn.ts / _dialog-manager.ts) are two
 * separate state stores for the SAME logical activity-booking conversation:
 * this file's own `booking_sessions` row, and guest_agent_state's
 * `taskState.activeTask`. A per-message routing gate
 * (shouldConsumeLegacyLineBookingTurn) decides, turn by turn, which one
 * handles a given message -- e.g. a bare "เอาภาราดรครับ" or "เอา 30 นาทีครับ"
 * (no literal "ขี่ม้า"/"ATV"/"ยิงธนู" keyword, no session-recognized phrasing)
 * is answered by One-Mind, while a date/time message that DOES match this
 * file's own parsers is picked up here instead. Because neither store ever
 * wrote to the other, a session existing here without ever having gone
 * through the asset/duration turns would forget them entirely the moment a
 * later message flipped control back to this file -- re-asking for duration
 * even though the customer already gave it, and even discarding which named
 * horse they picked. This reads the One-Mind task as a FALLBACK source (never
 * overriding a value this turn's own text or this file's own session already
 * has) so a slot collected by either system is never lost to the other.
 */
async function activityTaskStateFallback(guestDbId: string | null): Promise<ActivityTaskStateFallback | null> {
  if (!guestDbId) return null;
  try {
    const taskState = await loadTaskState(guestDbId);
    const task = taskState.activeTask;
    if (!task || task.type !== 'activity_booking' || isTerminalTaskStatus(task.status)) return null;
    const slots = task.slots;
    const durationRaw = Number(slots.durationMinutes);
    const durationMinutes = durationRaw === 30 || durationRaw === 60 || durationRaw === 90 ? (durationRaw as 30 | 60 | 90) : null;
    const horseName = typeof slots.horseName === 'string' ? slots.horseName : null;
    return {
      resourceCode: typeof slots.resourceCode === 'string' ? slots.resourceCode : null,
      durationMinutes,
      date: typeof slots.date === 'string' ? slots.date : null,
      time: typeof slots.time === 'string' ? slots.time : null,
      partySize: typeof slots.partySize === 'number' ? slots.partySize : null,
      asset: horseName ? activityAssetFromText(horseName) : null,
    };
  } catch (error) {
    console.error('ACTIVITY_TASK_STATE_FALLBACK_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return null;
  }
}

function activityTimeFromText(text: string): string | null {
  const m = text.match(/(?:^|\s)([01]?\d|2[0-3])[:.](\d{2})(?:\s*(?:น\.?|นาฬิกา|โมง))?/u);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

export type ResolvedActivitySlots = {
  resourceCode: string | null;
  durationMinutes: 30 | 60 | 90 | null;
  requestedDate: string | null;
  requestedTime: string | null;
  partySize: number | null;
  selectedAsset: { name: string; assetCode: string } | null;
};

/**
 * The precedence cascade at the heart of this bug's fix: for each activity
 * booking slot, what THIS message states wins; failing that, what this
 * file's own legacy session already tracked wins; only failing both does
 * the parallel One-Mind task's collected value get used. This ordering is
 * what makes "เปลี่ยนเป็น 60 นาที" (change duration text present -> wins)
 * and "เปลี่ยนเป็นทองไทย" (change asset text present -> wins, duration/date/
 * time untouched -> preserved from session/task-state) both work as
 * corrections without any special-cased correction-handling code: a
 * correction is just a turn whose own text supplies a new value for
 * exactly one slot, and every other slot naturally falls through to
 * whatever was already known. Pure and synchronous so it is fully testable
 * without a live session or a live One-Mind task.
 */
export function resolveActivitySlots(
  text: string,
  activitySession: LineBookingSession | null,
  taskFallback: ActivityTaskStateFallback | null,
): ResolvedActivitySlots {
  return {
    resourceCode: activityResourceFromText(text) ?? activitySession?.resource_code ?? taskFallback?.resourceCode ?? null,
    durationMinutes: activityDurationFromText(text) ?? activityDurationFromSession(activitySession) ?? taskFallback?.durationMinutes ?? null,
    requestedDate: activityDateFromText(text) ?? activitySession?.requested_date ?? taskFallback?.date ?? null,
    requestedTime: activityTimeFromText(text) ?? activitySession?.requested_time ?? taskFallback?.time ?? null,
    partySize: partySizeFromText(text) ?? activitySession?.party_size ?? taskFallback?.partySize ?? null,
    selectedAsset: activityAssetFromText(text) ?? activityAssetFromSession(activitySession) ?? taskFallback?.asset ?? null,
  };
}

function activityGuestNameFromText(text: string): string | null {
  const m = text.match(/(?:^|\s)ชื่อ\s*([^,\n]+?)(?=\s*(?:ติดต่อ|เบอร์|โทร|LINE|ไลน์|ครับ|ค่ะ|คะ|$))/iu);
  const value = m?.[1]?.trim().replace(/^(?:คุณ|นาย|นาง|นางสาว)\s*/u, '');
  return value ? value.slice(0, 120) : null;
}

function activityLabel(resourceCode: string): string {
  if (resourceCode === 'activity-atv') return 'ATV';
  if (resourceCode === 'activity-horse') return 'ขี่ม้า';
  return 'ยิงธนู';
}


function stayBookingStartIntent(text: string): boolean {
  return /(?:จอง|สำรอง).{0,12}(?:ที่พัก|ห้อง|เฮือนสเตย์)|(?:ที่พัก|ห้อง|เฮือนสเตย์).{0,12}(?:จอง|สำรอง)/u.test(text);
}

function activityBookingStartIntent(text: string): boolean {
  const activityKeyword = /(?:ATV|เอทีวี|ขี่ม้า|ยิงธนู)/iu;
  return (
    /(?:จอง|สำรอง).{0,24}(?:ATV|เอทีวี|ขี่ม้า|ยิงธนู)|(?:ATV|เอทีวี|ขี่ม้า|ยิงธนู).{0,24}(?:จอง|สำรอง)/iu.test(text)
    || (
      activityKeyword.test(text)
      && (
        /(?:อยาก|ขอ|จะ|ต้องการ|เล่น|เอา).{0,24}(?:ATV|เอทีวี|ขี่ม้า|ยิงธนู)|(?:ATV|เอทีวี|ขี่ม้า|ยิงธนู).{0,24}(?:ครึ่ง\s*ชั่วโมง|ชั่วโมง|30|60|90|\d{1,2}\s*(?:คน|ท่าน))/iu.test(text)
      )
    )
  );
}

function isReadOnlyBookingQuestion(text: string): boolean {
  return /[?？]|(?:อะไร|ไหน|ยังไง|อย่างไร|(?:^|\s)\S*ไง(?:\s|$)|เท่าไร|เท่าไหร่|กี่(?:บาท|ตัว|คัน|ชุด)?|ไหม|มั้ย|หรือเปล่า|รึเปล่า|ปะ(?:\s|$))/u.test(text);
}

function bookingResumeIntent(text: string): boolean {
  return /(?:กลับมา|ขอ|เอา).{0,16}(?:จอง|สำรอง).{0,16}ต่อ|(?:จอง|สำรอง).{0,16}ต่อ/u.test(text);
}

function lineOnlyContactIntent(text: string): boolean {
  return /(?:ติดต่อ|ใช้).{0,16}(?:LINE|ไลน์).{0,12}(?:นี้)?|(?:LINE|ไลน์)\s*นี้/iu.test(text);
}

function explicitSpecialRequestAnswer(text: string): boolean {
  if (/^(?:ไม่มี|ไม่มีครับ|ไม่มีค่ะ|ไม่ต้อง|ไม่เป็นไร|none|no|nope)$/iu.test(text)) return true;
  return /(?:ขอ|อยาก|ช่วย|เตรียม|ต้องการ).{0,24}(?:หมอน|เตียง|อาหาร|แพ้|เด็ก|ผู้สูงอายุ|รถเข็น|แม่บ้าน|วันเกิด|เค้ก|ดอกไม้)/u.test(text);
}

function sessionIsStale(session: LineBookingSession, now: Date): boolean {
  if (!session.updated_at) return false;
  const updatedAt = Date.parse(session.updated_at);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt >= CONTEXT_TTL_MS;
}

/** Legacy LINE booking is an operational compatibility layer, not a
 * conversational router. Only clearly booking-related turns are consumed;
 * everything else falls through to One-Mind. */
export function shouldConsumeLegacyLineBookingTurn(
  session: LineBookingSession | null,
  message: string,
  now: Date = new Date(),
): boolean {
  const text = message.trim();
  if (!text) return false;
  const stayStart = stayBookingStartIntent(text);
  const activityStart = activityBookingStartIntent(text);
  const resume = bookingResumeIntent(text);
  const readOnlyQuestion = isReadOnlyBookingQuestion(text);

  if (!session) return !readOnlyQuestion && (stayStart || activityStart);
  if (session.status === 'submitted') {
    return stayStart || activityStart || /(?:สถานะ|เรียบร้อย|เลข(?:ที่)?จอง|คำขอจอง)/u.test(text);
  }
  if (session.status === 'cancelled' || session.status === 'failed') {
    return !readOnlyQuestion && (stayStart || activityStart);
  }
  if (sessionIsStale(session, now) && !resume && !stayStart && !activityStart) return false;
  if (readOnlyQuestion && !resume) return false;

  if (session.service_type === 'activity') {
    const suppliesField = Boolean(
      activityDurationFromText(text)
      || activityDateFromText(text)
      || activityTimeFromText(text)
      || partySizeFromText(text)
      || activityGuestNameFromText(text)
      || phoneFromText(text)
      || lineOnlyContactIntent(text)
    );
    return resume || activityStart || suppliesField;
  }

  if (session.service_type === 'stay') {
    if (session.status === 'awaiting_phone') {
      return resume || stayStart || Boolean(phoneFromText(text)) || lineOnlyContactIntent(text);
    }
    if (session.status === 'awaiting_special_request') {
      return resume || stayStart || explicitSpecialRequestAnswer(text);
    }
    const checkIn = bookingDateFromText(text) ?? session.requested_date;
    const suppliesField = Boolean(
      bookingDateFromText(text)
      || checkoutDateFromText(text, checkIn)
      || contextualCheckoutDateFromText(text, checkIn)
      || partySizeFromText(text)
      || roomQuantityFromText(text)
      || phoneFromText(text)
      || /(?:^|\s)ชื่อ\s*[^,\n]+/u.test(text)
      || lineOnlyContactIntent(text)
    );
    return resume || stayStart || suppliesField;
  }

  return !readOnlyQuestion && (stayStart || activityStart || resume);
}

function thaiLocalTime(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** Deterministic LINE stay/activity booking flow. PII is encrypted in customer_accounts, never chat memory. */
export async function handleLineBookingMessage(anonymousId: string, rawLineUserId: string, message: string): Promise<string | null> {
  const identity = await registerLineContact(anonymousId, rawLineUserId);
  if (!identity) return null;
  const text = message.trim();
  const startIntent = stayBookingStartIntent(text);
  const initialContact = await lineBookingContact(identity.customerId);
  const environment: 'live' | 'test' = initialContact.isTest ? 'test' : 'live';
  let session = await loadLineBookingSession(identity.guestDbId);
  let lineOnlyContact = false;

  // If this turn does not clearly belong to the booking, let One-Mind answer it.
  if (!shouldConsumeLegacyLineBookingTurn(session, text)) return null;

  const activitySession = session?.service_type === 'activity' && session.status === 'collecting' ? session : null;
  const activityIntent = activityBookingStartIntent(text);
  if (activityIntent || (activitySession && !startIntent)) {
    // See activityTaskStateFallback's own doc comment: a slot this turn's
    // text and this session don't have may already have been collected by
    // the parallel One-Mind conversation (e.g. a named horse or a duration
    // given in a message that didn't match this file's own start/session
    // patterns) -- fetched once per turn, only once we know this IS an
    // activity turn, and only ever used as the last-resort fallback.
    const taskFallback = await activityTaskStateFallback(identity.guestDbId);
    const { resourceCode, durationMinutes, requestedDate, requestedTime, partySize, selectedAsset } =
      resolveActivitySlots(text, activitySession, taskFallback);
    const explicitName = activityGuestNameFromText(text);
    const bareNameAllowed = Boolean(resourceCode && durationMinutes && requestedDate && requestedTime && partySize);
    const suppliedName = explicitName ?? (bareNameAllowed ? primaryGuestNameFromText(text) : null);
    const suppliedPhone = phoneFromText(text);
    const lineOnly = lineOnlyContactIntent(text);

    const saveActivityProgress = async (): Promise<void> => {
      await saveLineBookingSession(identity.guestDbId, environment, {
        service_type: 'activity',
        resource_code: resourceCode,
        requested_date: requestedDate,
        requested_time: requestedTime,
        party_size: partySize,
        quantity: durationMinutes ?? activitySession?.quantity ?? 1,
        special_request: activitySessionMarker(durationMinutes, selectedAsset),
        status: 'collecting',
        booking_code: null,
      });
    };

    if (suppliedName || suppliedPhone) {
      await upsertCustomerAccount({
        guestDbId: identity.guestDbId,
        fullName: suppliedName,
        phone: suppliedPhone,
        preferredContact: 'line',
      });
    }
    const contact = await lineBookingContact(identity.customerId);
    await saveActivityProgress();
    if (!resourceCode) return 'ได้ครับ เลือกกิจกรรมก่อนนะครับ: ATV, ขี่ม้า หรือยิงธนู';
    if (!durationMinutes) return `รับกิจกรรม ${activityLabel(resourceCode)} แล้วครับ เลือกระยะเวลา 30, 60 หรือ 90 นาทีได้เลย`;
    if (!requestedDate) return 'ขอวันที่ต้องการเล่นครับ เช่น “พรุ่งนี้” หรือ “17/09”';
    if (!requestedTime) return 'ขอเวลาเริ่มครับ เช่น 10:00 น.';
    if (!partySize) return 'ขอจำนวนผู้เล่นทั้งหมดกี่ท่านครับ';
    if (!contact.fullName) return 'รายละเอียดกิจกรรมครบแล้วครับ ขอชื่อผู้ติดต่อหลัก 1 คนครับ';
    if (!contact.phone && !lineOnly) {
      return 'ขอเบอร์โทรสำรองสำหรับทีมงานครับ หรือถ้าสะดวกให้ติดต่อทาง LINE นี้อย่างเดียว พิมพ์ “ใช้ LINE นี้ได้เลย” พร้อมรายละเอียดการจองอีกครั้งได้ครับ';
    }

    try {
      const created = await createBooking({
        guestDbId: identity.guestDbId,
        channel: 'line',
        serviceType: 'activity',
        resourceCode,
        date: requestedDate,
        time: requestedTime,
        durationMinutes,
        partySize,
        quantity: 1,
        customerName: contact.fullName,
        phone: suppliedPhone ?? contact.phone,
        environment,
        // resourceCode only ever carries the ACTIVITY TYPE (e.g.
        // "activity-horse"), never which specific named asset the customer
        // picked mid-conversation -- without this, staff in Backoffice had
        // no durable record of which horse to actually prepare. The
        // trailing `[asset:<code>]` tag is a stable, machine-parseable
        // marker (see ACTIVITY_ASSET_NOTE_TAG below) that tamma-backoffice's
        // operations adapter reads back to place the booking against the
        // correct schedule cell -- the human-readable name in front is
        // unchanged so customer_note still reads naturally everywhere else
        // it's already displayed (booking cards, etc).
        note: selectedAsset ? formatActivityAssetNote(selectedAsset) : null,
      });
      await saveLineBookingSession(identity.guestDbId, environment, {
        service_type: 'activity',
        resource_code: resourceCode,
        requested_date: requestedDate,
        requested_time: requestedTime,
        party_size: partySize,
        quantity: 1,
        special_request: '',
        status: 'submitted',
        booking_code: created.bookingCode,
      });
      await dbFetch('guest_events', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          guest_id: identity.guestDbId,
          event_type: 'agent_action',
          intent: 'booking',
          metadata: { action: 'create_booking', bookingCode: created.bookingCode, channel: 'line', resourceCode, durationMinutes, selectedAssetCode: selectedAsset?.assetCode ?? null },
        }),
      });
      return `รับคำขอจองแล้วครับ ✅\nเลขที่คำขอ: ${created.bookingCode}\n${activityLabel(resourceCode)}${selectedAsset ? ` · ${selectedAsset.name}` : ''} · ${thaiShortDate(created.startAt)} เวลา ${thaiLocalTime(created.startAt)} น. · ${durationMinutes} นาที · ${partySize} ท่าน\nสถานะ: รอทีมงานยืนยันกลับทาง LINE นี้ครับ`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('no_matching_schedule') && !message.includes('schedule_full') && !message.includes('schedule_choice_required')) throw error;
      const options = await listBookingOptions('activity', requestedDate, environment, resourceCode, durationMinutes, partySize).catch(() => []);
      const nearest = options.slice(0, 5).map(option => thaiLocalTime(option.startAt)).join(', ');
      return nearest
        ? `ช่วง ${requestedTime} น. ยังจองไม่ได้ครับ รอบที่ยังรองรับ ${partySize} ท่านในวันเดียวกันมี ${nearest} น. ลองเลือกเวลาใหม่ได้เลยครับ`
        : `ขออภัยครับ ${activityLabel(resourceCode)} วันที่ ${thaiShortDate(requestedDate)} ยังไม่มีรอบที่รองรับ ${partySize} ท่านต่อเนื่อง ${durationMinutes} นาที กรุณาเลือกวันหรือเวลาอื่นครับ`;
    }
  }

  // Special requests are captured by Thongthai inside the booking flow and
  // stored on the booking itself. Empty string means the guest explicitly said none.
  if (session?.status === 'awaiting_special_request') {
    const noRequest = /^(?:ไม่มี|ไม่มีครับ|ไม่มีค่ะ|ไม่ต้อง|ไม่เป็นไร|none|no|nope)$/iu.test(text);
    const specialRequest = noRequest ? '' : text.replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!noRequest && !specialRequest) {
      return 'ถ้าไม่มีคำขอพิเศษ ตอบว่า “ไม่มี” ได้เลยครับ หรือบอกสิ่งที่อยากให้ทีมเตรียมไว้ได้เลย';
    }
    await saveLineBookingSession(identity.guestDbId, environment, {
      status: 'collecting',
      special_request: specialRequest,
    });
    session = { ...session, status: 'collecting', special_request: specialRequest };
  }

  // LINE is already a verified channel. If the customer does not want to
  // share a phone number, explicitly accepting LINE keeps the booking moving.
  if (session?.status === 'awaiting_phone') {
    const phone = phoneFromText(text);
    if (phone) {
      await upsertCustomerAccount({ guestDbId: identity.guestDbId, phone, preferredContact: 'line' });
    } else if (/(?:ใช้|ติดต่อ).{0,8}ไลน์|ไลน์นี้|ไม่สะดวก(?:แจ้ง|ให้).{0,8}(?:เบอร์|โทร)|ไม่มีเบอร์/u.test(text)) {
      lineOnlyContact = true;
    } else {
      return 'ขอเบอร์โทรสำรองสำหรับทีมงานด้วยครับ หรือถ้าสะดวกให้ติดต่อทาง LINE นี้อย่างเดียว ตอบว่า “ใช้ LINE นี้ได้เลย” ครับ';
    }
    await saveLineBookingSession(identity.guestDbId, environment, { status: 'collecting' });
    session = { ...session, status: 'collecting' };
  }

  if (session?.status === 'submitted') {
    if (/(?:สถานะ|เรียบร้อย|เลข(?:ที่)?จอง|คำขอจอง)/u.test(text)) {
      return await bookingStatusReply(session.booking_code)
        ?? `รับคำขอจองไว้แล้วครับ ✅\nเลขที่คำขอ: ${session.booking_code}\nสถานะ: รอทีมงานตรวจสอบและยืนยันกลับทาง LINE นี้ครับ`;
    }
    if (!startIntent) return null;
    session = null;
  }
  if (!session && !startIntent) return null;

  if (!session) {
    session = {
      service_type: 'stay', resource_code: null, requested_date: null, requested_time: null,
      end_date: null, party_size: null, quantity: 1, special_request: null, status: 'collecting', booking_code: null,
    };
  }
  let requestedDate = bookingDateFromText(text) ?? session.requested_date;
  let endDate = checkoutDateFromText(text, requestedDate) ?? session.end_date;
  let partySize = partySizeFromText(text) ?? session.party_size;
  let quantity = roomQuantityFromText(text) ?? session.quantity ?? 1;

  // Fast parsing handles common messages. When anything remains unresolved,
  // Thongthai's language model interprets the turn instead of trapping the
  // customer in a brittle keyword loop. A state-aware local fallback remains
  // available if both model providers are temporarily unavailable.
  if (!requestedDate || !endDate || !partySize) {
    try {
      const understood = await interpretStayBookingTurn(text, {
        checkInDate: requestedDate,
        checkOutDate: endDate,
        partySize,
        roomQuantity: quantity,
      });
      requestedDate ??= understood.checkInDate;
      endDate ??= understood.checkOutDate;
      partySize ??= understood.partySize;
      if (!roomQuantityFromText(text) && understood.roomQuantity) quantity = understood.roomQuantity;
    } catch (error) {
      console.error('LINE_BOOKING_NLU_FALLBACK', error instanceof Error ? error.message.slice(0, 180) : 'unknown');
    }
  }
  endDate ??= contextualCheckoutDateFromText(text, requestedDate);
  await saveLineBookingSession(identity.guestDbId, environment, {
    service_type: 'stay', requested_date: requestedDate, end_date: endDate,
    party_size: partySize, quantity, status: 'collecting', booking_code: null,
  });

  if (!requestedDate) return 'ได้ครับ ขอวันเช็กอิน วันเช็กเอาต์ และจำนวนผู้เข้าพักครับ เช่น “เช็กอิน 30/09 เช็กเอาต์ 02/10 พัก 2 คน”';
  if (!endDate && !partySize) return `รับวันเช็กอิน ${thaiShortDate(requestedDate)} แล้วครับ ขอวันเช็กเอาต์และจำนวนผู้เข้าพักด้วยครับ`;
  if (!endDate) return `รับจำนวนผู้เข้าพักแล้วครับ ขอวันเช็กเอาต์อีกอย่างเดียวครับ`;
  if (!partySize) return 'ขอจำนวนผู้เข้าพักทั้งหมดกี่ท่านครับ';

  const suppliedName = primaryGuestNameFromText(text);
  const suppliedPhone = phoneFromText(text);
  if (suppliedName || suppliedPhone) {
    await upsertCustomerAccount({
      guestDbId: identity.guestDbId,
      fullName: suppliedName,
      phone: suppliedPhone,
      preferredContact: 'line',
    });
  }
  const contact = await lineBookingContact(identity.customerId);
  if (!contact.fullName) {
    return 'ข้อมูลวันพักครบแล้วครับ ขอชื่อผู้ติดต่อหลักเพียง 1 คนครับ ไม่ต้องแจ้งชื่อผู้เข้าพักทุกท่าน ทีมงานจะตอบกลับทาง LINE นี้';
  }
  if (!contact.phone && !lineOnlyContact) {
    await saveLineBookingSession(identity.guestDbId, environment, { status: 'awaiting_phone' });
    return 'ขอบคุณครับ ขอเบอร์โทรสำรองสำหรับทีมงานอีกนิดครับ (ถ้าสะดวกให้ติดต่อทาง LINE นี้อย่างเดียว ตอบว่า “ใช้ LINE นี้ได้เลย” ได้ครับ)';
  }

  if (session.special_request === null) {
    await saveLineBookingSession(identity.guestDbId, environment, { status: 'awaiting_special_request' });
    return 'ก่อนส่งคำขอจอง มีอะไรอยากให้ทองไทยแจ้งทีมเตรียมไว้เป็นพิเศษไหมครับ เช่น หมอนเพิ่ม เด็ก/ผู้สูงอายุ การเข้าถึง อาหาร/อาการแพ้ วันพิเศษ เวลาเข้าถึง หรือความต้องการเรื่องแม่บ้าน ถ้าไม่มีตอบว่า “ไม่มี” ได้เลยครับ';
  }
  const specialRequest = session.special_request.trim() || null;

  let created: { bookingCode: string; status: string; startAt: string; endAt: string };
  try {
    created = await createBooking({
      guestDbId: identity.guestDbId, channel: 'line', serviceType: 'stay',
      date: requestedDate, endDate, partySize, quantity,
      customerName: contact.fullName, phone: suppliedPhone ?? contact.phone,
      note: specialRequest,
      environment,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('schedule_full')) {
      const nearest = await findNearestStayAvailability(requestedDate, endDate, quantity, environment, 30);
      if (nearest) {
        await saveLineBookingSession(identity.guestDbId, environment, {
          requested_date: nearest.date,
          end_date: nearest.endDate,
          party_size: partySize,
          quantity,
          status: 'collecting',
          booking_code: null,
        });
        return `ขออภัยครับ ช่วง ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)} ห้องเต็มแล้วครับ ❌\nวันที่ใกล้สุดที่ยังมีห้องพอคือ ${thaiShortDate(nearest.date)} – ${thaiShortDate(nearest.endDate)} (${nearest.available} หลังว่าง)\n\nถ้าต้องการช่วงนี้ ตอบว่า “จองวันที่นี้” ได้เลยครับ`;
      }
      return `ขออภัยครับ ช่วง ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)} ห้องเต็มแล้วครับ ❌ และยังไม่พบช่วงที่มีห้องพอใน 30 วันถัดไป กรุณาเลือกวันอื่นครับ`;
    }
    if (!(error instanceof Error) || !error.message.includes('no_matching_schedule')) throw error;
    created = await createUnscheduledStayRequest({
      guestDbId: identity.guestDbId, customerId: identity.customerId,
      date: requestedDate, endDate, partySize, quantity,
      environment, specialRequest,
    });
  }
  await saveLineBookingSession(identity.guestDbId, environment, { status: 'submitted', booking_code: created.bookingCode });
  await dbFetch('guest_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: identity.guestDbId, event_type: 'agent_action', intent: 'booking',
      metadata: { action: 'create_booking', bookingCode: created.bookingCode, channel: 'line' },
    }),
  });
  const requestLine = specialRequest ? `\nคำขอพิเศษ: ${specialRequest}\nทีมงานจะตรวจสอบคำขอนี้พร้อมการจองครับ` : '';
  return `รับคำขอจองแล้วครับ ✅\nเลขที่คำขอ: ${created.bookingCode}\nเฮือนสเตย์ · ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)}\n${partySize} ท่าน · ${quantity} ห้อง${requestLine}\n\nสถานะ: รอทีมงานตรวจสอบห้องว่างและยืนยันกลับทาง LINE นี้ ลูกค้าไม่ต้องทักตามครับ\nหมายเหตุ: ยังไม่ถือว่ายืนยันการจองหรือคำขอพิเศษจนกว่าจะได้รับข้อความยืนยันจากทีมงาน`;
}

export interface BookingOption {
  scheduleId: string;
  scheduleIds?: string[];
  resourceCode: string;
  resourceName: string;
  serviceType: ServiceType;
  startAt: string;
  endAt: string;
  available: number;
  durationMinutes?: number;
}

function dayBounds(date: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    start: `${date}T00:00:00+07:00`,
    end: `${date}T23:59:59+07:00`,
  };
}

function normalizeActivityDuration(value: number | null | undefined): 30 | 60 | 90 {
  const n = Number(value);
  return n === 60 ? 60 : n === 90 ? 90 : 30;
}

export async function listBookingOptions(
  serviceType: ServiceType,
  date: string,
  environment: 'live' | 'test' = 'live',
  resourceCode?: string | null,
  durationMinutes?: number | null,
  partySize?: number | null,
): Promise<BookingOption[]> {
  const bounds = dayBounds(date);
  if (!bounds) return [];
  const resourcesRes = await dbFetch(
    `service_resources?service_type=eq.${serviceType}&active=eq.true`
    + (resourceCode ? `&code=eq.${encodeURIComponent(resourceCode)}` : '')
    + '&select=id,code,name,metadata',
  );
  const resources = await resourcesRes.json() as Array<{ id: string; code: string; name: string; metadata: Record<string, unknown> }>;
  const output: BookingOption[] = [];
  const requestedUnits = Math.max(1, Math.min(50, Math.floor(partySize ?? 1)));
  const activityDuration = normalizeActivityDuration(durationMinutes);
  const windowSize = activityDuration / 30;

  for (const resource of resources) {
    const res = await dbFetch(
      `service_schedules?resource_id=eq.${resource.id}&environment=eq.${environment}&status=eq.open`
      + `&start_at=gte.${encodeURIComponent(bounds.start)}&start_at=lte.${encodeURIComponent(bounds.end)}`
      + '&select=id,start_at,end_at,capacity_total,capacity_reserved&order=start_at.asc',
    );
    const rows = await res.json() as Array<{ id: string; start_at: string; end_at: string; capacity_total: number; capacity_reserved: number }>;

    if (serviceType !== 'activity') {
      for (const row of rows) {
        output.push({
          scheduleId: row.id,
          resourceCode: resource.code,
          resourceName: resource.name,
          serviceType,
          startAt: row.start_at,
          endAt: row.end_at,
          available: Math.max(0, Number(row.capacity_total) - Number(row.capacity_reserved)),
        });
      }
      continue;
    }

    for (let i = 0; i + windowSize <= rows.length; i += 1) {
      const window = rows.slice(i, i + windowSize);
      let contiguous = true;
      for (let j = 1; j < window.length; j += 1) {
        if (new Date(window[j].start_at).getTime() !== new Date(window[j - 1].end_at).getTime()) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      const available = Math.min(...window.map(row => Math.max(0, Number(row.capacity_total) - Number(row.capacity_reserved))));
      if (available < requestedUnits) continue;
      output.push({
        scheduleId: window[0].id,
        scheduleIds: window.map(row => row.id),
        resourceCode: resource.code,
        resourceName: resource.name,
        serviceType,
        startAt: window[0].start_at,
        endAt: window[window.length - 1].end_at,
        available,
        durationMinutes: activityDuration,
      });
    }
  }
  return output;
}

export interface ServiceResourceSnapshot {
  code: string;
  name: string;
  description: string | null;
  unitLabel: string | null;
  defaultCapacity: number | null;
  requiresSchedule: boolean;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

/** Canonical read-only resource listing used by the One-Mind knowledge
 * adapters. This deliberately lives next to listBookingOptions/createBooking
 * so service-resource truth has one data-access owner. */
export async function listServiceResources(serviceType: ServiceType): Promise<ServiceResourceSnapshot[]> {
  const res = await dbFetch(
    `service_resources?service_type=eq.${serviceType}&active=eq.true`
    + '&select=code,name,description,unit_label,default_capacity,requires_schedule,metadata,updated_at&order=name.asc',
  );
  const rows = await res.json() as Array<{
    code: string; name: string; description: string | null; unit_label: string | null;
    default_capacity: number | null; requires_schedule: boolean; metadata: Record<string, unknown>; updated_at: string;
  }>;
  return rows.map(row => ({
    code: row.code,
    name: row.name,
    description: row.description,
    unitLabel: row.unit_label,
    defaultCapacity: row.default_capacity == null ? null : Number(row.default_capacity),
    requiresSchedule: Boolean(row.requires_schedule),
    metadata: row.metadata ?? {},
    updatedAt: row.updated_at,
  }));
}

export interface BookingStatusSnapshot {
  bookingCode: string;
  serviceType: ServiceType;
  startAt: string;
  endAt: string;
  partySize: number | null;
  quantity: number | null;
  status: string;
  contactStatus: string | null;
  updatedAt: string;
}

/** Read-only operational booking status. The caller must already hold the
 * canonical guest DB id; an optional booking code narrows the lookup without
 * ever exposing another guest's booking. */
export async function loadLatestBookingStatus(
  guestDbId: string | null,
  bookingCode?: string | null,
): Promise<BookingStatusSnapshot | null> {
  if (!guestDbId || !UUID_RE.test(guestDbId)) return null;
  const res = await dbFetch(
    `bookings?guest_id=eq.${encodeURIComponent(guestDbId)}`
    + (bookingCode ? `&booking_code=eq.${encodeURIComponent(bookingCode)}` : '')
    + '&select=booking_code,service_type,start_at,end_at,party_size,quantity,status,contact_status,updated_at'
    + '&order=created_at.desc&limit=1',
  );
  const rows = await res.json() as Array<{
    booking_code: string; service_type: ServiceType; start_at: string; end_at: string;
    party_size: number | null; quantity: number | null; status: string; contact_status: string | null; updated_at: string;
  }>;
  const row = rows[0];
  return row ? {
    bookingCode: row.booking_code,
    serviceType: row.service_type,
    startAt: row.start_at,
    endAt: row.end_at,
    partySize: row.party_size == null ? null : Number(row.party_size),
    quantity: row.quantity == null ? null : Number(row.quantity),
    status: row.status,
    contactStatus: row.contact_status,
    updatedAt: row.updated_at,
  } : null;
}

export interface MembershipStatusSnapshot {
  memberStatus: 'lead' | 'member' | 'inactive';
  membershipStartedAt: string | null;
  profileCompletedAt: string | null;
  marketingOptIn: boolean;
  researchOptIn: boolean;
}

/** Read-only membership status for the canonical guest. No encrypted/raw
 * contact fields are selected, so the knowledge layer never receives PII. */
export async function loadMembershipStatus(guestDbId: string | null): Promise<MembershipStatusSnapshot | null> {
  if (!guestDbId || !UUID_RE.test(guestDbId)) return null;
  const res = await dbFetch(
    `customer_accounts?guest_id=eq.${encodeURIComponent(guestDbId)}`
    + '&select=member_status,membership_started_at,profile_completed_at,marketing_opt_in,research_opt_in&limit=1',
  );
  const rows = await res.json() as Array<{
    member_status: 'lead' | 'member' | 'inactive'; membership_started_at: string | null;
    profile_completed_at: string | null; marketing_opt_in: boolean; research_opt_in: boolean;
  }>;
  const row = rows[0];
  return row ? {
    memberStatus: row.member_status,
    membershipStartedAt: row.membership_started_at,
    profileCompletedAt: row.profile_completed_at,
    marketingOptIn: Boolean(row.marketing_opt_in),
    researchOptIn: Boolean(row.research_opt_in),
  } : null;
}

async function scheduleRowsForBooking(args: {
  serviceType: ServiceType;
  resourceCode?: string;
  date: string;
  time?: string | null;
  endDate?: string | null;
  durationMinutes?: number | null;
  partySize?: number | null;
  environment: 'live' | 'test';
}): Promise<BookingOption[]> {
  const resourcesRes = await dbFetch(
    `service_resources?service_type=eq.${args.serviceType}&active=eq.true`
    + (args.resourceCode ? `&code=eq.${encodeURIComponent(args.resourceCode)}` : '')
    + '&select=id,code,name&limit=8',
  );
  const resources = await resourcesRes.json() as Array<{ id: string; code: string; name: string }>;
  if (!resources.length) return [];

  if (args.serviceType !== 'stay') {
    let options = await listBookingOptions(
      args.serviceType,
      args.date,
      args.environment,
      args.resourceCode ?? null,
      args.serviceType === 'activity' ? args.durationMinutes ?? null : null,
      args.partySize ?? null,
    );
    if (args.resourceCode) options = options.filter(item => item.resourceCode === args.resourceCode);
    if (args.time && /^\d{2}:\d{2}$/.test(args.time)) {
      options = options.filter(item => {
        const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.startAt));
        return local === args.time;
      });
    }
    return options;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || !args.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) return [];
  const checkIn = new Date(`${args.date}T00:00:00+07:00`);
  const checkOut = new Date(`${args.endDate}T00:00:00+07:00`);
  if (!(checkOut > checkIn)) return [];
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
  if (nights < 1 || nights > 30) return [];
  const resource = resources[0];
  const endBound = `${args.endDate}T23:59:59+07:00`;
  const res = await dbFetch(
    `service_schedules?resource_id=eq.${resource.id}&environment=eq.${args.environment}&status=eq.open`
    + `&start_at=gte.${encodeURIComponent(`${args.date}T00:00:00+07:00`)}`
    + `&start_at=lt.${encodeURIComponent(endBound)}`
    + '&select=id,start_at,end_at,capacity_total,capacity_reserved&order=start_at.asc',
  );
  const rows = await res.json() as Array<{ id: string; start_at: string; end_at: string; capacity_total: number; capacity_reserved: number }>;
  const picked = rows.slice(0, nights).map(row => ({
    scheduleId: row.id,
    resourceCode: resource.code,
    resourceName: resource.name,
    serviceType: args.serviceType,
    startAt: row.start_at,
    endAt: row.end_at,
    available: Math.max(0, Number(row.capacity_total) - Number(row.capacity_reserved)),
  }));
  return picked.length === nights ? picked : [];
}

function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findNearestStayAvailability(
  date: string,
  endDate: string,
  quantity: number,
  environment: 'live' | 'test',
  maxDays = 30,
): Promise<{ date: string; endDate: string; available: number } | null> {
  const nights = Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000);
  if (nights < 1) return null;
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const candidateDate = shiftIsoDate(date, offset);
    const candidateEnd = shiftIsoDate(endDate, offset);
    const options = await scheduleRowsForBooking({
      serviceType: 'stay',
      date: candidateDate,
      endDate: candidateEnd,
      environment,
    });
    if (options.length !== nights) continue;
    const available = Math.min(...options.map(option => option.available));
    if (available >= quantity) return { date: candidateDate, endDate: candidateEnd, available };
  }
  return null;
}

export interface CreateBookingInput {
  guestDbId?: string | null;
  channel: OpsChannel;
  serviceType: ServiceType;
  resourceCode?: string | null;
  date: string;
  time?: string | null;
  endDate?: string | null;
  durationMinutes?: number | null;
  partySize?: number | null;
  quantity?: number | null;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  environment?: 'live' | 'test';
}

export async function createBooking(input: CreateBookingInput): Promise<{ bookingCode: string; status: string; startAt: string; endAt: string }> {
  const environment = input.environment ?? 'live';
  if (input.serviceType === 'activity') {
    if (!input.resourceCode) throw new Error('activity_resource_required');
    if (![30, 60, 90].includes(Number(input.durationMinutes))) throw new Error('activity_duration_required');
  }
  const options = await scheduleRowsForBooking({
    serviceType: input.serviceType,
    resourceCode: input.resourceCode ?? undefined,
    date: input.date,
    time: input.time,
    endDate: input.endDate,
    durationMinutes: input.durationMinutes,
    partySize: input.partySize,
    environment,
  });
  if (!options.length) throw new Error('no_matching_schedule');
  if (input.serviceType !== 'stay' && options.length !== 1) throw new Error('schedule_choice_required');

  const units = input.serviceType === 'stay'
    ? Math.max(1, Math.min(6, Math.floor(input.quantity ?? 1)))
    : Math.max(1, Math.min(50, Math.floor(input.partySize ?? 1)));
  if (options.some(option => option.available < units)) throw new Error('schedule_full');

  const customerId = await upsertCustomerAccount({
    guestDbId: input.guestDbId,
    fullName: input.customerName,
    email: input.email,
    phone: input.phone,
    preferredContact: input.phone ? 'phone' : input.email ? 'email' : null,
    isTest: environment === 'test',
  });
  const resourceRes = await dbFetch(`service_resources?code=eq.${encodeURIComponent(options[0].resourceCode)}&select=id&limit=1`);
  const resourceRows = await resourceRes.json() as Array<{ id: string }>;
  if (!resourceRows[0]?.id) throw new Error('resource_not_found');
  const startAt = options[0].startAt;
  const endAt = input.serviceType === 'activity' ? options[0].endAt : options[options.length - 1].endAt;

  // `bookings` has no idempotency_key column (unlike restaurant_preorders'
  // create_restaurant_preorder_v2 RPC, which genuinely is safe to retry).
  // The LINE webhook layer's askThongthaiReliably() retries once on ANY
  // failure -- including one thrown by something AFTER a booking write
  // already succeeded (e.g. the guest_agent_state CAS write) -- and
  // deterministic committed-booking turns (thongthai-chat.ts's
  // executeDeterministicActivityBooking) call this with no caller-side
  // session guard at all. Without this check, that retry would silently
  // create a second real booking for the identical slot. A guest booking
  // the exact same resource at the exact same start time again within two
  // minutes is effectively always the same request replayed, never a
  // genuinely distinct new booking -- so treat it as one, the same way a
  // real idempotency key would.
  if (input.guestDbId) {
    const recentWindowStart = new Date(Date.now() - 120_000).toISOString();
    const dupRes = await dbFetch(
      `bookings?guest_id=eq.${input.guestDbId}&resource_id=eq.${resourceRows[0].id}&start_at=eq.${encodeURIComponent(startAt)}`
      + `&status=neq.cancelled&created_at=gte.${encodeURIComponent(recentWindowStart)}`
      + '&select=booking_code,status,start_at,end_at&order=created_at.desc&limit=1',
    );
    const existing = (await dupRes.json() as Array<{ booking_code: string; status: string; start_at: string; end_at: string }>)[0];
    if (existing) return { bookingCode: existing.booking_code, status: existing.status, startAt: existing.start_at, endAt: existing.end_at };
  }

  const bookingRes = await dbFetch('bookings', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      customer_id: customerId,
      guest_id: input.guestDbId ?? null,
      service_type: input.serviceType,
      resource_id: resourceRows[0].id,
      start_at: startAt,
      end_at: endAt,
      party_size: input.partySize ?? null,
      quantity: input.quantity ?? 1,
      status: 'requested',
      source_channel: input.channel,
      customer_note: input.note?.slice(0, 1000) ?? null,
      booking_customer_name_enc: encryptPii(input.customerName),
      booking_phone_enc: encryptPii(cleanPhone(input.phone)),
      booking_email_enc: encryptPii(cleanEmail(input.email)),
      environment,
    }),
  });
  const bookings = await bookingRes.json() as Array<{ id: string; booking_code: string; status: string }>;
  const booking = bookings[0];
  if (!booking) throw new Error('booking_not_created');
  try {
    const allocationScheduleIds = input.serviceType === 'activity'
      ? (options[0].scheduleIds?.length ? options[0].scheduleIds : [options[0].scheduleId])
      : options.map(option => option.scheduleId);
    await dbFetch('booking_allocations', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(allocationScheduleIds.map(scheduleId => ({
        booking_id: booking.id,
        schedule_id: scheduleId,
        capacity_units: units,
      }))),
    });
  } catch (error) {
    await dbFetch(`bookings?id=eq.${booking.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
  return { bookingCode: booking.booking_code, status: booking.status, startAt, endAt };
}

export async function createCafeInquiry(input: {
  guestDbId?: string | null;
  channel: OpsChannel;
  question: string;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  environment?: 'live' | 'test';
}): Promise<{ inquiryCode: string }> {
  const customerId = await upsertCustomerAccount({
    guestDbId: input.guestDbId,
    fullName: input.customerName,
    phone: input.phone,
    email: input.email,
    preferredContact: input.phone ? 'phone' : input.email ? 'email' : null,
    isTest: input.environment === 'test',
  });
  const res = await dbFetch('cafe_inquiries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      customer_id: customerId,
      guest_id: input.guestDbId ?? null,
      question: input.question.trim().slice(0, 2000),
      source_channel: input.channel,
      environment: input.environment ?? 'live',
    }),
  });
  const rows = await res.json() as Array<{ inquiry_code: string }>;
  if (!rows[0]?.inquiry_code) throw new Error('inquiry_not_created');
  return { inquiryCode: rows[0].inquiry_code };
}

export interface OrderableProduct { sku: string; name: string; description: string | null; price: number; stock: number }
export async function listOtopProducts(environment: 'live' | 'test' = 'live'): Promise<OrderableProduct[]> {
  const res = await dbFetch(
    `otop_products?environment=eq.${environment}&active=eq.true&verified=eq.true&stock_qty=gt.0`
    + '&select=sku,name,description,price,stock_qty&order=name.asc',
  );
  const rows = await res.json() as Array<{ sku: string; name: string; description: string | null; price: number; stock_qty: number }>;
  return rows.map(row => ({ sku: row.sku, name: row.name, description: row.description, price: Number(row.price), stock: Number(row.stock_qty) }));
}

export async function createOtopOrder(input: {
  guestDbId?: string | null;
  channel: OpsChannel;
  sku: string;
  quantity: number;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  fulfillmentType?: 'pickup' | 'shipping';
  shippingAddress?: string | null;
  note?: string | null;
  environment?: 'live' | 'test';
}): Promise<{ orderCode: string; total: number }> {
  const environment = input.environment ?? 'live';
  const productRes = await dbFetch(
    `otop_products?sku=eq.${encodeURIComponent(input.sku)}&environment=eq.${environment}&active=eq.true&verified=eq.true&select=id,price,stock_qty&limit=1`,
  );
  const products = await productRes.json() as Array<{ id: string; price: number; stock_qty: number }>;
  const product = products[0];
  if (!product) throw new Error('product_not_available');
  const quantity = Math.max(1, Math.min(99, Math.floor(input.quantity || 1)));
  if (product.stock_qty < quantity) throw new Error('insufficient_stock');
  const customerId = await upsertCustomerAccount({
    guestDbId: input.guestDbId,
    fullName: input.customerName,
    phone: input.phone,
    email: input.email,
    preferredContact: input.phone ? 'phone' : input.email ? 'email' : null,
    isTest: environment === 'test',
  });
  const total = Number(product.price) * quantity;
  const orderRes = await dbFetch('otop_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      customer_id: customerId,
      guest_id: input.guestDbId ?? null,
      source_channel: input.channel,
      fulfillment_type: input.fulfillmentType ?? 'pickup',
      shipping_address_enc: input.shippingAddress ? encryptPii(input.shippingAddress) : null,
      customer_note: input.note?.slice(0, 1000) ?? null,
      total_amount: total,
      environment,
    }),
  });
  const orders = await orderRes.json() as Array<{ id: string; order_code: string }>;
  const order = orders[0];
  if (!order) throw new Error('order_not_created');
  try {
    await dbFetch('otop_order_items', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ order_id: order.id, product_id: product.id, quantity, unit_price: product.price }),
    });
    await dbFetch(`otop_products?id=eq.${product.id}&stock_qty=eq.${product.stock_qty}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stock_qty: product.stock_qty - quantity }),
    });
  } catch (error) {
    await dbFetch(`otop_orders?id=eq.${order.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
  return { orderCode: order.order_code, total };
}

export async function authUserFromBearer(authHeader: string | undefined): Promise<{ id: string; email: string | null } | null> {
  const c = config();
  if (!c || !authHeader?.startsWith('Bearer ')) return null;
  const res = await fetch(`${c.url}/auth/v1/user`, {
    headers: { apikey: c.key, Authorization: authHeader },
  });
  if (!res.ok) return null;
  const user = await res.json() as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}

export async function loadCustomerPortal(authUserId: string): Promise<Record<string, unknown> | null> {
  const accountRes = await dbFetch(
    `customer_accounts?auth_user_id=eq.${encodeURIComponent(authUserId)}`
    + '&select=id,guest_id,full_name_enc,email_enc,phone_enc,preferred_contact,marketing_opt_in,research_opt_in,birth_date,gender,gender_self_description,member_status,membership_started_at,profile_completed_at,created_at&limit=1',
  );
  const accounts = await accountRes.json() as Array<Record<string, unknown>>;
  const account = accounts[0];
  if (!account?.id) return null;
  const [bookingRes, orderRes, inquiryRes] = await Promise.all([
    dbFetch(`bookings?customer_id=eq.${account.id}&select=booking_code,service_type,start_at,end_at,party_size,quantity,status,contact_status,created_at&order=created_at.desc&limit=50`),
    dbFetch(`otop_orders?customer_id=eq.${account.id}&select=order_code,status,total_amount,fulfillment_type,contact_status,created_at&order=created_at.desc&limit=50`),
    dbFetch(`cafe_inquiries?customer_id=eq.${account.id}&select=inquiry_code,question,status,response_note,created_at&order=created_at.desc&limit=50`),
  ]);
  return {
    id: account.id,
    guestId: account.guest_id,
    fullName: decryptPii(account.full_name_enc as string | null),
    email: decryptPii(account.email_enc as string | null),
    phone: decryptPii(account.phone_enc as string | null),
    preferredContact: account.preferred_contact,
    marketingOptIn: account.marketing_opt_in,
    researchOptIn: account.research_opt_in,
    birthDate: account.birth_date,
    gender: account.gender,
    genderSelfDescription: account.gender_self_description,
    memberStatus: account.member_status,
    membershipStartedAt: account.membership_started_at,
    profileCompleted: Boolean(account.profile_completed_at),
    createdAt: account.created_at,
    bookings: await bookingRes.json(),
    orders: await orderRes.json(),
    inquiries: await inquiryRes.json(),
  };
}
