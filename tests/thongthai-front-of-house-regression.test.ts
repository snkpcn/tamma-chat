import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cafeGroundedAnswer } from '../netlify/functions/thongthai-chat';
import { polishCustomerMessage } from '../netlify/functions/_chat-copy-style';
import { applyThongthaiCharacterKernel } from '../netlify/functions/_thongthai-character-kernel';
import { selectOtopProductForMedia } from '../netlify/functions/_thongthai-media';
import { composeSafetyIssueResponse } from '../netlify/functions/_service-mind-feedback-response';
import type { CafeMasterMenuItem } from '../netlify/functions/_cafe-sot';
import type { ServiceFeedbackMatch } from '../netlify/functions/_service-mind-feedback-intent';

const latte:CafeMasterMenuItem={
  code:'cafe_latte',category:'coffee',name_th:'คาเฟ่ลาเต้',name_en:'Cafe Latte',
  prices:{hot:60,iced:75,frappe:85},available_all_branches:true,active:true,
  source:'test',source_verified_at:'2026-10-02',metadata:{},updated_at:'2026-10-02T00:00:00Z',
  slots:[
    {id:'1',menu_code:'cafe_latte',slot_code:'hot',label_th:'ร้อน',label_en:'Hot',price:60,active:true,sort_order:10,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
    {id:'2',menu_code:'cafe_latte',slot_code:'iced',label_th:'เย็น',label_en:'Iced',price:75,active:true,sort_order:20,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
    {id:'3',menu_code:'cafe_latte',slot_code:'frappe',label_th:'ปั่น',label_en:'Frappe',price:85,active:true,sort_order:30,metadata:{},updated_at:'2026-10-02T00:00:00Z'},
  ],
};

function req(message:string){
  return {
    message,language:'th',guestId:'00000000-0000-4000-8000-000000000001',
    chatHistory:[],guestContext:{tripDuration:null,travelerType:null,group:{adults:null,children:null,elderly:null},interests:[],pace:null,budget:null,constraints:[]},
    journeyContext:{currentPlan:null,savedPlan:null,visitedExperiences:[],favorites:[],journalEntries:[]},
    pageContext:{section:'line'},
  } as any;
}

test('owner screenshot: casual iced-latte price question answers one price, not a menu dump',()=>{
  const r=cafeGroundedAnswer(req('ลาเต้เย็นกี่บาทหรอครับ'),[latte],[]);
  assert.ok(r);
  assert.equal(r!.answer,'คาเฟ่ลาเต้ เย็น 75 บาทครับ');
  assert.doesNotMatch(r!.answer,/Core|Master|Slot|ยืนยันในระบบ/iu);
});

test('unresolved cafe price question never falls back to internal/catalog dump',()=>{
  const r=cafeGroundedAnswer(req('แก้วนั้นเย็นกี่บาทหรอครับ'),[latte],[]);
  assert.ok(r);
  assert.equal(r!.grounded,false);
  assert.match(r!.answer,/จับชื่อเมนูยังไม่ชัวร์/u);
  assert.doesNotMatch(r!.answer,/Core|Master|Slot|เมนูหลัก ๆ/u);
});

test('last-mile copy strips internal implementation language',()=>{
  const text=polishCustomerMessage(
    'เมนู Core ที่ยืนยันในระบบตอนนี้มีครับ\nถ้าบอกชื่อ ผมเช็ก Price Slot ตาม Slot จริงให้ได้ครับ\nจากข้อมูลล่าสุด (openweathermap): เมฆมาก',
    'line',
  );
  assert.doesNotMatch(text,/\bCore\b|\bMaster\b|Price\s*Slot|Slot\s*จริง|openweathermap|ยืนยันในระบบ/iu);
});

test('character kernel keeps one restrained emoji without replacing one canned opener with another',()=>{
  const text=applyThongthaiCharacterKernel({
    message:'รับทราบครับ เดี๋ยวช่วยดูให้ครับ 😊🙏✨',
    customerMessage:'ช่วยแนะนำหน่อยครับ',
    language:'th',channel:'line',
  });
  assert.doesNotMatch(text,/^รับทราบครับ|^ได้ครับ/u);
  assert.match(text,/เดี๋ยวช่วยดูให้/u);
  assert.ok((text.match(/[\p{Extended_Pictographic}\uFE0F]/gu)??[]).length<=1);
  assert.match(text,/ครับ$/u);
});

test('OTOP media selector resolves the real banana product from the short customer name',()=>{
  const product={
    sku:'OTOP-NB-003',
    name:'กล้วยกรอบแก้วตรานกกระจิบ',
    images:[{url:'https://example.com/banana.webp',alt:'กล้วยกรอบแก้ว',position:0,primary:true}],
  };
  const selected=selectOtopProductForMedia([product],'ขอดูรูปกล้วยกรอบแก้วหน่อยได้ไหมครับ');
  assert.equal(selected?.sku,'OTOP-NB-003');
});

test('all three customer channels are wired for image media',()=>{
  const line=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  const facebook=readFileSync('netlify/functions/facebook-webhook.mts','utf8');
  const web=readFileSync('index.html','utf8');
  assert.match(line,/originalContentUrl/);
  assert.match(line,/deliveryUrl/);
  assert.match(facebook,/attachment:\s*\{/);
  assert.match(facebook,/replyMedia/);
  assert.match(web,/addMediaToStack\(stack, aiResult\.media\)/);
});

test('urgent safety response tells the guest what to do now and does not use routine floor wording',()=>{
  const match:ServiceFeedbackMatch={
    feedbackType:'safety_issue',businessUnit:'activity',severity:'urgent',staffName:null,
    personMentions:[],businessUnitMentions:[],sentimentKeywords:[],issueKeywords:['safety'],
    namedAssets:[],keywordSummary:{topPositive:[],topNegative:[]},
  };
  const text=composeSafetyIssueResponse(match,true,[
    {team:'activity',status:'sent'},
    {team:'owner_general',status:'sent'},
  ]);
  assert.match(text,/หยุดกิจกรรม|ออกจากจุดเสี่ยง/u);
  assert.match(text,/1669|หน่วยฉุกเฉิน/u);
  assert.doesNotMatch(text,/สภาพพื้นจริง/u);
  assert.doesNotMatch(text,/🙏|😊|🚨/u);
});
