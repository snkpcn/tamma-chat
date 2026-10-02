export type InthaninExpenseFunding =
  | 'company_cash'
  | 'employee_fronted'
  | 'owner_transfer'
  | 'vendor_transfer'
  | 'unknown';

export type InthaninExpenseCategory =
  | 'ingredients'
  | 'beverages'
  | 'packaging'
  | 'consumables'
  | 'cleaning'
  | 'maintenance'
  | 'utilities'
  | 'transport'
  | 'staff'
  | 'equipment'
  | 'marketing'
  | 'fees'
  | 'petty_cash'
  | 'other';

export type ParsedInthaninExpense = {
  label: string;
  amount: number;
  category: InthaninExpenseCategory;
  funding: InthaninExpenseFunding;
};

export type ParsedBenefit = {
  count: number;
  amount: number;
};

export type ParsedInthaninDailyClose = {
  matched: boolean;
  localDate: string | null;
  reportedPosNetSales: number | null;
  discounts: number;
  refunds: number;
  grossSales: number | null;
  paymentCash: number;
  paymentQrKplus: number;
  paymentQrManual: number;
  paymentKrungsri: number;
  paymentOtherNamed: number;
  paymentQr: number;
  paymentCard: number;
  paymentDelivery: number;
  paymentOther: number;
  benefits: Record<string, ParsedBenefit>;
  expenses: ParsedInthaninExpense[];
  cupCount: number | null;
  billCount: number | null;
  cashOpeningFloat: number | null;
  cashCountedClosing: number | null;
  notes: string | null;
  legacyCashDeduction: number | null;
  warnings: string[];
  missingCritical: string[];
};

const THAI_DIGITS: Record<string,string> = {
  '๐':'0','๑':'1','๒':'2','๓':'3','๔':'4',
  '๕':'5','๖':'6','๗':'7','๘':'8','๙':'9',
};

function normalizeDigits(value:string):string{
  return value.replace(/[๐-๙]/g, digit => THAI_DIGITS[digit] ?? digit);
}

function normalizeLine(value:string):string{
  return normalizeDigits(value)
    .replace(/[＝]/g,'=')
    .replace(/[–—]/g,'-')
    .replace(/\u00a0/g,' ')
    .trim();
}

function amountTokens(value:string):number[]{
  const normalized=normalizeDigits(value);
  const matches=normalized.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map(raw=>Number(raw.replace(/,/g,'')))
    .filter(value=>Number.isFinite(value));
}

function firstAmountAfterEquals(line:string):number|null{
  const value=line.includes('=') ? line.slice(line.indexOf('=')+1) : line;
  return amountTokens(value)[0] ?? null;
}

function parseCountAndAmount(line:string):ParsedBenefit{
  const normalized=normalizeLine(line);
  const countMatch=normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:ครั้ง|สิทธิ|แก้ว)/iu);
  const bahtMatch=normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿)/iu);
  const all=amountTokens(normalized.includes('=') ? normalized.slice(normalized.indexOf('=')+1) : normalized);
  return {
    count: countMatch ? Number(countMatch[1].replace(/,/g,'')) : (all[0] ?? 0),
    amount: bahtMatch ? Number(bahtMatch[1].replace(/,/g,'')) : 0,
  };
}

function parseThaiYear(yearRaw:number):number{
  if(yearRaw >= 2400) return yearRaw - 543;
  if(yearRaw >= 2000) return yearRaw;
  if(yearRaw >= 50) return 1957 + yearRaw;
  return 2000 + yearRaw;
}

export function parseInthaninDate(value:string):string|null{
  const normalized=normalizeDigits(value);
  const match=normalized.match(/(?:^|\s)(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{2,4})(?:\s|$)/);
  if(!match) return null;
  const day=Number(match[1]),month=Number(match[2]),year=parseThaiYear(Number(match[3]));
  if(!Number.isInteger(day)||!Number.isInteger(month)||month<1||month>12||day<1||day>31) return null;
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return null;
  return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}

function findLine(lines:string[],patterns:RegExp[],exclude:RegExp[]=[]):string|null{
  return lines.find(line=>patterns.some(pattern=>pattern.test(line))&&!exclude.some(pattern=>pattern.test(line))) ?? null;
}

