import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  OTOP_PROVINCES,
  getOtopProductById,
  getOtopProductsByProvince,
} from '../../src/data/otop';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=900',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

function query(event: HandlerEvent, key: string): string {
  return String(event.queryStringParameters?.[key] ?? '').trim().toLowerCase();
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const productId = query(event, 'productId');
  if (productId) {
    const product = getOtopProductById(productId);
    return product ? json(200, { product }) : json(404, { error: 'product_not_found' });
  }

  const provinceId = query(event, 'provinceId');
  if (provinceId) {
    const province = OTOP_PROVINCES.find((item) => item.provinceId === provinceId);
    if (!province) return json(404, { error: 'province_not_found' });
    return json(200, { province, products: getOtopProductsByProvince(provinceId) });
  }

  return json(200, { provinces: OTOP_PROVINCES });
};
