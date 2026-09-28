import type { Handler } from '@netlify/functions';
import { sendDailyAiCostSummary } from './_ai-cost-notifier';

export const handler:Handler=async()=>{
  try{
    const result=await sendDailyAiCostSummary();
    console.log('AI_COST_DAILY_NOTIFY',JSON.stringify(result));
    return {statusCode:200,body:JSON.stringify({ok:true,...result})};
  }catch(error){
    console.error('AI_COST_DAILY_NOTIFY_ERROR',error instanceof Error?error.message.slice(0,240):'unknown');
    return {statusCode:200,body:JSON.stringify({ok:false})};
  }
};
