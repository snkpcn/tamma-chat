import type { Handler } from '@netlify/functions';
import { sendIdleAiCostConversationSummaries } from './_ai-cost-notifier';

export const handler:Handler=async()=>{
  try{
    const results=await sendIdleAiCostConversationSummaries();
    console.log('AI_COST_IDLE_NOTIFY',JSON.stringify({count:results.length,results}));
    return {statusCode:200,body:JSON.stringify({ok:true,count:results.length})};
  }catch(error){
    console.error('AI_COST_IDLE_NOTIFY_ERROR',error instanceof Error?error.message.slice(0,240):'unknown');
    return {statusCode:500,body:JSON.stringify({ok:false})};
  }
};
