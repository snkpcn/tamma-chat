import type { BrainRequest, BrainChannel } from './_thongthai-brain-v3';
import { extractDate, extractPartySize, hasCommitMarker, hasStandaloneTransactionRequest, hasCancelMarker } from './_slot-parsers';
import { formatCustomerDate } from './_customer-date';
import { applyConversationContextUpdate, conversationContextFromAgentState, CONTEXT_TTL_MS, CONVERSATION_RESET_RE } from './_conversation-context';
import { readGuestAgentStateSnapshot, loadGuestAgentStateSnapshot, compareAndSwapGuestAgentState } from './_guest-agent-state-store';
import { parseTaskState, suspendActiveTask } from './_task-state';

type StayInquiry = { date:string|null; partySize:number|null; nights:number|null; updatedAt:string };
export type StayInquiryResult = { message:string; canonicalMessage?:never } | { canonicalMessage:string; message?:never };
const BARE_STAY = /^(?:อยาก(?:เข้า)?พัก|อยากค้างคืน|ต้องการที่พัก|หาที่พัก)(?:\s*(?:ครับ|ค่ะ|คะ))?[\s.!ๆ]*$/u;
const STAY_DETAILS = /(?:อยาก(?:เข้า)?พัก|เข้าพัก|พักวัน|พักพรุ่งนี้|พักวันนี้|พักคืนนี้|ค้างคืน|ที่พัก|ห้องพัก)/u;
const OTHER_TOPIC = /ร้านอาหาร|เมนู|อาหาร|กิน|ทาน|คาเฟ่|กาแฟ|เครื่องดื่ม|ของฝาก|โอทอป|OTOP|ขี่ม้า|ยิงธนู|เอทีวี|ATV|โปรโมชัน|โปรโมชั่น/iu;
const ACK = /^(?:ใช่(?:ครับ|ค่ะ)?|จ้ะ|จ้า|ครับ|ค่ะ|โอเค|ตกลง)[\s.!ๆ]*$/u;
const THAI_NUMBERS:Record<string,number> = {หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6,เจ็ด:7,แปด:8,เก้า:9,สิบ:10};
for (const [word, value] of Object.entries({...THAI_NUMBERS})) {
  if (value < 10) {
    THAI_NUMBERS[`สิบ${value === 1 ? 'เอ็ด' : word}`] = 10 + value;
    THAI_NUMBERS[`ยี่สิบ${value === 1 ? 'เอ็ด' : word}`] = 20 + value;
  }
}
THAI_NUMBERS.ยี่สิบ = 20;
THAI_NUMBERS.สามสิบ = 30;
const NIGHT_COUNT = new RegExp(`(${Object.keys(THAI_NUMBERS).sort((a,b) => b.length-a.length).join('|')}|\\d+)\\s*คืน`, 'u');

function nightsFrom(text:string, awaitingNights:boolean):number|null {
  const match = text.match(NIGHT_COUNT);
  if (match && /(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่)$/u.test(text.slice(0, match.index))) return null;
  const token = match?.[1]
    ?? (awaitingNights ? text.match(/^(\d{1,2})(?:\s*(?:ครับ|ค่ะ))?$/u)?.[1] : undefined);
  const value = token ? THAI_NUMBERS[token] ?? Number(token) : NaN;
  return Number.isInteger(value) && value > 0 && value <= 30 ? value : null;
}

/** A read-only continuation of the date/party/nights question we produced.
 * It never checks availability, starts a booking task, or interprets consent.
 * Bounded structured answers must not fall back into an unrelated old topic. */
