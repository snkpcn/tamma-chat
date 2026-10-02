import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  looksLikeInthaninDailyCloseText,
  parseInthaninDailyCloseText,
  parseInthaninDate,
} from '../netlify/functions/_inthanin-daily-close-text';

const legacySample=`☕️ร้านInthanin สาขาตาดโตน ชัยภูมิ
1. วัน/เดือน/ปี  = 1/10/69
2. ยอดขายรวม=1,185
3. เงินสด  =375-100=275
4.KBANK QR  k-plus= 0
5.kbank  Free Drink= 0
6.QR code Manual=810
7.Ais 25 คะแนน=0
  Ais 65 คะแนน=0
9.แลกแต้มบางจาก=0
10.Mamber bcp discount 5 = 0
11.กรุงศรี=0
12.ค่าใช้จ่ายร้าน =น้ำแข็ง40
น้ำถัง60
13.จำนวนแก้ว =18แก้ว
14.หมายเหตุ`;

const standardSample=`☕️ Inthanin Café ตาดโตน — ปิดยอดประจำวัน

1. วันที่ = 2/10/69

📊 ยอดขาย
2. ยอดขายตาม POS = 2,000
3. ส่วนลดรวม = 100
4. คืนเงิน / Void = 50

💰 ช่องทางรับเงิน
5. เงินสดจากการขาย = 600
6. KBANK QR K-Plus = 850
7. QR Code Manual = 400
8. กรุงศรี = 0
9. ช่องทางอื่น = 0

🎁 สิทธิ / โปร / แต้ม
10. KBank Free Drink = 1 ครั้ง / 75 บาท
11. AIS 25 คะแนน = 2 ครั้ง / 0 บาท
12. AIS 65 คะแนน = 0 ครั้ง / 0 บาท
13. แลกแต้มบางจาก = 1 ครั้ง / 60 บาท
14. Member BCP Discount = 1 ครั้ง / 100 บาท
15. โปร / สิทธิอื่น = 0 ครั้ง / 0 บาท

💸 ค่าใช้จ่ายวันนี้
16. ค่าใช้จ่าย =
- น้ำแข็ง 40 บาท / จ่ายจากเงินสดร้าน
- นม 720 บาท / พนักงานออกก่อน
- ซ่อมเครื่อง 1,200 บาท / เจ้าของโอน

📦 ปริมาณขาย
17. จำนวนแก้ว = 25
18. จำนวนบิล = 20

💵 ตรวจเงินสด
19. เงินสดตั้งต้น = 500
20. เงินสดนับจริงปลายวัน = 1,060

📝 หมายเหตุ
21. หมายเหตุ = เครื่องปั่นมีเสียงดัง`;

test('Thai short Buddhist year 69 resolves to 2026',()=>{
  assert.equal(parseInthaninDate('1/10/69'),'2026-10-01');
  assert.equal(parseInthaninDate('1/10/2569'),'2026-10-01');
  assert.equal(parseInthaninDate('1/10/2026'),'2026-10-01');
});

test('legacy owner sample reconciles 1,185 sales and applies the shop-cash default to itemized expenses',()=>{
  assert.equal(looksLikeInthaninDailyCloseText(legacySample),true);
  const p=parseInthaninDailyCloseText(legacySample);
  assert.equal(p.localDate,'2026-10-01');
  assert.equal(p.reportedPosNetSales,1185);
  assert.equal(p.grossSales,1185);
  assert.equal(p.paymentCash,375);
  assert.equal(p.paymentQrManual,810);
  assert.equal(p.paymentQr,810);
  assert.equal(p.paymentOther,0);
  assert.equal(p.paymentCash+p.paymentQr+p.paymentCard+p.paymentDelivery+p.paymentOther,1185);
  assert.equal(p.legacyCashDeduction,100);
  assert.deepEqual(p.expenses.map(x=>[x.label,x.amount,x.funding]),[
    ['น้ำแข็ง',40,'company_cash'],
    ['น้ำถัง',60,'company_cash'],
  ]);
  assert.equal(p.cupCount,18);
  assert.equal(p.billCount,null);
  assert.ok(!p.warnings.includes('expense_funding_needs_review'));
  assert.deepEqual(p.missingCritical,[]);
});

test('standard employee form separates POS net sales, discounts, payments, benefits and expense funding',()=>{
  const p=parseInthaninDailyCloseText(standardSample);
  assert.equal(p.localDate,'2026-10-02');
  assert.equal(p.reportedPosNetSales,2000);
  assert.equal(p.discounts,100);
  assert.equal(p.refunds,50);
  assert.equal(p.grossSales,2150,'gross is reconstructed from POS net + discount + refund');
  assert.equal(p.paymentCash,600);
  assert.equal(p.paymentQr,1250);
  assert.equal(p.paymentOther,0);
  assert.equal(p.paymentCash+p.paymentQr+p.paymentCard+p.paymentDelivery+p.paymentOther,1850);
  assert.equal(p.benefits.kbank_free_drink.count,1);
  assert.equal(p.benefits.kbank_free_drink.amount,75);
  assert.equal(p.benefits.ais_25.count,2);
  assert.equal(p.benefits.bangchak_points.amount,60);
  assert.equal(p.benefits.bcp_member_discount.amount,100);
  assert.deepEqual(p.expenses.map(x=>[x.label,x.amount,x.category,x.funding]),[
    ['น้ำแข็ง',40,'ingredients','company_cash'],
    ['นม',720,'ingredients','employee_fronted'],
    ['ซ่อมเครื่อง',1200,'maintenance','owner_transfer'],
  ]);
  assert.equal(p.cupCount,25);
  assert.equal(p.billCount,20);
  assert.equal(p.cashOpeningFloat,500);
  assert.equal(p.cashCountedClosing,1060);
  assert.equal(p.notes,'เครื่องปั่นมีเสียงดัง');
});