function amountFromLine(lines:string[],patterns:RegExp[],exclude:RegExp[]=[]):number|null{
  for(const line of lines){
    if(!patterns.some(pattern=>pattern.test(line)))continue;
    if(exclude.some(pattern=>pattern.test(line)))continue;
    const amount=firstAmountAfterEquals(line);
    if(amount!==null)return amount;
  }
  return null;
}

function expenseCategory(label:string):InthaninExpenseCategory{
  const value=label.toLowerCase();
  if(/นม|กาแฟ|เมล็ด|ไซรัป|ผง|วัตถุดิบ|น้ำแข็ง/u.test(value)) return 'ingredients';
  if(/น้ำดื่ม|น้ำถัง|โซดา|เครื่องดื่ม/u.test(value)) return 'beverages';
  if(/แก้ว|ฝา|หลอด|ถุง|กล่อง|แพ็ก|pack/u.test(value)) return 'packaging';
  if(/ทิชชู่|กระดาษ|ของใช้สิ้นเปลือง/u.test(value)) return 'consumables';
  if(/น้ำยา|ล้าง|ทำความสะอาด|ไม้กวาด|ถุงขยะ/u.test(value)) return 'cleaning';
  if(/ซ่อม|ช่าง|อะไหล่/u.test(value)) return 'maintenance';
  if(/ค่าไฟ|ไฟฟ้า|ค่าน้ำ|น้ำประปา|อินเทอร์เน็ต|โทรศัพท์/u.test(value)) return 'utilities';
  if(/น้ำมัน|ค่าส่ง|ขนส่ง|รถ|เดินทาง/u.test(value)) return 'transport';
  if(/ค่าแรง|พนักงาน|โอที|OT\b/iu.test(value)) return 'staff';
  if(/เครื่อง|อุปกรณ์|เฟอร์นิเจอร์/u.test(value)) return 'equipment';
  if(/โฆษณา|ยิงแอด|ads?|marketing/u.test(value)) return 'marketing';
  if(/ค่าธรรมเนียม|fee|commission/u.test(value)) return 'fees';
  if(/เงินสดย่อย|petty/u.test(value)) return 'petty_cash';
  return 'other';
}

function expenseFunding(line:string):InthaninExpenseFunding{
  if(/พนักงาน.*(?:ออก|สำรอง)|ออกก่อน|สำรอง(?:เงิน)?ก่อน/u.test(line)) return 'employee_fronted';
  if(/เจ้าของ.*โอน|ผม.*โอน/u.test(line)) return 'owner_transfer';
  if(/โอน(?:ให้)?(?:ร้าน|supplier|vendor)|ร้านค้า.*โอน/iu.test(line)) return 'vendor_transfer';
  if(/เงินสด(?:ของ)?ร้าน|จ่ายสด(?:จาก)?ร้าน|cash\s*ร้าน/iu.test(line)) return 'company_cash';
  return 'unknown';
}

function cleanExpenseLabel(value:string):string{
  return value
    .replace(/^[-•*]\s*/,'')
    .replace(/^\d+[.)]\s*/,'')
    .replace(/^(?:ค่าใช้จ่าย(?:วันนี้|ร้าน)?\s*[=:]?\s*)/u,'')
    .replace(/\s*\/\s*(?:จ่าย|เงิน|พนักงาน|เจ้าของ|โอน).*$/u,'')
    .replace(/\s*(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿)?\s*$/u,'')
    .trim();
}

function parseExpenseLine(line:string):ParsedInthaninExpense|null{
  const normalized=normalizeLine(line);
  if(!normalized) return null;
  const withoutPrefix=normalized.replace(/^\d+[.)]?\s*/,'').trim();
  const amountMatch=withoutPrefix.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿)?(?:\s*\/|\s*$)/u);
  if(!amountMatch) return null;
  const amount=Number(amountMatch[1].replace(/,/g,''));
  if(!Number.isFinite(amount)||amount<=0) return null;
  const label=cleanExpenseLabel(withoutPrefix);
  if(!label||/^(?:ค่าใช้จ่าย|รวม)$/u.test(label)) return null;
  return {
    label,
    amount,
    category:expenseCategory(label),
    funding:expenseFunding(withoutPrefix),
  };
}

