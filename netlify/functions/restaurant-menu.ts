import type { Handler } from '@netlify/functions';
import { listRestaurantMenu, RESTAURANT_MENU_URL } from './_restaurant-sot';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const menu = await listRestaurantMenu();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=15, s-maxage=30',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        restaurant: 'ตำมา-ชาติ',
        sourceOfTruth: true,
        menuUrl: RESTAURANT_MENU_URL,
        updatedAt: menu.reduce((latest, item) => item.source_updated_at > latest ? item.source_updated_at : latest, new Date(0).toISOString()),
        count: menu.length,
        items: menu,
      }),
    };
  } catch (error) {
    console.error('RESTAURANT_MENU_ENDPOINT_ERROR', error instanceof Error ? error.message.slice(0, 240) : 'unknown');
    return { statusCode: 503, headers: { 'Content-Type':'application/json; charset=utf-8' }, body: JSON.stringify({ error:'menu_temporarily_unavailable' }) };
  }
};