test('missing date or POS sales is critical and must not be silently written',()=>{
  const p=parseInthaninDailyCloseText('Inthanin ปิดยอด เงินสด = 100 QR Manual = 200 จำนวนแก้ว = 5');
  assert.equal(p.matched,true);
  assert.ok(p.missingCritical.includes('date'));
  assert.ok(p.missingCritical.includes('reported_pos_net_sales'));
});

test('ordinary cafe conversation is not mistaken for a Daily Close report',()=>{
  assert.equal(looksLikeInthaninDailyCloseText('วันนี้กาแฟอร่อยมากครับ อยากได้ลาเต้อีกแก้ว'),false);
});

test('LINE group routing checks Daily Close before generic payment/fuel/ops handlers',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  const daily=source.indexOf('handleCafeTestDailyCloseText({');
  const payment=source.indexOf('handleLinePaymentGroupText({');
  const fuel=source.indexOf('handleLineFuelText({');
  const generic=source.lastIndexOf('handleLineOpsGroupMessage({');
  assert.ok(daily>0);
  assert.ok(daily<payment);
  assert.ok(daily<fuel);
  assert.ok(daily<generic);
});

test('Café TEST handler hard-requires cafe_test binding, never generic cafe LIVE',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-line.ts','utf8');
  assert.match(source,/team!=='cafe_test'/);
  assert.match(source,/financial_ingest_cafe_test_text_v1/);
  assert.doesNotMatch(source,/environment\s*:\s*['"]live['"]/);
});


test('ordinary closing expenses default to same-day shop cash and auto-categorize when staff omits funding text',()=>{
  const sample=`☕️ Inthanin Café ตาดโตน — ปิดยอดประจำวัน
วันที่ = 3/10/69
ยอดขายตาม POS = 1,500
เงินสดจากการขาย = 700
QR Code Manual = 800
ค่าใช้จ่ายวันนี้
- นมเมจิ 320 บาท
- แก้วพลาสติก 450 บาท
- น้ำยาล้าง 120 บาท
จำนวนแก้ว = 20
จำนวนบิล = 15
เงินสดตั้งต้น = 2,000
เงินสดนับจริงปลายวัน = 1,810`;
  const p=parseInthaninDailyCloseText(sample);
  assert.deepEqual(p.expenses.map(x=>[x.label,x.amount,x.category,x.funding]),[
    ['นมเมจิ',320,'ingredients','company_cash'],
    ['แก้วพลาสติก',450,'packaging','company_cash'],
    ['น้ำยาล้าง',120,'cleaning','company_cash'],
  ]);
});

test('explicit funding overrides the default shop-cash rule',()=>{
  const sample=`Inthanin ปิดยอด
วันที่ = 3/10/69
ยอดขายตาม POS = 1,000
เงินสดจากการขาย = 500
QR Code Manual = 500
ค่าใช้จ่ายวันนี้
- นม 300 บาท / เจ้าของโอน
- น้ำแข็ง 50 บาท / พนักงานออกก่อน
- กล่อง 100 บาท / โอน vendor
จำนวนบิล = 10
เงินสดตั้งต้น = 2,000
เงินสดนับจริงปลายวัน = 2,000`;
  const p=parseInthaninDailyCloseText(sample);
  assert.deepEqual(p.expenses.map(x=>[x.label,x.category,x.funding]),[
    ['นม','ingredients','owner_transfer'],
    ['น้ำแข็ง','ingredients','employee_fronted'],
    ['กล่อง','packaging','vendor_transfer'],
  ]);
});

test('payroll-sensitive lines are not ingested from the staff-visible close expense section',()=>{
  const sample=`Inthanin ปิดยอด
วันที่ = 3/10/69
ยอดขายตาม POS = 1,000
เงินสดจากการขาย = 500
QR Code Manual = 500
ค่าใช้จ่ายวันนี้
- เงินเดือน ปอ 500 บาท
- นมเมจิ 200 บาท
จำนวนบิล = 10
เงินสดตั้งต้น = 2,000
เงินสดนับจริงปลายวัน = 2,300`;
  const p=parseInthaninDailyCloseText(sample);
  assert.deepEqual(p.expenses.map(x=>x.label),['นมเมจิ']);
  assert.equal(p.expenses[0].funding,'company_cash');
});

test('Daily Close reply exposes the separated auto-categorized expense list to staff',()=>{
  const source=readFileSync('netlify/functions/_inthanin-daily-close-line.ts','utf8');
  assert.match(source,/แยกรายการอัตโนมัติ/u);
  assert.match(source,/EXPENSE_CATEGORY_LABELS/);
  assert.match(source,/วัตถุดิบ/u);
  assert.match(source,/บรรจุภัณฑ์/u);
  assert.match(source,/ทำความสะอาด/u);
});
