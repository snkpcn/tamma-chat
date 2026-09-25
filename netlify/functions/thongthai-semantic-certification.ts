import type { Handler } from '@netlify/functions';
import {
  runSemanticCertification,
  type SemanticCertificationProfile,
} from './_semantic-live-certification';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Robots-Tag':'noindex, nofollow',
    },
    body:JSON.stringify(body),
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405,{error:'Method not allowed'});

  const configured = process.env.THONGTHAI_SEMANTIC_CERT_TOKEN?.trim();
  const supplied = event.queryStringParameters?.token?.trim();

  // Hide the diagnostic surface when disabled or unauthorized.
  if (!configured || !supplied || supplied !== configured) {
    return json(404,{error:'Not found'});
  }

  const profileRaw = event.queryStringParameters?.profile;
  const profile: SemanticCertificationProfile = profileRaw === 'production-smoke'
    ? 'production-smoke'
    : 'full';

  const startRaw = Number(event.queryStringParameters?.start ?? 0);
  const limitRaw = Number(event.queryStringParameters?.limit ?? 10);

  const result = await runSemanticCertification({
    profile,
    start:Number.isFinite(startRaw) ? startRaw : 0,
    limit:Number.isFinite(limitRaw) ? limitRaw : 10,
  });

  return json(200,result);
};
