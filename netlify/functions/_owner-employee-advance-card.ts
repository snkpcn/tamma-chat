import type { LineMessage } from './_ops-line-ui';

export type AdvanceEmployee = {
  employee_id: string; employee_key: string; employee_label?: string; label?: string;
  full_name: string; nickname?: string | null; business_unit_code: string | null;
  role_label?: string | null; month_paid_advance?: number | string;
};
export type AdvanceProposal = {
  kind: 'employee_advance'; event_type: 'unknown' | 'salary_advance';
  employee_query: string; employee_id: string | null; business_unit_code: string | null;
  funding_source: string; amount: number | null; occurred_on: string | null;
  purpose: string; questions: string[]; monthly_sum_before: number | null;
  employee?: AdvanceEmployee | null;
};
export type AdvanceCardInput = {
  id: string; revision: number; proposal: AdvanceProposal;
  employee?: AdvanceEmployee | null; candidates?: AdvanceEmployee[];
  state?: 'draft' | 'confirmed' | 'cancelled'; monthlySum?: number | null;
  duplicate?: boolean; error?: string; view?: 'employee' | 'funding'; page?: number;
};

export const ADVANCE_PREFIX = 'owner-advance:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS = ['employee', 'salary', 'funding', 'show_employee', 'show_funding', 'review', 'page', 'confirm', 'cancel', 'later'] as const;
type AdvanceAction = {id: string; revision: number; action: typeof ACTIONS[number]; value?: string};
const SOURCES: Record<string, string> = {unknown:'ยังไม่ระบุ',business_account:'บัญชีกิจการ',owner_personal:'เงินส่วนตัวเจ้าของ',cash:'เงินสด',other:'แหล่งอื่น'};
const BUSINESSES: Record<string, string> = {inthanin:'Inthanin',tamma_restaurant:'ตำมา-ชาติ',huenstay:'เฮือนสเตย์',adventure:'ผจญภัย',otop:'OTOP',shared_infrastructure:'ส่วนกลาง / โครงสร้างพื้นฐาน',shared:'ส่วนกลาง / ใช้ร่วม'};
export const advanceMoney = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? value.toLocaleString('th-TH', {minimumFractionDigits:0,maximumFractionDigits:2}) + ' บาท' : 'รอตรวจยอด';
export const advanceEmployeeName = (employee: AdvanceEmployee): string => employee.nickname && employee.nickname !== employee.full_name
  ? employee.full_name + ' (' + employee.nickname + ')' : employee.full_name || employee.employee_label || employee.label || 'ยังไม่ระบุพนักงาน';

function validAction(value: unknown): value is AdvanceAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  if (Object.keys(a).some(key => !['id','revision','action','value'].includes(key))
    || typeof a.id !== 'string' || !UUID.test(a.id) || !Number.isSafeInteger(a.revision)
    || Number(a.revision) < 0 || Object.is(a.revision, -0) || !ACTIONS.includes(a.action as any)) return false;
  if (a.action === 'employee') return typeof a.value === 'string' && UUID.test(a.value);
  if (a.action === 'funding') return typeof a.value === 'string' && Object.hasOwn(SOURCES, a.value);
  if (a.action === 'page') return typeof a.value === 'string' && /^(?:0|[1-9]\d{0,2})$/.test(a.value);
  return a.value === undefined;
}
export function encodeAdvanceAction(action: AdvanceAction): string {
  if (!validAction(action)) throw new TypeError('invalid_employee_advance_action');
  const result = ADVANCE_PREFIX + JSON.stringify({id:action.id,revision:action.revision,action:action.action,...(action.value === undefined ? {} : {value:action.value})});
  if (Buffer.byteLength(result, 'utf8') > 300) throw new RangeError('employee_advance_action_too_long');
  return result;
}
export function decodeAdvanceAction(data: unknown): AdvanceAction | null {
  if (typeof data !== 'string' || !data.startsWith(ADVANCE_PREFIX) || Buffer.byteLength(data, 'utf8') > 300) return null;
  try { const result = JSON.parse(data.slice(ADVANCE_PREFIX.length)); return validAction(result) && encodeAdvanceAction(result) === data ? result : null; }
  catch { return null; }
}