function expenseSection(lines:string[]):ParsedInthaninExpense[]{
  const result:ParsedInthaninExpense[]=[];
  let inExpenses=false;
  for(const raw of lines){
    const line=normalizeLine(raw);
    if(/ค่าใช้จ่าย(?:วันนี้|ร้าน)?/u.test(line)){
      inExpenses=true;
      const after=line.includes('=')?line.slice(line.indexOf('=')+1).trim():'';
      const sameLine=after?parseExpenseLine(after):null;
      if(sameLine)result.push(sameLine);
      continue;
    }
    if(!inExpenses)continue;
    if(/(?:จำนวนแก้ว|จำนวนบิล|เงินสดตั้งต้น|เงินสดนับจริง|หมายเหตุ|สิทธิ\s*\/\s*โปร|ช่องทางรับเงิน)/u.test(line))break;
    const parsed=parseExpenseLine(line);
    if(parsed)result.push(parsed);
  }
  return result;
}

function parseLegacyCashExpression(line:string|null):{cash:number|null;deduction:number|null;ending:number|null}{
  if(!line)return {cash:null,deduction:null,ending:null};
  const rhs=line.includes('=')?line.slice(line.indexOf('=')+1):line;
  const match=normalizeDigits(rhs).match(/([\d,]+(?:\.\d+)?)\s*-\s*([\d,]+(?:\.\d+)?)\s*=\s*([\d,]+(?:\.\d+)?)/);
  if(!match)return {cash:firstAmountAfterEquals(line),deduction:null,ending:null};
  return {
    cash:Number(match[1].replace(/,/g,'')),
    deduction:Number(match[2].replace(/,/g,'')),
    ending:Number(match[3].replace(/,/g,'')),
  };
}

function noteFromLines(lines:string[]):string|null{
  const index=lines.findIndex(line=>/หมายเหตุ/u.test(line));
  if(index<0)return null;
  const current=normalizeLine(lines[index]);
  const inline=current.includes('=')?current.slice(current.indexOf('=')+1).trim():'';
  if(inline)return inline;
  const following:string[]=[];
  for(let i=index+1;i<lines.length;i+=1){
    const text=normalizeLine(lines[i]);
    if(!text)continue;
    if(/^\d+[.)]/.test(text))break;
    following.push(text);
  }
  return following.join(' ').trim()||null;
}

function benefit(lines:string[],patterns:RegExp[]):ParsedBenefit{
  const line=findLine(lines,patterns);
  return line?parseCountAndAmount(line):{count:0,amount:0};
}

export function looksLikeInthaninDailyCloseText(text:string):boolean{
  const value=normalizeDigits(text);
  const signals=[
    /Inthanin|อินทนิน/iu.test(value),
    /ยอดขาย/u.test(value),
    /เงินสด/u.test(value),
    /QR/iu.test(value),
    /จำนวนแก้ว/u.test(value),
    /ค่าใช้จ่าย/u.test(value),
  ].filter(Boolean).length;
  const closeSignal=/ยอดขาย|ปิดยอด|Daily\s*Close/iu.test(value);
  return signals>=3 && closeSignal;
}

