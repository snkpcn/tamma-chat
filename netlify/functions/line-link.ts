import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';

const TAMMA_SITE_URL = 'https://tamma-chat.netlify.app';
const OFFICIAL_MAP_URL = 'https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic';
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

async function latestJourney(targetAnonymousId: string): Promise<unknown | null> {
  const targetId = await guestDbId(targetAnonymousId, true);
  if (!targetId) return null;
  const response = await dbFetch(
    `journeys?guest_id=eq.${encodeURIComponent(targetId)}&select=journey&order=created_at.desc&limit=1`,
  );
  const rows = await response.json() as Array<{ journey: unknown }>;
  return rows[0]?.journey ?? null;
}

async function ensureLatestJourneySaved(targetAnonymousId: string): Promise<void> {
  const targetId = await guestDbId(targetAnonymousId, true);
  if (!targetId) return;

  const latestResponse = await dbFetch(
    `journeys?guest_id=eq.${encodeURIComponent(targetId)}&select=action,journey&order=created_at.desc&limit=1`,
  );
  const latestRows = await latestResponse.json() as Array<{ action: string; journey: unknown }>;
  const latest = latestRows[0];
  if (!latest?.journey || latest.action === 'save') return;

  await dbFetch('journeys', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: targetId,
      action: 'save',
      intent: 'save_journey',
      journey: latest.journey,
    }),
  });

  await dbFetch('guest_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: targetId,
      event_type: 'journey_saved',
      intent: 'save_journey',
      metadata: { source: 'line_view_full' },
    }),
  });
}

function linkPage(): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>Journey ของคุณ — ทำมา-ชาติ</title>
  <style>
    :root{--ink:#3b2a20;--gold:#9a713d;--cream:#f7f1e7;--paper:#fffdfa;--muted:#786a60;--line:#e8ddd0}
    *{box-sizing:border-box} body{margin:0;background:var(--cream);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,sans-serif;min-height:100vh}
    .wrap{max-width:680px;margin:0 auto;padding:22px 18px 48px}.brand{font-weight:800;letter-spacing:.04em;color:var(--gold);margin:4px 0 14px}.card{background:var(--paper);border:1px solid var(--line);border-radius:24px;padding:22px;box-shadow:0 10px 30px rgba(59,42,32,.08)}
    h1{font-size:28px;line-height:1.25;margin:0 0 8px}.sub{color:var(--muted);margin:0 0 22px;line-height:1.55}.day{border-top:1px solid var(--line);padding-top:20px;margin-top:20px}.day h2{font-size:19px;margin:0 0 14px}.slot{display:grid;grid-template-columns:78px 1fr;gap:12px;padding:13px 0;border-bottom:1px dashed var(--line)}.slot:last-child{border-bottom:0}.time{font-size:12px;font-weight:800;color:var(--gold);text-transform:uppercase}.name{font-weight:800;margin-bottom:4px}.note{font-size:14px;line-height:1.55;color:var(--muted)}
    .actions{display:grid;gap:10px;margin-top:22px}.btn{display:block;text-align:center;text-decoration:none;padding:14px 16px;border-radius:14px;font-weight:800}.primary{background:#7a5a32;color:white}.secondary{background:#eee5da;color:var(--ink)}.status{padding:36px 20px;text-align:center;color:var(--muted)}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brand">ทำมา-ชาติ · THONGTHAI</div>
    <section class="card" id="card"><div class="status" id="status">กำลังเปิด Journey และเชื่อมความจำของทองไทย…</div></section>
  </main>
  <script>
    (async function(){
      const params=new URLSearchParams(location.search);
      const token=params.get('token')||'';
      const next=params.get('next')||'';
      const existing=localStorage.getItem('tamma_guest_id');
      const card=document.getElementById('card');
      const label={morning:'เช้า',lunch:'เที่ยง',afternoon:'บ่าย',evening:'เย็น',night:'ค่ำ'};
      const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
      try{
        const res=await fetch('/.netlify/functions/line-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,existingGuestId:existing,saveLatestJourney:next==='journey'})});
        if(!res.ok)throw new Error('link failed');
        const data=await res.json();
        if(!data.guestId)throw new Error('missing guest');
        localStorage.setItem('tamma_guest_id',data.guestId);

        card.textContent='';
        if(next==='journey'&&data.journey){
          const j=data.journey;
          card.appendChild(el('h1','',j.title||'Journey ของคุณ'));
          card.appendChild(el('p','sub','แผนนี้เชื่อมกับความจำของทองไทยบน LINE และเว็บแล้ว'));
          const days=Array.isArray(j.days)?j.days:[];
          days.forEach((d,i)=>{
            const day=el('div','day');
            day.appendChild(el('h2','',d.title||('วันที่ '+(d.dayNumber||i+1))));
            const slots=Array.isArray(d.slots)?d.slots:[];
            slots.forEach(s=>{
              const row=el('div','slot');
              row.appendChild(el('div','time',label[s.timeOfDay]||s.timeOfDay||''));
              const body=el('div','');
              body.appendChild(el('div','name',s.experienceName||'จุดแวะ'));
              if(s.note)body.appendChild(el('div','note',s.note));
              row.appendChild(body);day.appendChild(row);
            });
            card.appendChild(day);
          });
          const actions=el('div','actions');
          const site=el('a','btn primary','เปิดเว็บทำมา-ชาติ');site.href='${TAMMA_SITE_URL}/';
          const map=el('a','btn secondary','เปิดแผนที่ ทำมา-ชาติ');map.href='${OFFICIAL_MAP_URL}';
          actions.appendChild(site);actions.appendChild(map);card.appendChild(actions);
        }else{
          card.appendChild(el('h1','','เชื่อมความจำเรียบร้อยแล้ว ✓'));
          card.appendChild(el('p','sub','จากนี้ทองไทยบน LINE และเว็บจะใช้ความจำชุดเดียวกันครับ'));
          const site=el('a','btn primary','เปิดเว็บทำมา-ชาติ');site.href='${TAMMA_SITE_URL}/';card.appendChild(site);
        }
      }catch(err){
        card.textContent='';
        card.appendChild(el('h1','','ลิงก์นี้ใช้ไม่ได้หรือหมดอายุแล้ว'));
        card.appendChild(el('p','sub','กลับไปที่ LINE แล้วให้ทองไทยสร้าง Journey ใหม่เพื่อรับลิงก์ล่าสุดครับ'));
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
    let body: { token?: string; existingGuestId?: string; saveLatestJourney?: boolean };
    try {
      body = JSON.parse(event.body ?? '{}') as { token?: string; existingGuestId?: string; saveLatestJourney?: boolean };
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
      if (body.saveLatestJourney) await ensureLatestJourneySaved(targetGuestId);
      const journey = body.saveLatestJourney ? await latestJourney(targetGuestId) : null;
      return json(200, { guestId: targetGuestId, journey });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown linking error';
      console.error('LINE_LINK_ERROR', detail.slice(0, 240));
      return json(503, { error: 'Customer linking unavailable' });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
