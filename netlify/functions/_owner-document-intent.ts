import { boundLineOpsTeam } from './_ops-notifications';
import { handleOwnerExpenseImage } from './_owner-expense-intake';
import { isAuthorizedOwnerPaymentActor, OWNER_DOCUMENT_KIND_QUESTION, OWNER_FUNDS_DIRECTION_QUESTION, OWNER_NON_PAYMENT_REPLY, OWNER_INCOMING_FUNDS_REPLY } from './_owner-payment-document';
import { buildOwnerDocumentChoiceCard, decodeOwnerDocumentAction } from './_owner-document-intent-ui';
import { ownerSlipReplyCard } from './_owner-slip-cards';
import type { LineMessage } from './_ops-line-ui';

export function isExplicitOwnerReviewText(text:string):boolean {
 const value=text.trim().replace(/^ทองไทย(?:ครับ|คะ|ค่ะ)?[\s,]*/u,'');
 return /^(?:#[a-f0-9]{6,32}\b|ตรวจสลิป|สรุป(?:สลิป)?\s*$|แก้(?:เป็น|ไข)|ยอด\s*\d|วันที่\s*20\d\d-|ยืนยัน(?:\s|$)|ยกเลิก(?:\s|$))/iu.test(value);
}
export async function handleOwnerDocumentIntent(input:{targetId:string;userId?:string|null;text?:string;quotedMessageId?:string;data?:string;timestamp?:number;messageId?:string|null}):Promise<LineMessage|null>{
 const command=input.text?.trim().replace(/^ทองไทย(?:ครับ|คะ|ค่ะ)?[\s,]*/u,'');
 const isCommand=!!command && /^(?:ตรวจสลิป|บันทึกสลิป|ดูสลิป|ดู(?:รูป|เอกสาร)นี้|ช่วยดู(?:รูป|เอกสาร)นี้)(?:ครับ|ค่ะ|คะ)?$/u.test(command);
 const isAction=input.data?.startsWith('owner-doc:');
 if(!isCommand&&!isAction)return null;
 if(await boundLineOpsTeam(input.targetId)!=='owner_general')return null;
 if(!isAuthorizedOwnerPaymentActor(input.userId))return {type:'text',text:'ยังไม่ได้เปิดสิทธิ์ตรวจและยืนยันรายการจ่ายให้บัญชี LINE นี้ครับ'};
 const userId=input.userId!;
 let imageMessageId=input.quotedMessageId,action:string|undefined;
 if(isAction){
  const selected=decodeOwnerDocumentAction({data:input.data,targetId:input.targetId,userId});
  if(!selected)return {type:'text',text:'ปุ่มนี้หมดอายุหรือไม่ตรงกับผู้ส่งครับ กรุณาตอบกลับรูปที่ต้องการด้วย “ตรวจสลิป”'};
  imageMessageId=selected.imageMessageId;action=selected.action;
  if(action==='quotation'||action==='other_document')return {type:'text',text:OWNER_NON_PAYMENT_REPLY};
  if(action==='incoming_funds')return {type:'text',text:OWNER_INCOMING_FUNDS_REPLY};
 }
 if(!imageMessageId||!/^\d{1,64}$/.test(imageMessageId))return {type:'text',text:'ตอบกลับรูปที่ต้องการตรวจ แล้วพิมพ์ “ตรวจสลิป” ครับ'};
 const result=await handleOwnerExpenseImage({targetId:input.targetId,userId,messageId:imageMessageId,timestamp:input.timestamp,intent:command?.includes('เอกสาร')||command?.includes('รูป')?'document_help':'payment_review',...(action==='outgoing_payment'?{fundsDirection:'outgoing' as const}:{})});
 if(!result)return null;
 if(result===OWNER_DOCUMENT_KIND_QUESTION){
  if(action==='payment_evidence'||action==='outgoing_payment')return {type:'text',text:'ยังอ่านไม่พบหลักฐานการชำระที่ชัดเจนครับ กรุณาส่งภาพหลักฐานโอนหรือใบเสร็จที่อ่านได้ ยังไม่สร้างรายการจ่าย'};
  return buildOwnerDocumentChoiceCard({targetId:input.targetId,userId,imageMessageId,step:'kind'});
 }
 if(result===OWNER_FUNDS_DIRECTION_QUESTION)return buildOwnerDocumentChoiceCard({targetId:input.targetId,userId,imageMessageId,step:'direction'});
 return ownerSlipReplyCard({targetId:input.targetId,userId,text:result,messageId:input.messageId,timestamp:input.timestamp});
}
