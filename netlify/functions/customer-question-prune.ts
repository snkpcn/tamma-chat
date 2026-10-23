import type { Handler } from '@netlify/functions';
import { pruneCustomerQuestions } from './_customer-question-store';

export const handler: Handler = async () => {
  const ok = await pruneCustomerQuestions();
  return { statusCode: ok ? 200 : 503, body: JSON.stringify({ ok }) };
};
