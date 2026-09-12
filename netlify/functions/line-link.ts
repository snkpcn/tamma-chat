import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mergeBrainGuestData } from './_thongthai-runtime';

const TAMMA_SITE_URL = 'https://tamma-chat.netlify.app';
const OFFICIAL_MAP_URL = 'https://maps.app.goo.gl/67eqn5vGvqJjfxZCA?g_st=ic';
const LINE_OA_ID = '@713zjrta';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARRAY_KEYS = new Set(['interests', 'constraints', 'favorites', 'visited_experiences']);

type JourneyProfile = {
  constraints: string[];
  interests: string[];
  pace: string | null;
};

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
      Authorization: 'Bearer ' + config.key,
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

  // Brain V2 state follows the same canonical LINE guest: semantic travel memory,
  // agent state, and channel aliases move with the structured profile.
  await mergeBrainGuestData(sourceId, targetId);
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

async function loadJourneyProfile(targetAnonymousId: string): Promise<JourneyProfile> {
  const targetId = await guestDbId(targetAnonymousId, true);
  const fallback: JourneyProfile = { constraints: [], interests: [], pace: null };
  if (!targetId) return fallback;

  const response = await dbFetch(
    `guest_memory?guest_id=eq.${encodeURIComponent(targetId)}&memory_key=in.(constraints,interests,pace)&select=memory_key,memory_value`,
  );
  const rows = await response.json() as Array<{ memory_key: string; memory_value: unknown }>;
  const memory = Object.fromEntries(rows.map(row => [row.memory_key, row.memory_value]));
  return {
    constraints: Array.isArray(memory.constraints)
      ? memory.constraints.filter((item): item is string => typeof item === 'string')
      : [],
    interests: Array.isArray(memory.interests)
      ? memory.interests.filter((item): item is string => typeof item === 'string')
      : [],
    pace: typeof memory.pace === 'string' ? memory.pace : null,
  };
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
  const encodedLineId = encodeURIComponent(LINE_OA_ID);
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#f7f1e7">
  <title>Journey ของคุณ — ทำมา-ชาติ</title>
  <style>
    :root{--ink:#3b2a20;--gold:#9a713d;--gold2:#7a5a32;--cream:#f7f1e7;--paper:#fffdfa;--muted:#786a60;--line:#e8ddd0;--soft:#f2e9dd;--green:#48634b}
    *{box-sizing:border-box} body{margin:0;background:var(--cream);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,sans-serif;min-height:100vh}
    .wrap{max-width:720px;margin:0 auto;padding:22px 16px 52px}.brand{font-weight:850;letter-spacing:.05em;color:var(--gold);margin:4px 4px 14px}.card{background:var(--paper);border:1px solid var(--line);border-radius:26px;padding:22px;box-shadow:0 12px 34px rgba(59,42,32,.09);overflow:hidden}
    h1{font-size:clamp(28px,7vw,38px);line-height:1.18;margin:0 0 10px;letter-spacing:-.02em}.sub{color:var(--muted);margin:0;line-height:1.6}.hero-meta{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 2px}.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);color:#624b3b;padding:8px 11px;font-size:12px;font-weight:800}.pill.access{background:#e8efe7;color:var(--green)}
    .notice{margin-top:16px;border:1px solid #d7e3d5;background:#f3f8f2;color:#3f5b42;border-radius:16px;padding:12px 14px;font-size:13px;line-height:1.55;font-weight:700}.day{border-top:1px solid var(--line);padding-top:24px;margin-top:24px}.day h2{font-size:21px;line-height:1.35;margin:0 0 15px}.slot{display:grid;grid-template-columns:68px minmax(0,1fr);gap:12px;padding:14px 0;border-bottom:1px dashed var(--line)}.slot:last-child{border-bottom:0}.visual{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;font-size:30px;background:linear-gradient(145deg,#efe2cf,#f8f2e9);border:1px solid #e7d7c3;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)}.body{min-width:0}.slot-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.name{font-weight:850;font-size:17px;line-height:1.35}.period{font-size:11px;font-weight:850;color:var(--gold);white-space:nowrap;padding-top:3px}.suggested{font-size:12px;font-weight:750;color:#69564a;margin-top:5px}.note{font-size:14px;line-height:1.6;color:var(--muted);margin-top:5px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.tag{font-size:11px;font-weight:800;color:#5d574e;background:#f1ede7;border-radius:999px;padding:6px 8px}.tag.access{background:#e8efe7;color:#456047}.timing-note{font-size:11px;color:#8c7d71;margin-top:16px;line-height:1.5}
    .actions{display:grid;gap:10px;margin-top:26px}.btn{display:block;text-align:center;text-decoration:none;padding:15px 16px;border-radius:15px;font-weight:850;border:0}.primary{background:var(--gold2);color:white}.line{background:#06c755;color:white}.secondary{background:#eee5da;color:var(--ink)}.ghost{background:#f8f4ee;color:#70583d;border:1px solid var(--line)}.status{padding:36px 20px;text-align:center;color:var(--muted)}
    @media (min-width:560px){.card{padding:28px}.slot{grid-template-columns:78px minmax(0,1fr);gap:16px}.visual{width:72px;height:72px;font-size:34px}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brand">ทำมา-ชาติ · THONGTHAI</div>
    <section class="card" id="card"><div class="status">กำลังเปิด Journey และเชื่อมความจำของทองไทย…</div></section>
  </main>
  <script>
    (async function(){
      const params=new URLSearchParams(location.search);
      const token=params.get('token')||'';
      const next=params.get('next')||'';
      const existing=localStorage.getItem('tamma_guest_id');
      const card=document.getElementById('card');
      const periodLabel={morning:'เช้า',lunch:'เที่ยง',afternoon:'บ่าย',evening:'เย็น',night:'ค่ำ'};
      const timePools={morning:['09:00','10:15','11:00'],lunch:['12:00','13:00'],afternoon:['14:30','16:00'],evening:['17:30','18:15'],night:['19:00','20:00']};
      const visual={
        inthanin:{icon:'☕',tags:['นั่งพักได้','จังหวะสบาย']},
        reception:{icon:'🧭',tags:['เดินน้อย','เช็กอินสบายๆ']},
        dining:{icon:'🍲',tags:['นั่งพักได้','ช่วงพักกลางวัน']},
        landscape:{icon:'🌿',tags:['เดินเบาๆ','ปรับระยะได้']},
        sunset:{icon:'🌅',tags:['พักชมวิว','จังหวะสบาย']},
        stay:{icon:'🏡',tags:['พักผ่อน','จังหวะสบาย']},
        adventure:{icon:'🐎',tags:['กิจกรรมกลางแจ้ง']},
        workshop:{icon:'🧺',tags:['กิจกรรมชุมชน']}
      };
      const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
      const addPill=(parent,text,access)=>parent.appendChild(el('span','pill'+(access?' access':''),text));
      const recommended=(timeOfDay,counters)=>{
        const key=String(timeOfDay||'');
        const pool=timePools[key]||[];
        const index=counters[key]||0;
        counters[key]=index+1;
        return pool[index]||pool[pool.length-1]||'';
      };
      const tagList=(experienceId,profile)=>{
        const base=(visual[experienceId]&&visual[experienceId].tags)||[];
        const tags=[...base];
        if(profile&&profile.pace==='slow'&&!tags.includes('จังหวะสบาย'))tags.push('จังหวะสบาย');
        if(profile&&Array.isArray(profile.constraints)&&profile.constraints.includes('limited_walking')){
          if(['inthanin','reception','dining','sunset','stay'].includes(experienceId)&&!tags.includes('เดินน้อย'))tags.push('เดินน้อย');
          if(experienceId==='landscape'&&!tags.includes('ปรับระยะได้'))tags.push('ปรับระยะได้');
        }
        return tags.slice(0,3);
      };
      try{
        const res=await fetch('/.netlify/functions/line-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,existingGuestId:existing,saveLatestJourney:next==='journey'})});
        if(!res.ok)throw new Error('link failed');
        const data=await res.json();
        if(!data.guestId)throw new Error('missing guest');
        localStorage.setItem('tamma_guest_id',data.guestId);

        card.textContent='';
        if(next==='journey'&&data.journey){
          const j=data.journey;
          const profile=data.profile||{constraints:[],interests:[],pace:null};
          card.appendChild(el('h1','',j.title||'Journey ของคุณ'));
          card.appendChild(el('p','sub','แผนนี้เชื่อมกับความจำของทองไทยบน LINE และเว็บแล้ว'));

          const heroMeta=el('div','hero-meta');
          addPill(heroMeta,j.duration==='full'?'ทริปเต็มวัน':'Journey ส่วนตัว',false);
          if(profile.pace==='slow')addPill(heroMeta,'จังหวะสบาย',false);
          if(Array.isArray(profile.constraints)&&profile.constraints.includes('limited_walking'))addPill(heroMeta,'คำนึงถึงการเดินน้อย',true);
          card.appendChild(heroMeta);

          if(Array.isArray(profile.constraints)&&profile.constraints.includes('limited_walking')){
            card.appendChild(el('div','notice','ทองไทยจำได้ว่าคุณไม่สะดวกเดินเยอะ แผนนี้จึงเน้นจุดพักและจังหวะเบา ๆ โดยช่วงเดินชมพื้นที่สามารถลดระยะหรือข้ามได้ตามความสบาย'));
          }

          const counters={};
          const days=Array.isArray(j.days)?j.days:[];
          days.forEach((d,i)=>{
            const day=el('div','day');
            day.appendChild(el('h2','',d.title||('วันที่ '+(d.dayNumber||i+1))));
            const slots=Array.isArray(d.slots)?d.slots:[];
            slots.forEach(s=>{
              const id=String(s.experienceId||'');
              const spec=visual[id]||{icon:'✦',tags:[]};
              const row=el('div','slot');
              row.appendChild(el('div','visual',spec.icon));
              const body=el('div','body');
              const top=el('div','slot-top');
              top.appendChild(el('div','name',s.experienceName||'จุดแวะ'));
              top.appendChild(el('div','period',periodLabel[s.timeOfDay]||s.timeOfDay||''));
              body.appendChild(top);
              const approx=recommended(s.timeOfDay,counters);
              if(approx)body.appendChild(el('div','suggested','เวลาแนะนำ ~ '+approx+' น.'));
              if(s.note)body.appendChild(el('div','note',s.note));
              const tags=tagList(id,profile);
              if(tags.length){const wrap=el('div','tags');tags.forEach(t=>wrap.appendChild(el('span','tag'+((t==='เดินน้อย'||t==='ปรับระยะได้')?' access':''),t)));body.appendChild(wrap)}
              row.appendChild(body);day.appendChild(row);
            });
            card.appendChild(day);
          });

          card.appendChild(el('div','timing-note','* เวลาเป็นเวลาแนะนำเพื่อช่วยจัดจังหวะทริป ไม่ใช่เวลาเปิด-ปิดหรือการยืนยัน availability ของสถานที่'));

          const actions=el('div','actions');
          const lineText=encodeURIComponent('ช่วยปรับ Journey นี้ให้หน่อย: '+String(j.title||'Journey ของฉัน'));
          const line=el('a','btn line','ปรับแผนกับทองไทยใน LINE');
          line.href='https://line.me/R/oaMessage/${encodedLineId}/?'+lineText;
          const site=el('a','btn primary','เปิดเว็บทำมา-ชาติ');site.href='${TAMMA_SITE_URL}/';
          const map=el('a','btn secondary','เปิดแผนที่ ทำมา-ชาติ');map.href='${OFFICIAL_MAP_URL}';
          actions.appendChild(line);actions.appendChild(site);actions.appendChild(map);card.appendChild(actions);
        }else{
          card.appendChild(el('h1','','เชื่อมความจำเรียบร้อยแล้ว ✓'));
          card.appendChild(el('p','sub','จากนี้ทองไทยบน LINE และเว็บจะใช้ความจำชุดเดียวกันครับ'));
          const actions=el('div','actions');
          const line=el('a','btn line','คุยกับทองไทยใน LINE');line.href='https://line.me/R/oaMessage/${encodedLineId}';
          const site=el('a','btn primary','เปิดเว็บทำมา-ชาติ');site.href='${TAMMA_SITE_URL}/';
          actions.appendChild(line);actions.appendChild(site);card.appendChild(actions);
        }
      }catch(err){
        card.textContent='';
        card.appendChild(el('h1','','ลิงก์นี้ใช้ไม่ได้หรือหมดอายุแล้ว'));
        card.appendChild(el('p','sub','กลับไปที่ LINE แล้วให้ทองไทยสร้าง Journey ใหม่เพื่อรับลิงก์ล่าสุดครับ'));
        const line=el('a','btn line','กลับไปคุยกับทองไทย');line.href='https://line.me/R/oaMessage/${encodedLineId}';card.appendChild(line);
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
        'X-Content-Type-Options': 'nosniff',
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
      const [journey, profile] = body.saveLatestJourney
        ? await Promise.all([latestJourney(targetGuestId), loadJourneyProfile(targetGuestId)])
        : [null, await loadJourneyProfile(targetGuestId)];
      return json(200, { guestId: targetGuestId, journey, profile });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown linking error';
      console.error('LINE_LINK_ERROR', detail.slice(0, 240));
      return json(503, { error: 'Customer linking unavailable' });
    }
  }

  return json(405, { error: 'Method not allowed' });
};