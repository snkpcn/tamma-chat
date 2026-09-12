import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

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

export interface BookingOption {
  scheduleId: string;
  resourceCode: string;
  resourceName: string;
  serviceType: ServiceType;
  startAt: string;
  endAt: string;
  available: number;
}

function dayBounds(date: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    start: `${date}T00:00:00+07:00`,
    end: `${date}T23:59:59+07:00`,
  };
}

export async function listBookingOptions(
  serviceType: ServiceType,
  date: string,
  environment: 'live' | 'test' = 'live',
): Promise<BookingOption[]> {
  const bounds = dayBounds(date);
  if (!bounds) return [];
  const resourcesRes = await dbFetch(
    `service_resources?service_type=eq.${serviceType}&active=eq.true&select=id,code,name`,
  );
  const resources = await resourcesRes.json() as Array<{ id: string; code: string; name: string }>;
  const output: BookingOption[] = [];
  for (const resource of resources) {
    const res = await dbFetch(
      `service_schedules?resource_id=eq.${resource.id}&environment=eq.${environment}&status=eq.open`
      + `&start_at=gte.${encodeURIComponent(bounds.start)}&start_at=lte.${encodeURIComponent(bounds.end)}`
      + '&select=id,start_at,end_at,capacity_total,capacity_reserved&order=start_at.asc',
    );
    const rows = await res.json() as Array<{ id: string; start_at: string; end_at: string; capacity_total: number; capacity_reserved: number }>;
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
  }
  return output;
}

async function scheduleRowsForBooking(args: {
  serviceType: ServiceType;
  resourceCode?: string;
  date: string;
  time?: string | null;
  endDate?: string | null;
  environment: 'live' | 'test';
}): Promise<BookingOption[]> {
  const resourcesRes = await dbFetch(
    `service_resources?service_type=eq.${args.serviceType}&active=eq.true`
    + (args.resourceCode ? `&code=eq.${encodeURIComponent(args.resourceCode)}` : '')
    + '&select=id,code,name&limit=5',
  );
  const resources = await resourcesRes.json() as Array<{ id: string; code: string; name: string }>;
  if (!resources.length) return [];

  if (args.serviceType !== 'stay') {
    let options = await listBookingOptions(args.serviceType, args.date, args.environment);
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

export interface CreateBookingInput {
  guestDbId?: string | null;
  channel: OpsChannel;
  serviceType: ServiceType;
  resourceCode?: string | null;
  date: string;
  time?: string | null;
  endDate?: string | null;
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
  const options = await scheduleRowsForBooking({
    serviceType: input.serviceType,
    resourceCode: input.resourceCode ?? undefined,
    date: input.date,
    time: input.time,
    endDate: input.endDate,
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
  const endAt = options[options.length - 1].endAt;

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
      environment,
    }),
  });
  const bookings = await bookingRes.json() as Array<{ id: string; booking_code: string; status: string }>;
  const booking = bookings[0];
  if (!booking) throw new Error('booking_not_created');
  try {
    await dbFetch('booking_allocations', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(options.map(option => ({
        booking_id: booking.id,
        schedule_id: option.scheduleId,
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
