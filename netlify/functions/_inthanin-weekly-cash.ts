import {weeklyWindow,type CashClose,type CashMovement,type CashBag} from './_inthanin-weekly-cash-report';

async function rows<T>(path:string):Promise<T[]> {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Weekly cash database is not configured');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{
    headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)throw new Error('Weekly cash source unavailable: '+response.status);
  const result=await response.json();
  if(!Array.isArray(result))throw new Error('Invalid weekly cash source response');
  if(result.length>=1000)throw new Error('Weekly cash source may be truncated');
  return result as T[];
}
export function bangkokReportDate(now:Date):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export async function loadWeeklyCashInput(now:Date,branchId:string){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(branchId))throw new Error('Validated branch required');
  const localDate=bangkokReportDate(now),window=weeklyWindow(localDate);
  const [closes,movements,bags]=await Promise.all([
    rows<CashClose>('financial_daily_close_effective_v1?branch_id=eq.'+encodeURIComponent(branchId)+'&environment=eq.live'
      +'&local_date=gte.'+window.start+'&local_date=lte.'+window.end
      +'&select=id,branch_id,local_date,environment,status,net_sales,payment_cash,cash_drawer_outflow_amount,cash_opening_float,cash_counted_closing,operational_metrics,source,confirmed_at&order=local_date.asc&limit=1000'),
    rows<CashMovement>('financial_cash_custody_movements?branch_id=eq.'+encodeURIComponent(branchId)+'&environment=eq.live'
      +'&local_date=gte.'+window.start+'&local_date=lte.'+window.end
      +'&select=local_date,movement_type,direction,amount,created_at&order=created_at.asc&limit=1000'),
    rows<CashBag>('financial_cash_bag_owner_v1?branch_code=eq.inthanin_tadtone&environment=eq.live'
      +'&select=bag_balance,last_movement_at&limit=2'),
  ]);
  if(bags.length>1)throw new Error('Ambiguous branch cash bag');
  const asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(now);
  return {branchId,localDate,asOf,closes,movements,bag:bags[0]??null};
}

/** Resolve only the existing unique enabled cafe group and active Inthanin branch.
 * No private identifiers are bundled, no fallback destination, no new binding.
 */
export type InthaninScope={branchId:string;channelId:string;targetHash:string};
export async function resolveInthaninScope(targetHash:string|null):Promise<InthaninScope|null>{
  if(!targetHash||!/^[a-f0-9]{64}$/.test(targetHash))return null;
  const channels=await rows<{id:string;target_id_hash:string}>(
    'ops_notification_channels?provider=eq.line&team_code=eq.cafe&enabled=eq.true&target_type=eq.group&select=id,target_id_hash&limit=2');
  if(channels.length!==1||channels[0].target_id_hash!==targetHash)return null;
  const branches=await rows<{id:string}>('operations_business_branches?code=eq.inthanin_tadtone&active=eq.true&select=id&limit=2');
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  if(branches.length!==1||!uuid.test(branches[0].id)||!uuid.test(channels[0].id))return null;
  return {branchId:branches[0].id,channelId:channels[0].id,targetHash};
}
