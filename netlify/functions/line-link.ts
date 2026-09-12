import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';

const TAMMA_SITE_URL = 'https://tamma-chat.netlify.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARRAY_KEYS = new Set(['interests', 'constraints', 'favorites', 'visited_experiences']);

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function decodeAndVerifyToken(token: string | undefined): string | null {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [guestId, expiresRaw, signatureRaw] = parts;
  if (!UUID_RE.test(guestId)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  try {
    const payload = `${guestId}.${expiresRaw}`;
    const expected = createHmac('sha256', secret).update(payload, 'utf8').digest();
    const received = Buffer.from(signatureRaw, 'base64url');
    return received.length === expected.length && timingSafeEqual(received, expected)
      ? guestId
      : null;
  } catch {
    return null;
  }
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabaseConfig();
  if (!config) throw new Error('Supabase configuration missing');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase request failed ${response.status}`);
  return response;
}

async function guestDbId(anonymousId: string, createIfMissing = false): Promise<string | null> {
  const response = await dbFetch(
    `guests?anonymous_id=eq.${encodeURIComponent(anonymousId)}&select=id&limit=1`,
  );
  const rows = await response.json() as Array<{ id: string }>;
  if (rows[0]?.id) return rows[0].id;
  if (!createIfMissing) return null;

  const createdResponse = await dbFetch('guests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      anonymous_id: anonymousId,
      language: 'th',
      last_seen_at: new Date().toISOString(),
    }),
  });
  const created = await createdResponse.json() as Array<{ id: string }>;
  return created[0]?.id ?? null;
}

function mergeValue(key: string, target: unknown, source: unknown): unknown {
  if (ARRAY_KEYS.has(key)) {
    const targetList = Array.isArray(target) ? target : [];
    const sourceList = Array.isArray(source) ? source : [];
    return [...new Set([...targetList, ...sourceList].filter(item => typeof item === 'string'))];
  }

  if (key === 'group') {
    const targetGroup = target && typeof target === 'object' ? target as Record<string, unknown> : {};
    const sourceGroup = source && typeof source === 'object' ? source as Record<string, unknown> : {};
    return {
      adults: targetGroup.adults ?? sourceGroup.adults ?? null,
      children: targetGroup.children ?? sourceGroup.children ?? null,
      elderly: targetGroup.elderly ?? sourceGroup.elderly ?? null,
    };
  }

  return target ?? source;
}

async function mergeWebGuestIntoLineGuest(sourceAnonymousId: string, targetAnonymousId: string): Promise<void> {
  if (sourceAnonymousId === targetAnonymousId) return;
  const sourceId = await guestDbId(sourceAnonymousId, false);
  const targetId = await guestDbId(targetAnonymousId, true);
  if (!sourceId || !targetId) return;

  const [sourceMemoryResponse, targetMemoryResponse] = await Promise.all([
    dbFetch(`guest_memory?guest_id=eq.${encodeURIComponent(sourceId)}&select=memory_key,memory_value`),
    dbFetch(`guest_memory?guest_id=eq.${encodeURIComponent(targetId)}&select=memory_key,memory_value`),
  ]);
  const sourceRows = await sourceMemoryResponse.json() as Array<{ memory_key: string; memory_value: unknown }>;
  const targetRows = await targetMemoryResponse.json() as Array<{ memory_key: string; memory_value: unknown }>;
  const sourceMap = new Map(sourceRows.map(row => [row.memory_key, row.memory_value]));
  const targetMap = new Map(targetRows.map(row => [row.memory_key, row.memory_value]));
  const keys = new Set([...sourceMap.keys(), ...targetMap.keys()]);
  const now = new Date().toISOString();

  const mergedRows = [...keys].map(memoryKey => ({
    guest_id: targetId,
    memory_key: memoryKey,
    memory_value: mergeValue(memoryKey, targetMap.get(memoryKey), sourceMap.get(memoryKey)),
    updated_at: now,
  }));

  if (mergedRows.length) {
    await dbFetch('guest_memory?on_conflict=guest_id,memory_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(mergedRows),
    });
  }

  const targetSavedResponse = await dbFetch(
    `journeys?guest_id=eq.${encodeURIComponent(targetId)}&action=eq.save&select=id&limit=1`,
  );
  const targetSaved = await targetSavedResponse.json() as Array<{ id: string }>;
  if (!targetSaved.length) {
    const sourceSavedResponse = await dbFetch(
      `journeys?guest_id=eq.${encodeURIComponent(sourceId)}&action=eq.save&select=journey&order=created_at.desc&limit=1`,
    );
    const sourceSaved = await sourceSavedResponse.json() as Array<{ journey: unknown }>;
    if (sourceSaved[0]?.journey) {
      await dbFetch('journeys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          guest_id: targetId,
          action: 'save',
          intent: 'save_journey',
          journey: sourceSaved[0].journey,
        }),
      });
    }
  }
}

function linkPage(): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>เชื่อมทองไทยกับทำมา-ชาติ</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f0e9;color:#3b2a20;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
    .card{max-width:480px;background:#fff;border-radius:22px;padding:30px;box-shadow:0 14px 40px rgba(59,42,32,.12);text-align:center}
    h1{font-size:24px;margin:0 0 12px}p{line-height:1.65;margin:0;color:#75665d}.dot{font-size:34px;margin-bottom:16px}
  </style>
</head>
<body>
  <div class="card"><div class="dot">🐴</div><h1 id="title">กำลังเชื่อมความจำของทองไทย…</h1><p id="detail">อีกสักครู่จะพากลับไปที่ทำมา-ชาติครับ</p></div>
  <script>
    (async function(){
      const params=new URLSearchParams(location.search);
      const token=params.get('token')||'';
      const next=params.get('next')||'';
      const existing=localStorage.getItem('tamma_guest_id');
      try{
        const res=await fetch('/.netlify/functions/line-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,existingGuestId:existing})});
        if(!res.ok)throw new Error('link failed');
        const data=await res.json();
        if(!data.guestId)throw new Error('missing guest');
        localStorage.setItem('tamma_guest_id',data.guestId);
        document.getElementById('title').textContent='เชื่อมเรียบร้อยแล้ว ✓';
        document.getElementById('detail').textContent='จากนี้ทองไทยบน LINE และเว็บจะใช้ความจำชุดเดียวกันครับ';
        setTimeout(()=>location.replace('${TAMMA_SITE_URL}/'+(next==='journey'?'#plan':'')),700);
      }catch(err){
        document.getElementById('title').textContent='ลิงก์นี้ใช้ไม่ได้หรือหมดอายุแล้ว';
        document.getElementById('detail').textContent='กลับไปที่ LINE แล้วให้ทองไทยสร้าง Journey ใหม่เพื่อรับลิงก์ล่าสุดครับ';
      }
    })();
  </script>
</body>
</html>`;
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters?.token;
    if (!decodeAndVerifyToken(token)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        body: '<!doctype html><meta charset="utf-8"><title>Invalid link</title><p>ลิงก์นี้ใช้ไม่ได้หรือหมดอายุแล้วครับ</p>',
      };
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      },
      body: linkPage(),
    };
  }

  if (event.httpMethod === 'POST') {
    let body: { token?: string; existingGuestId?: string };
    try {
      body = JSON.parse(event.body ?? '{}') as { token?: string; existingGuestId?: string };
    } catch {
      return json(400, { error: 'Malformed JSON' });
    }

    const targetGuestId = decodeAndVerifyToken(body.token);
    if (!targetGuestId) return json(401, { error: 'Invalid or expired token' });

    try {
      if (body.existingGuestId && UUID_RE.test(body.existingGuestId)) {
        await mergeWebGuestIntoLineGuest(body.existingGuestId, targetGuestId);
      } else {
        await guestDbId(targetGuestId, true);
      }
      return json(200, { guestId: targetGuestId });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown linking error';
      console.error('LINE_LINK_ERROR', detail.slice(0, 240));
      return json(503, { error: 'Customer linking unavailable' });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
