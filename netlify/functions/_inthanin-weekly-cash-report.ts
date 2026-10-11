// Weekly reporting is read-only. Missing evidence is never converted to a verified zero.
export const RETAINED_FLOAT = 2000;
export type CashClose = {
  id: string; branch_id: string; local_date: string; environment: string; status: string;
  net_sales: number|string|null; payment_cash: number|string|null;
  cash_drawer_outflow_amount: number|string|null;
  cash_opening_float: number|string|null; cash_counted_closing: number|string|null;
  operational_metrics?: Record<string,unknown>; source?: string; confirmed_at?: string|null;
};
export type CashMovement = {
  local_date: string; movement_type: string; direction: string; amount: number|string;
  created_at: string;
};
export type CashBag = {bag_balance: number|string|null; last_movement_at: string|null};
export type CashInput = {branchId:string; localDate:string; asOf:string; closes:CashClose[]; movements:CashMovement[]; bag:CashBag|null};
export type CashRow = {date:string; sales:number|null; receipts:number|null; expenses:number|null;
  pickup:number|null; count:number|null; variance:number|null; status:'missing'|'draft'|'confirmed'; opening:number|null};
export function amount(value:unknown):number|null {
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
const thaiTimestampDate=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const money=(value:number|null)=>value===null?'—':value.toLocaleString('th-TH',{maximumFractionDigits:2});
function shift(date:string,days:number):string{return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function weeklyWindow(localDate:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate)||new Date(localDate+'T00:00:00Z').getUTCDay()!==0||new Date(localDate+'T00:00:00Z').toISOString().slice(0,10)!==localDate)throw new Error('Sunday report date required');
  return {start:shift(localDate,-6),end:localDate,dates:Array.from({length:7},(_,i)=>shift(localDate,i-6))};
}
function hasReport(close:CashClose):boolean {
  // An automatically created draft with default zeros is not a zero-sales report.
  return close.status==='confirmed'||Boolean(close.operational_metrics?.last_line_text_message_id)
    ||[close.net_sales,close.payment_cash].some(v=>(amount(v)??0)!==0);
}
export function buildWeeklyCashReport(input:CashInput){
  const window=weeklyWindow(input.localDate);
  const scoped=input.closes.filter(c=>c.branch_id===input.branchId&&c.environment==='live'&&window.dates.includes(c.local_date));
  if(new Set(scoped.map(c=>c.local_date)).size!==scoped.length)throw new Error('Duplicate daily close');
  const rows:CashRow[]=window.dates.map(date=>{
    const close=scoped.find(c=>c.local_date===date&&['draft','submitted','confirmed'].includes(c.status)),reported=close&&hasReport(close);
    const pickups=input.movements.filter(m=>m.local_date===date&&m.movement_type==='owner_pickup');
    return {date,sales:reported?amount(close.net_sales):null,receipts:reported?amount(close.payment_cash):null,
      expenses:reported?amount(close.cash_drawer_outflow_amount):close&&(amount(close.cash_drawer_outflow_amount)??0)!==0?amount(close.cash_drawer_outflow_amount):null,
      pickup:pickups.length?pickups.reduce((s,m)=>s+(amount(m.amount)??0),0):null,
      count:close?amount(close.cash_counted_closing):null,
      variance:close&&[close.cash_counted_closing,close.cash_opening_float,close.payment_cash,close.cash_drawer_outflow_amount].every(v=>amount(v)!==null)
        ?Math.round((amount(close.cash_counted_closing)!-amount(close.cash_opening_float)!-amount(close.payment_cash)!+amount(close.cash_drawer_outflow_amount)!)*100)/100:null,
      status:!reported?'missing':close.status==='confirmed'?'confirmed':'draft',
      opening:close?amount(close.cash_opening_float):null};
  });
  const sum=(key:'sales'|'receipts'|'expenses'|'pickup')=>rows.some(r=>r[key]!==null)?rows.reduce((s,r)=>s+(r[key]??0),0):null;
  const reported=rows.filter(r=>r.status!=='missing').length;
  const confirmed=rows.filter(r=>r.status==='confirmed').length;
  const totals={sales:sum('sales'),receipts:sum('receipts'),expenses:sum('expenses'),pickup:sum('pickup')};
  const cashRows=rows.filter(r=>r.receipts!==null&&r.expenses!==null);
  const cashGenerated=cashRows.length?cashRows.reduce((s,r)=>s+r.receipts!-r.expenses!,0):null;
  const latestCount=[...rows].reverse().find(r=>r.count!==null);
  const notes=[`รายงานยอด ${reported}/7 วัน · ยืนยันปิด ${confirmed}/7 วัน`,
    rows.some(r=>r.status==='missing')?'ขาดยอดรายวัน: '+rows.filter(r=>r.status==='missing').map(r=>r.date.slice(8)).join(', '):'',
    rows.some(r=>r.status==='draft')?'D = DRAFT ยังไม่ยืนยันปิดวัน':'',
    `— = ไม่มีข้อมูลยืนยัน (ไม่ใช่ 0)`,
    'ส่วนต่าง = นับลิ้นชัก − (เงินตั้งต้น + สดรับ − สดจ่าย) ตามระบบตรวจปิดวัน',
  ].filter(Boolean);
  // A closing drawer count is not a complete physical count of the drawer + collection bag.
  // Neither missing owner-pickup records nor the ledger bag balance prove cash is still on site.
  // Therefore do not manufacture a collectible amount from this incomplete custody model.
  const collectionText='ยอดเจ้าของรับ: ยังยืนยันไม่ได้';
  const opening=rows[0].opening;
  const bag=amount(input.bag?.bag_balance);
  const summary=[`เงินสดเกิดจากยอดที่รายงาน ${cashRows.length} วัน: ${money(cashGenerated)} บาท`,
    `เงินสดต้นสัปดาห์ (ลิ้นชัก): ${money(opening)} บาท`,
    `เก็บแล้วที่พบรายการ: ${totals.pickup!==null?money(totals.pickup)+' บาท':'ไม่พบรายการยืนยัน'}`,
    `ถุงเงินตามบัญชี: ${money(bag)} บาท${input.bag?.last_movement_at?' · เคลื่อนไหวล่าสุด '+thaiTimestampDate(input.bag.last_movement_at):''}`,
    latestCount?`นับลิ้นชักล่าสุด ${latestCount.date}: ${money(latestCount.count)} บาท`:'ยังไม่มีเงินสดนับจริงในสัปดาห์',
    `เงินทอนที่ต้องเหลือ: ${money(RETAINED_FLOAT)} บาท`,
    collectionText,
    'ต้องนับเงินคงอยู่จริงรวมถุง และยืนยันยอดเก็บไปแล้วก่อนสรุปยอดรับ',
    'ยอดเงินสดเกิดใหม่ไม่รวมเงินตั้งต้น จึงไม่หักเงินทอนซ้ำ',
  ];
  const text=[`อินทนิลตาดโตน · ${window.start} ถึง ${window.end}`,
    `ข้อมูล ณ ${input.asOf} · Asia/Bangkok`,
    'วัน | ขาย | สดรับ | สดจ่าย | สถานะ',
    ...rows.map(r=>`${r.date.slice(5)} | ${money(r.sales)} | ${money(r.receipts)} | ${money(r.expenses)} | ${r.status}`),
    `รวมที่รายงาน | ${money(totals.sales)} | ${money(totals.receipts)} | ${money(totals.expenses)}`,
    'วัน | เจ้าของเก็บ* | นับลิ้นชัก | ส่วนต่าง',
    ...rows.map(r=>`${r.date.slice(5)} | ${money(r.pickup)} | ${money(r.count)} | ${money(r.variance)}`),
    ...summary,...notes].join('\n');
  return {window,rows,totals,cashGenerated,cashCoveredDays:cashRows.length,reported,confirmed,collectionAmount:null,collectionText,summary,notes,text};
}
export type WeeklyReport=ReturnType<typeof buildWeeklyCashReport>;
const cell=(text:string,flex=1,bold=false,color='#18251D')=>({type:'text',text,flex,size:'xs',weight:bold?'bold':'regular',color,align:'end',wrap:true});
const row=(values:string[],header=false)=>({type:'box',layout:'horizontal',spacing:'sm',paddingAll:'sm',backgroundColor:header?'#E8F2EB':'#FFFFFF',contents:values.map((v,i)=>cell(v,i===0?1:2,header))});
const label=(text:string,bold=false)=>({type:'text',text,size:'xs',wrap:true,weight:bold?'bold':'regular',color:'#34453A'});
export function weeklyCashFlex(report:WeeklyReport,asOf:string):Record<string,unknown>{
  const title=(text:string)=>({type:'box',layout:'vertical',backgroundColor:'#155B3C',paddingAll:'md',contents:[{type:'text',text,weight:'bold',size:'md',color:'#FFFFFF',wrap:true},{type:'text',text:`${report.window.start} – ${report.window.end}`,size:'xs',color:'#FFFFFF',wrap:true}]});
  const footer=(lines:string[])=>({type:'box',layout:'vertical',paddingAll:'md',spacing:'sm',contents:lines.map(t=>label(t))});
  return {type:'carousel',contents:[
    {type:'bubble',size:'giga',header:title('อินทนิลตาดโตน · ยอดรายวัน'),body:{type:'box',layout:'vertical',contents:[
      row(['วัน','ยอดขาย','สดรับ','สดจ่าย','ปิด'],true),
      ...report.rows.map(r=>row([r.date.slice(8),money(r.sales),money(r.receipts),money(r.expenses),r.status==='confirmed'?'✓':r.status==='draft'?'D':'—'])),
      row(['รวม',money(report.totals.sales),money(report.totals.receipts),money(report.totals.expenses),`${report.confirmed}/7`],true),
      label('บาท · รวมเฉพาะข้อมูลที่รายงาน'),
    ]},footer:footer([report.summary[0],...report.notes.slice(0,3),`ข้อมูล ณ ${asOf} (เวลาไทย)`])},
    {type:'bubble',size:'giga',header:title('เงินสดคงเหลือ · เจ้าของรับ'),body:{type:'box',layout:'vertical',contents:[
      row(['วัน','เก็บแล้ว*','นับจริง','ส่วนต่าง'],true),
      ...report.rows.map(r=>row([r.date.slice(8),money(r.pickup),money(r.count),money(r.variance)])),
      label('บาท · นับจริงคือลิ้นชัก ไม่รวมถุงเงิน'),
      label('— ไม่มีหลักฐานยืนยัน ไม่ใช่ศูนย์'),
    ]},footer:footer([...report.summary.slice(1,7),'* เก็บแล้วเฉพาะรายการที่บันทึก',report.summary[7],report.summary[8]])},
  ]};
}