export function parseInthaninDailyCloseText(text:string):ParsedInthaninDailyClose{
  const lines=text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const matched=looksLikeInthaninDailyCloseText(text);
  const dateLine=findLine(lines,[/(?:วัน\s*\/\s*เดือน\s*\/\s*ปี|วันที่)/u]);
  const localDate=parseInthaninDate(dateLine??text);

  const reportedPosNetSales=amountFromLine(lines,[
    /ยอดขาย(?:รวม|สุทธิ)?/u,
    /ยอดขายตาม\s*POS/iu,
  ]) ?? null;
  const discounts=amountFromLine(lines,[/ส่วนลดรวม/u]) ?? 0;
  const refunds=amountFromLine(lines,[/คืนเงิน/u,/Void/iu]) ?? 0;

  const cashLine=findLine(lines,[/(?:^|[.)\s])เงินสด(?:จากการขาย)?\s*[=:]/u],[
    /ตั้งต้น|นับจริง|ปลายวัน|เหลือ/u,
  ]);
  const legacyCash=parseLegacyCashExpression(cashLine);
  const paymentCash=legacyCash.cash ?? 0;

  const paymentQrKplus=amountFromLine(lines,[/KBANK\s*QR|K-?Plus/iu],[/Free\s*Drink/iu]) ?? 0;
  const paymentQrManual=amountFromLine(lines,[/QR\s*(?:code\s*)?Manual/iu]) ?? 0;
  const paymentKrungsri=amountFromLine(lines,[/กรุงศรี/u]) ?? 0;
  const paymentOtherNamed=amountFromLine(lines,[/ช่องทางอื่น/u,/รับเงินอื่น/u]) ?? 0;
  const paymentDelivery=amountFromLine(lines,[/Delivery|เดลิเวอรี|เดลิเวอรี่/iu]) ?? 0;
  const paymentCard=amountFromLine(lines,[/บัตร(?:เครดิต|เดบิต)?/u,/card/iu]) ?? 0;

  const benefits={
    kbank_free_drink:benefit(lines,[/KBank\s*Free\s*Drink/iu]),
    ais_25:benefit(lines,[/AIS\s*25\s*คะแนน/iu]),
    ais_65:benefit(lines,[/AIS\s*65\s*คะแนน/iu]),
    bangchak_points:benefit(lines,[/แลกแต้มบางจาก/u]),
    bcp_member_discount:benefit(lines,[/(?:Mamber|Member)\s*BCP\s*discount/iu]),
    other:benefit(lines,[/โปร\s*\/\s*สิทธิอื่น/u,/สิทธิอื่น/u]),
  };

  let expenses=expenseSection(lines);
  const unknownExpenseTotal=expenses
    .filter(exp=>exp.funding==='unknown')
    .reduce((sum,exp)=>sum+exp.amount,0);
  const explicitFundingTotal=expenses
    .filter(exp=>exp.funding!=='unknown')
    .reduce((sum,exp)=>sum+exp.amount,0);
  const legacyCanExplainUnknownExpenses=
    legacyCash.deduction!==null
    && explicitFundingTotal===0
    && unknownExpenseTotal>0
    && Math.abs(unknownExpenseTotal-legacyCash.deduction)<0.009;
  if(legacyCanExplainUnknownExpenses){
    expenses=expenses.map(exp=>exp.funding==='unknown'?{...exp,funding:'company_cash'}:exp);
  }
  const cupCount=amountFromLine(lines,[/จำนวนแก้ว/u]);
  const billCount=amountFromLine(lines,[/จำนวนบิล/u]);
  const cashOpeningFloat=amountFromLine(lines,[/เงินสดตั้งต้น/u]);
  const cashCountedClosing=amountFromLine(lines,[/เงินสดนับจริง(?:ปลายวัน)?/u,/เงินสดปลายวัน/u]);
  const notes=noteFromLines(lines);

  const paymentQr=paymentQrKplus+paymentQrManual;
  const paymentOther=paymentKrungsri+paymentOtherNamed;
  const grossSales=reportedPosNetSales===null?null:reportedPosNetSales+discounts+refunds;

  const warnings:string[]=[];
  if(legacyCanExplainUnknownExpenses)warnings.push('legacy_cash_deduction_inferred_expense_funding');
  const cashExpenses=expenses.filter(exp=>exp.funding==='company_cash').reduce((sum,exp)=>sum+exp.amount,0);
  if(legacyCash.deduction!==null && Math.abs(legacyCash.deduction-cashExpenses)>0.009){
    warnings.push('cash_deduction_does_not_match_itemized_cash_expenses');
  }
  if(expenses.some(exp=>exp.funding==='unknown'))warnings.push('expense_funding_needs_review');
  if(billCount===null)warnings.push('bill_count_missing');
  if(cashOpeningFloat===null)warnings.push('cash_opening_float_missing');
  if(cashCountedClosing===null)warnings.push('cash_counted_closing_missing');

  const missingCritical:string[]=[];
  if(!localDate)missingCritical.push('date');
  if(reportedPosNetSales===null)missingCritical.push('reported_pos_net_sales');

  return {
    matched,
    localDate,
    reportedPosNetSales,
    discounts,
    refunds,
    grossSales,
    paymentCash,
    paymentQrKplus,
    paymentQrManual,
    paymentKrungsri,
    paymentOtherNamed,
    paymentQr,
    paymentCard,
    paymentDelivery,
    paymentOther,
    benefits,
    expenses,
    cupCount,
    billCount,
    cashOpeningFloat,
    cashCountedClosing,
    notes,
    legacyCashDeduction:legacyCash.deduction,
    warnings,
    missingCritical,
  };
}