const short = (value: string, limit: number) => Array.from(value).length > limit ? Array.from(value).slice(0, limit - 1).join('') + '…' : value;
const txt = (text: string, extra: Record<string,unknown> = {}) => ({type:'text',text:short(text || '—',500),wrap:true,size:'sm',color:'#20352B',...extra});
const row = (label: string, value: string, strong = false) => ({type:'box',layout:'vertical',spacing:'xs',contents:[txt(label,{size:'xs',color:'#69796F'}),txt(value,strong?{weight:'bold',size:'lg'}:{})]});

/** Pure LINE card: a projection is never reused as the saved monthly total. */
export function buildOwnerEmployeeAdvanceCard(input: AdvanceCardInput): LineMessage {
  const {proposal:p,employee} = input;
  const state = input.state ?? 'draft';
  const ready = state === 'draft' && p.event_type === 'salary_advance' && !!employee && p.employee_id === employee.employee_id
    && !!p.business_unit_code && !!p.occurred_on && typeof p.amount === 'number' && p.amount > 0 && Number.isFinite(p.amount)
    && typeof p.monthly_sum_before === 'number' && Number.isFinite(p.monthly_sum_before) && !p.questions.length;
  const month = p.occurred_on?.slice(0,7) ?? 'รอตรวจวันที่';
  const buttons: Record<string,unknown>[] = [];
  const button = (label: string, action: AdvanceAction['action'], value?: string, primary = false) => buttons.push({
    type:'button',height:'sm',style:primary?'primary':'secondary',...(primary?{color:'#35654D'}:{}),
    action:{type:'postback',label:short(label,40),data:encodeAdvanceAction({id:input.id,revision:input.revision,action,...(value === undefined?{}:{value})})},
  });
  let question = input.error || p.questions[0] || '';
  if (state === 'draft') {
    if (input.view === 'funding') {
      question = 'เงินที่ใช้เบิกมาจากไหนครับ?';
      for (const [value,label] of Object.entries(SOURCES)) button(label,'funding',value);
      button('กลับไปสรุป','review');
    } else if (!employee || input.view === 'employee') {
      question ||= 'เลือกพนักงานที่มีอยู่ในระบบครับ';
      const candidates = input.candidates ?? [];
      const page = Math.max(0,Math.min(Math.floor(input.page ?? 0),Math.max(0,Math.ceil(candidates.length / 5)-1)));
      for (const candidate of candidates.slice(page*5,page*5+5)) button(advanceEmployeeName(candidate)+' · '+(BUSINESSES[candidate.business_unit_code??'']??candidate.business_unit_code??'รอส่วนงาน'),'employee',candidate.employee_id);
      if (page > 0) button('ก่อนหน้า','page',String(page-1));
      if ((page+1)*5<candidates.length) button('พนักงานอื่น','page',String(page+1));
      if (!candidates.length) question = 'ยังไม่พบพนักงานที่ผูกไว้กับกลุ่มนี้ครับ กรุณาตรวจชื่อและข้อมูลพนักงานในหลังบ้าน';
      if (input.view) button('กลับไปสรุป','review');
    } else if (p.event_type === 'unknown') {
      question = 'รายการนี้เป็นเบิกเงินเดือนล่วงหน้าใช่ไหมครับ?';
      button('เบิกเงินเดือนล่วงหน้า','salary');
    } else if (ready) {
      question = 'ตรวจชื่อ ส่วนงาน และยอด แล้วกดยืนยันบันทึกครับ';
      button('ยืนยันบันทึก','confirm',undefined,true);
      button('เปลี่ยนพนักงาน','show_employee');
      button('ระบุแหล่งเงิน','show_funding');
    }
    button('ไว้ก่อน','later');
    button('ยกเลิกรายการ','cancel');
  }
  if(state==='draft'&&!p.occurred_on)question='วันที่จ่ายในสลิปอ่านไม่ชัดครับ ส่งสลิปที่เห็นวันที่ชัดเจน แล้วตอบกลับรูปว่า “ตรวจสลิป”';
  else if(state==='draft'&&(p.amount===null||!Number.isFinite(p.amount)||p.amount<=0))question='ยอดเงินในสลิปอ่านไม่ชัดครับ ส่งสลิปที่เห็นยอดชัดเจน แล้วตอบกลับรูปว่า “ตรวจสลิป”';
  if(input.error)question=input.error;
  const title = state === 'confirmed' ? (input.duplicate?'รายการนี้บันทึกแล้ว':'บันทึกเงินเบิกแล้ว') : state === 'cancelled' ? 'ยกเลิกการตรวจรายการ' : 'ตรวจเงินเบิกพนักงาน';
  const contents: Record<string,unknown>[] = [txt(title,{weight:'bold',size:'xl'}),txt(state === 'draft'?'รอเจ้าของยืนยัน · ยังไม่บันทึกยอด':'ข้อมูลเงินเบิกส่วน Owner',{size:'xs',color:'#69796F'}),
    row('พนักงาน',employee?advanceEmployeeName(employee):p.employee_query||'รอเลือกพนักงาน'),
    row('กิจการ / ส่วนงาน',BUSINESSES[p.business_unit_code??'']??p.business_unit_code??'รอตรวจส่วนงาน'),
    row('ตำแหน่ง / แผนก',employee?.role_label||'ยังไม่ระบุในระบบ'),
    row('ประเภท',p.event_type==='salary_advance'?'เบิกเงินเดือนล่วงหน้า':'รอระบุประเภทการเบิก'),
    row('วันที่จ่าย / เดือนสะสม',(p.occurred_on??'รอตรวจวันที่')+' / '+month),
    row('แหล่งเงิน',SOURCES[p.funding_source]??'ยังไม่ระบุ'),{type:'separator',margin:'md'},
  ];
  if (state === 'confirmed') {
    contents.push(row('เบิกครั้งนี้',advanceMoney(p.amount)),row('ยอดเบิกสะสม '+month+' ที่บันทึกจริง',advanceMoney(input.monthlySum),true));
    if (input.monthlySum === null || input.monthlySum === undefined) contents.push(txt('ยังอ่านยอดสะสมจากฐานข้อมูลไม่ได้ กรุณาตรวจยอดอีกครั้ง',{color:'#9C472F'}));
  } else {
    const projected = typeof p.monthly_sum_before === 'number' && Number.isFinite(p.monthly_sum_before) && typeof p.amount === 'number' && Number.isFinite(p.amount)
      ? Math.round((p.monthly_sum_before+p.amount)*100)/100 : null;
    contents.push(row('ยอดสะสมที่บันทึกแล้ว · '+month,advanceMoney(p.monthly_sum_before)),row('เบิกครั้งนี้',advanceMoney(p.amount)),row('ยอดสะสมหลังยืนยัน (คาดการณ์)',advanceMoney(projected),true));
  }
  if (question && state === 'draft') contents.push(txt(question,{weight:'bold',color:input.error?'#9C472F':'#35654D'}));
  if (state === 'draft' && p.event_type === 'unknown') contents.push(txt('หากเป็นเบิกไปซื้อของ ให้พิมพ์รายละเอียดก่อน ยังไม่รวมเป็นเงินเดือนล่วงหน้า',{size:'xs',color:'#69796F'}));
  contents.push(txt('ยอดสะสมนับเงินเบิกที่จ่ายแล้วในเดือนตามวันที่จ่าย ไม่ใช่เงินเดือนสุทธิ',{size:'xs',color:'#69796F'}));
  contents.push(txt('#'+input.id.replace(/-/g,'').slice(0,6).toUpperCase()+' · ฉบับ '+input.revision,{size:'xxs',color:'#69796F'}));
  const result: LineMessage = {type:'flex',altText:short(title+' · '+(employee?advanceEmployeeName(employee):p.employee_query||'พนักงาน')+' · '+advanceMoney(p.amount),400),
    contents:{type:'bubble',size:'mega',body:{type:'box',layout:'vertical',spacing:'md',contents},...(buttons.length?{footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}}:{})}};
  if (Buffer.byteLength(JSON.stringify(result),'utf8') > 29000) throw new RangeError('employee_advance_card_too_large');
  return result;
}