export async function continueStayInquiry(request:BrainRequest, guestDbId:string|null,
  channel:BrainChannel, eventId:string, now = new Date()):Promise<StayInquiryResult|null> {
  const text = request.message.trim();
  if (request.language !== 'th' || !guestDbId || OTHER_TOPIC.test(text)
      || hasCommitMarker(text) || hasStandaloneTransactionRequest(text) || hasCancelMarker(text)
      || CONVERSATION_RESET_RE.test(text)
      || /ไหม|มั้ย|หรือ|อะไร|ที่ไหน|ทำไม|กี่โมง|ฝน|อากาศ|\?/u.test(text)) return null;
  const opening = BARE_STAY.test(text);
  const date = extractDate(text, now);
  const partySize = extractPartySize(text);
  // Also recover a clearly labelled date/party declaration after an older
  // deployment failed to record its own stay question. Questions and actual
  // transaction requests retain their established knowledge/execution paths.
  const explicitDetails = STAY_DETAILS.test(text) && Boolean(date || partySize || nightsFrom(text, false))
    && !/ไหม|มั้ย|หรือ|ราคา|ว่าง|\?/u.test(text);
  if (!opening && !explicitDetails && !date && !partySize && nightsFrom(text, true) === null && !ACK.test(text)) return null;

  let snapshot = await readGuestAgentStateSnapshot(guestDbId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const context = conversationContextFromAgentState(snapshot.state, now);
    const ownsQuestion = context.activeDomain === 'stay' && context.openQuestion?.startsWith('stay_details:');
    if (!opening && !explicitDetails && !ownsQuestion) return null;
    const raw = snapshot.state.stayInquiry as Partial<StayInquiry>|undefined;
    const previous = context.activeDomain === 'stay' && raw
      && typeof raw.updatedAt === 'string' && now.getTime() - Date.parse(raw.updatedAt) < CONTEXT_TTL_MS ? raw : null;
    const nights = nightsFrom(text, context.openQuestion === 'stay_details:nights');
    const inquiry:StayInquiry = {
      date:date ?? previous?.date ?? null,
      partySize:partySize ?? previous?.partySize ?? null,
      nights:nights ?? previous?.nights ?? null,
      updatedAt:now.toISOString(),
    };
    const missing = [!inquiry.date?'date':null, !inquiry.partySize?'party':null, !inquiry.nights?'nights':null]
      .filter((value):value is string => value !== null);
    const known = [inquiry.date ? `เข้าพักวันที่ ${formatCustomerDate(inquiry.date, 'th')}` : '',
      inquiry.partySize ? `สำหรับ ${inquiry.partySize} คน` : '', inquiry.nights ? `${inquiry.nights} คืน` : ''].filter(Boolean).join(' ');
    const question = missing.length === 1 && missing[0] === 'nights'
      ? (ACK.test(text) ? 'ขอจำนวนคืนที่จะพักด้วยครับ เช่น 1 คืน หรือ 2 คืน' : 'ต้องการพักกี่คืนครับ?')
      : `${missing.map(field => field === 'date' ? 'เข้าพักวันไหน' : field === 'party' ? 'มากี่คน' : 'ต้องการพักกี่คืน').join(' และ ')}ครับ?`;
    const message = missing.length ? `${known ? `${known} รับไว้แล้วครับ ` : ''}${question}` : null;
    const nextContext = applyConversationContextUpdate(context, {
      eventId,channel,userMessage:request.customerMessage ?? text,assistantMessage:message ?? undefined,
      activeDomain:'stay',activeTopic:'stay',openQuestion:missing.length ? `stay_details:${missing.join(',')}` : null,
      lastAction:'provide_information',
    }, now);
    const taskState = parseTaskState(snapshot.state.taskState);
    const pauseOtherTask = opening || explicitDetails;
    const set:Record<string,unknown> = {stayInquiry:inquiry,conversationContext:nextContext,active_topic:'stay'};
    if (pauseOtherTask && taskState.activeTask?.domain !== 'stay'
        && ['collecting','ready'].includes(taskState.activeTask?.status ?? '')) {
      set.taskState = suspendActiveTask(taskState, now);
    }
    const written = await compareAndSwapGuestAgentState(guestDbId, snapshot, {set,
      removeKeys:pauseOtherTask ? ['pending_question'] : []}, now);
    if (written.status === 'applied') {
      if (message) return {message};
      // Supply normalized customer-provided details to the existing read-only
      // knowledge pipeline. Never imply that a room was checked or booked.
      return {canonicalMessage:`ขอข้อมูลที่พัก เข้าพัก ${inquiry.date} จำนวน ${inquiry.partySize} คน ${inquiry.nights} คืน ยังไม่จอง`};
    }
    if (written.status === 'unconfigured') return null;
    snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  }
  throw new Error('stay_inquiry_state_conflict_exhausted');
}
