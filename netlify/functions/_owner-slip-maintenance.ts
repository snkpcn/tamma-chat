import { boundLineOpsTeam } from './_ops-notifications';
import { piiHash } from './_operations-db';
import { isOwnerFamilyConversation } from './_owner-staff-intent';

type SlipEvent = {
  type?:string; replyToken?:string; timestamp?:number;
  source?:{type?:string;groupId?:string;roomId?:string;userId?:string};
  message?:{type?:string;id?:string;text?:string;quotedMessageId?:string};
  postback?:{data?:string};
};
type Intake = {id:string;source_user_hash?:string|null;status:string};
type Dependencies = {
  team:(target:string)=>Promise<string|null>;
  payrollPending:(target:string)=>Promise<boolean>;
  pendingIntakes:(target:string)=>Promise<Intake[]>;
  actorHash:(user:string|undefined)=>string|null;
};

// This explicitly rejects work; it never promises durable storage or automatic replay.
export const OWNER_SLIP_MAINTENANCE_REPLY = 'ทองไทยพักรับสลิปและยืนยันรายการชั่วคราวเพื่อปรับปรุงระบบครับ ข้อความหรือรูปครั้งนี้ยังไม่ถูกรับเข้าระบบ และยังไม่ลงบัญชี กรุณาเก็บรูปไว้แล้วส่งรูปพร้อมโน้ตหรือคำยืนยันใหม่หลังแจ้งเปิดรับอีกครั้ง รายการเดิมยังอยู่ครับ';
export class OwnerSlipMaintenanceNoticeError extends Error {}

async function rows(path:string):Promise<any[]> {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('owner_slip_maintenance_configuration_missing');
  const response=await fetch(url.replace(/\/$/u,'')+'/rest/v1/'+path,{
    headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)throw new Error('owner_slip_maintenance_lookup_failed');
  const data=await response.json();
  if(!Array.isArray(data))throw new Error('owner_slip_maintenance_lookup_failed');
  return data;
}
const scope=(target:string)=>{
  const hash=piiHash(target);if(!hash)throw new Error('owner_slip_maintenance_identity_missing');
  return 'owner_group_hash=eq.'+encodeURIComponent(hash);
};
const defaults:Dependencies={
  team:boundLineOpsTeam,
  // Same precedence as handleOwnerPayrollImage; no image/provider/storage reads.
  payrollPending:async target=>(await rows('financial_employee_payroll_events?'+scope(target)
    +'&status=in.(awaiting_slip,needs_review)&event_type=in.(salary_advance,salary_payment)&select=id&limit=1')).length>0,
  // Only pre-existing columns: the paused build can run before the review migration.
  pendingIntakes:async target=>{
    const found=await rows('financial_owner_expense_intakes?'+scope(target)
      +'&status=in.(awaiting_purpose,awaiting_business)&select=id,source_user_hash,status&limit=1001');
    if(found.length>1000)throw new Error('owner_slip_maintenance_lookup_overflow');
    return found;
  },
  actorHash:piiHash,
};

export function ownerSlipMaintenancePaused(env:Record<string,string|undefined>=process.env):boolean {
  return env.THONGTHAI_OWNER_SLIP_MODE!==undefined&&env.THONGTHAI_OWNER_SLIP_MODE!=='active';
}

export async function partitionOwnerSlipMaintenance<T extends SlipEvent>(
  events:T[],env:Record<string,string|undefined>=process.env,deps:Dependencies=defaults,
):Promise<{blocked:T[];allowed:T[]}> {
  // Missing flag preserves existing deployments. An invalid explicit value fails closed.
  const paused=ownerSlipMaintenancePaused(env);
  const cutoffText=env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;
  const cutoff=cutoffText?Date.parse(cutoffText):null;
  if(!paused&&cutoff===null)return {blocked:[],allowed:events};
  const blocked:T[]=[],allowed:T[]=[];
  for(const event of events){
    const stale=cutoff!==null&&(!Number.isFinite(cutoff)||!Number.isFinite(event.timestamp)||event.timestamp!<=cutoff);
    if(!paused&&!stale){allowed.push(event);continue;}
    const source=event.source;
    const target=source?.type==='group'?source.groupId:source?.type==='room'?source.roomId:null;
    if(target&&event.type==='postback'&&(event.postback?.data?.startsWith('owner-slip:')||event.postback?.data?.startsWith('owner-doc:'))&&await deps.team(target)==='owner_general'){blocked.push(event);continue;}
    if(!target||event.type!=='message'||!['image','text'].includes(event.message?.type||'')
      ||await deps.team(target)!=='owner_general'){allowed.push(event);continue;}
    let affected=false;
    if(event.message?.type==='image')affected=false; // Unaddressed images are quiet; targeted payroll retains its own route.
    else {
      const text=(event.message?.text?.trim()||'').replace(/^ทองไทย(?:ครับ|คะ|ค่ะ)?[\s,]*/u,'');
      if(text&&/^(?:ตรวจสลิป|บันทึกสลิป|ดูสลิป|ดู(?:รูป|เอกสาร)นี้|ช่วยดู(?:รูป|เอกสาร)นี้|#|สรุป|แก้|ยอด\s*\d|วันที่\s*20\d\d-|ยืนยัน|ยกเลิก)/u.test(text)&&!/^ผูกทีม\s+/iu.test(text)&&!isOwnerFamilyConversation(text)){
        const refs=[...text.matchAll(/#([a-f0-9]{6,32})\b/giu)].map(m=>m[1].toLowerCase());
        // Canonical review actions must never fall through even after a schema/code rollback.
        affected=!!event.message?.quotedMessageId&&/^(?:ตรวจสลิป|บันทึกสลิป|ดูสลิป|ดู(?:รูป|เอกสาร)นี้|ช่วยดู(?:รูป|เอกสาร)นี้)/u.test(text) || /^(?:ยืนยัน\s+(?:#[a-f0-9]{6,32}\s+)?v\d+|ยกเลิก\s+#[a-f0-9]{6,32})(?:\s|$)/iu.test(text);
        if(!affected){
          const pending=await deps.pendingIntakes(target),actor=deps.actorHash(source?.userId);
          affected=pending.some(row=>refs.length?refs.some(ref=>row.id.replace(/-/gu,'').startsWith(ref))
            :Boolean(actor)&&row.source_user_hash===actor);
        }
      }
    }
    (affected?blocked:allowed).push(event);
  }
  return {blocked,allowed};
}

/** Finish all rejection notices before dispatching ANY remaining event in a mixed batch. */
export async function notifyOwnerSlipMaintenance<T extends SlipEvent>(
  blocked:T[],reply:(token:string,text:string)=>Promise<void>,
):Promise<void>{
  for(const event of blocked){
    if(!event.replyToken)throw new Error('owner_slip_maintenance_missing_reply_token');
    await reply(event.replyToken,OWNER_SLIP_MAINTENANCE_REPLY);
  }
}

