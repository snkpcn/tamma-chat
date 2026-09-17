import { decryptPii, piiHash } from './_operations-db';
import { createHash } from 'node:crypto';

const RESTAURANT_SCHEMA = 'tamma_chart_os';
const RESTAURANT_NAME = 'ตำมา-ชาติ';
export const RESTAURANT_MENU_URL = 'https://tamma-chat.netlify.app/menu.html';
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

type Json = Record<string, unknown>;
export type RestaurantMenuItem = {
  menu_item_id: string;
  category_name: string;
  category_sort_order: number;
  sort_order: number;
  name: string;
  selling_price: number;
  description: string | null;
  is_signature: boolean;
  ingredient_names: string[];
  unavailable_ingredients: string[];
  available_servings: number;
  is_orderable: boolean;
  source_updated_at: string;
};
type IngredientStock = {
  ingredient_id: string; name: string; base_unit: string; on_hand: number; reserved: number;
  available: number; reorder_point: number; minimum_stock_quantity: number; stock_status: string;
};
type IngredientMaster = {
  id: string; name: string; base_unit: string; purchase_unit: string; conversion_factor: number;
};
type PreorderRow = {
  id: string; restaurant_id: string; preorder_code: string; guest_id: string | null;
  customer_name: string; phone: string | null; email: string | null; requested_for: string;
  source_channel: string; customer_note: string | null; status: string; total_amount: number;
  environment: string; created_at: string; updated_at: string;
};
type PreorderItemRow = { menu_name: string; quantity: number; unit_price: number; line_total: number };
type NotificationChannel = { id: string; target_id_enc: string };

type PreorderCreateResult = {
  id: string; preorderCode: string; totalAmount: number; status: string;
  items: Array<{ name: string; quantity: number }>;
  requestedFor: string; environment: string; duplicate?: boolean;
};

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function publicDbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`restaurant_public_db_${response.status}:${body.slice(0, 250)}`);
  }
  return response;
}

async function chartDbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  const method = (init.method ?? 'GET').toUpperCase();
  const profileHeaders = method === 'GET' || method === 'HEAD'
    ? { 'Accept-Profile': RESTAURANT_SCHEMA }
    : { 'Content-Profile': RESTAURANT_SCHEMA, 'Accept-Profile': RESTAURANT_SCHEMA };
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json',
      ...profileHeaders, ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`restaurant_db_${response.status}:${body.slice(0, 320)}`);
  }
  return response;
}

let cachedRestaurantId = '';
export async function restaurantId(): Promise<string> {
  if (cachedRestaurantId) return cachedRestaurantId;
  const response = await chartDbFetch(`restaurants?name=eq.${encodeURIComponent(RESTAURANT_NAME)}&select=id&order=created_at.asc&limit=1`);
  const row = (await response.json() as Array<{ id: string }>)[0];
  if (!row?.id) throw new Error('restaurant_not_found');
  cachedRestaurantId = row.id;
  return row.id;
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

export async function listRestaurantMenu(): Promise<RestaurantMenuItem[]> {
  const rid = await restaurantId();
  const response = await chartDbFetch(
    `restaurant_menu_live?restaurant_id=eq.${rid}`
    + '&select=menu_item_id,category_name,category_sort_order,sort_order,name,selling_price,description,is_signature,ingredient_names,unavailable_ingredients,available_servings,is_orderable,source_updated_at'
    + '&order=category_sort_order.asc,sort_order.asc',
  );
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map(row => ({
    menu_item_id: String(row.menu_item_id), category_name: String(row.category_name),
    category_sort_order: Number(row.category_sort_order), sort_order: Number(row.sort_order), name: String(row.name),
    selling_price: Number(row.selling_price), description: typeof row.description === 'string' ? row.description : null,
    is_signature: row.is_signature === true, ingredient_names: cleanList(row.ingredient_names),
    unavailable_ingredients: cleanList(row.unavailable_ingredients), available_servings: Number(row.available_servings ?? 0),
    is_orderable: row.is_orderable === true, source_updated_at: String(row.source_updated_at ?? new Date().toISOString()),
  }));
}

export async function loadRestaurantWorldFacts(): Promise<Array<{ fact_key: string; category: string; fact_value: unknown; source: string; updated_at: string }>> {
  try {
    const menu = await listRestaurantMenu();
    const updatedAt = menu.reduce((latest, item) => item.source_updated_at > latest ? item.source_updated_at : latest, new Date(0).toISOString());
    return [{
      fact_key: 'restaurant_menu_live', category: 'operations', source: 'tamma_chart_os.restaurant_menu_live', updated_at: updatedAt,
      fact_value: {
        restaurant: RESTAURANT_NAME, menuUrl: RESTAURANT_MENU_URL, sourceOfTruth: true,
        items: menu.map(item => ({
          id: item.menu_item_id, category: item.category_name, name: item.name, price: item.selling_price,
          signature: item.is_signature, orderable: item.is_orderable, availableServings: item.available_servings,
          ingredients: item.ingredient_names, unavailableIngredients: item.unavailable_ingredients,
        })),
      },
    }];
  } catch (error) {
    console.error('RESTAURANT_WORLD_FACT_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return [];
  }
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[()•·.,/\\_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ingredients(): Promise<IngredientMaster[]> {
  const rid = await restaurantId();
  const response = await chartDbFetch(`ingredients?restaurant_id=eq.${rid}&status=eq.${encodeURIComponent('ใช้งาน')}&select=id,name,base_unit,purchase_unit,conversion_factor&order=name.asc`);
  return await response.json() as IngredientMaster[];
}

async function resolveIngredient(name: string): Promise<IngredientMaster | null> {
  const needle = normalized(name.replace(/^(ของหมด|หมด|ของเข้า|รับของ|เติมสต๊อก|สต๊อก|เช็กสต๊อก)\s*/u, ''));
  if (!needle) return null;
  const all = await ingredients();
  const exact = all.find(item => normalized(item.name) === needle);
  if (exact) return exact;
  const aliases: Record<string, string> = {
    'ปลาร้า': 'น้ำปลาร้า', 'แจ่ว': 'น้ำจิ้มแจ่ว', 'น้ำแจ่ว': 'น้ำจิ้มแจ่ว',
    'ข้าวสวย': 'ข้าวหอมมะลิ', 'แตง': 'แตงกวา', 'มะละกอ': 'มะละกอดิบ',
  };
  const alias = aliases[needle];
  if (alias) return all.find(item => item.name === alias) ?? null;
  const candidates = all.filter(item => normalized(item.name).includes(needle) || needle.includes(normalized(item.name)));
  return candidates.length === 1 ? candidates[0] : null;
}

async function stockByIngredientId(id: string): Promise<IngredientStock | null> {
  const rid = await restaurantId();
  const response = await chartDbFetch(`ingredient_stock_live?restaurant_id=eq.${rid}&ingredient_id=eq.${id}&select=*&limit=1`);
  return (await response.json() as IngredientStock[])[0] ?? null;
}

async function rpc<T>(name: string, body: Json): Promise<T> {
  const response = await chartDbFetch(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  return await response.json() as T;
}

async function restaurantTeamBound(targetId: string): Promise<boolean> {
  const hash = piiHash(targetId);
  if (!hash) return false;
  const response = await publicDbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&team_code=eq.restaurant&enabled=eq.true&select=id&limit=1`,
  );
  return (await response.json() as unknown[]).length > 0;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}

function unitMultiplier(inputUnit: string, ingredient: IngredientMaster): number {
  const unit = normalized(inputUnit);
  if (!unit || unit === normalized(ingredient.base_unit)) return 1;
  if (unit === normalized(ingredient.purchase_unit)) return Number(ingredient.conversion_factor) || 1;
  if (/^(กก|กิโล|กิโลกรัม)$/.test(unit) && /กก/.test(ingredient.base_unit)) return 1;
  if (/^(ลิตร|ล)$/.test(unit) && /มล/.test(ingredient.base_unit)) return 1000;
  if (/^(มล|มิลลิลิตร)$/.test(unit) && /มล/.test(ingredient.base_unit)) return 1;
  if (/^(แผง)$/.test(unit) && /แผง/.test(ingredient.purchase_unit)) return Number(ingredient.conversion_factor) || 1;
  if (/^(ขวด)$/.test(unit) && /ขวด/.test(ingredient.base_unit)) return 1;
  if (/^(ลูก|ฟอง)$/.test(unit) && normalized(ingredient.base_unit) === unit) return 1;
  return 1;
}

export async function handleRestaurantStockText(input: { targetId: string; text: string }): Promise<string | null> {
  if (!(await restaurantTeamBound(input.targetId))) return null;
  const text = input.text.trim().replace(/\s+/g, ' ');

  if (/^(ของใกล้หมด|ใกล้หมด|เช็กของใกล้หมด)$/u.test(text)) {
    const rid = await restaurantId();
    const response = await chartDbFetch(`ingredient_stock_live?restaurant_id=eq.${rid}&stock_status=neq.${encodeURIComponent('พร้อมใช้')}&select=name,base_unit,available,stock_status&order=available.asc&limit=15`);
    const rows = await response.json() as Array<{ name:string;base_unit:string;available:number;stock_status:string }>;
    if (!rows.length) return '✅ ตอนนี้วัตถุดิบหลักยังพอใช้ทั้งหมดครับ';
    return ['📦 ของที่ต้องดู', ...rows.map(row => `• ${row.name}: ${formatQty(Number(row.available))} ${row.base_unit} (${row.stock_status})`)].join('\n');
  }

  const stockMatch = text.match(/^(?:สต๊อก|เช็กสต๊อก|ดูสต๊อก)\s+(.+)$/u);
  if (stockMatch) {
    const ingredient = await resolveIngredient(stockMatch[1]);
    if (!ingredient) return 'หาไม่เจอครับ ลองพิมพ์ชื่อวัตถุดิบตรง ๆ เช่น “สต๊อก ไก่บ้าน”';
    const row = await stockByIngredientId(ingredient.id);
    if (!row) return `ยังไม่มีข้อมูลสต๊อก ${ingredient.name} ครับ`;
    return `📦 ${ingredient.name}\nเหลือใช้: ${formatQty(Number(row.available))} ${row.base_unit}\nสถานะ: ${row.stock_status}`;
  }

  let outName: string | null = null;
  let match = text.match(/^(?:ของหมด|หมด)\s+(.+)$/u);
  if (match) outName = match[1];
  if (!outName) {
    match = text.match(/^(.+?)(?:\s+)?หมด(?:แล้ว)?$/u);
    if (match && !/งาน|เวลา|วันนี้/u.test(match[1])) outName = match[1];
  }
  if (outName) {
    const ingredient = await resolveIngredient(outName);
    if (!ingredient) return `หา “${outName}” ในวัตถุดิบไม่เจอครับ ลองพิมพ์ชื่อให้ตรงอีกนิด`;
    const rid = await restaurantId();
    const result = await rpc<{ affectedMenus?: string[] }>('restaurant_set_stock_by_name', {
      p_restaurant_id: rid, p_ingredient_name: ingredient.name, p_quantity: 0, p_reason: 'พนักงานแจ้งของหมดใน LINE',
    });
    const affected = Array.isArray(result.affectedMenus) ? result.affectedMenus : [];
    return [
      `✅ อัปเดตแล้ว: ${ingredient.name} หมด`,
      affected.length ? `หยุดขายชั่วคราว ${affected.length} เมนู:\n${affected.map(x => `• ${x}`).join('\n')}` : 'ยังไม่มีเมนูที่ต้องหยุดขาย',
      'หลังบ้าน + หน้าเมนูลูกค้า + ทองไทยอัปเดตจากข้อมูลเดียวกันแล้ว',
    ].join('\n');
  }

  const inMatch = text.match(/^(?:ของเข้า|รับของ|เติมสต๊อก)\s+(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*([^0-9]*)$/u);
  if (inMatch) {
    const ingredient = await resolveIngredient(inMatch[1]);
    if (!ingredient) return `หา “${inMatch[1]}” ในวัตถุดิบไม่เจอครับ`;
    const amount = Number(inMatch[2]);
    if (!Number.isFinite(amount) || amount <= 0) return 'จำนวนต้องมากกว่า 0 ครับ';
    const baseQuantity = amount * unitMultiplier(inMatch[3].trim(), ingredient);
    const rid = await restaurantId();
    const result = await rpc<{ onHand?: number }>('restaurant_add_stock_by_name', {
      p_restaurant_id: rid, p_ingredient_name: ingredient.name, p_quantity: baseQuantity, p_reason: 'พนักงานแจ้งรับของใน LINE',
    });
    const row = await stockByIngredientId(ingredient.id);
    return `✅ รับของแล้ว: ${ingredient.name} +${formatQty(baseQuantity)} ${ingredient.base_unit}\nเหลือใช้ตอนนี้: ${formatQty(Number(row?.available ?? result.onHand ?? 0))} ${ingredient.base_unit}\nเมนูลูกค้าและทองไทยอัปเดตแล้ว`;
  }

  return null;
}

function resolveMenuName(input: string, menu: RestaurantMenuItem[]): RestaurantMenuItem | null {
  const needle = normalized(input);
  const exact = menu.find(item => normalized(item.name) === needle);
  if (exact) return exact;
  const candidates = menu.filter(item => normalized(item.name).includes(needle) || needle.includes(normalized(item.name)));
  return candidates.length === 1 ? candidates[0] : null;
}

async function guestEnvironment(guestDbId: string): Promise<'live'|'test'> {
  const response = await publicDbFetch(`customer_accounts?guest_id=eq.${guestDbId}&select=is_test&limit=1`);
  return (await response.json() as Array<{ is_test:boolean }>)[0]?.is_test ? 'test' : 'live';
}

export async function createRestaurantPreorder(input: {
  guestDbId: string; channel: string; date: string; time: string;
  items: Array<{ name: string; quantity: number }>;
  customerName: string; phone?: string | null; email?: string | null; note?: string | null;
}): Promise<PreorderCreateResult> {
  const requestedFor = new Date(`${input.date}T${input.time}:00+07:00`);
  if (Number.isNaN(requestedFor.valueOf())) throw new Error('invalid_requested_time');
  const menu = await listRestaurantMenu();
  const resolved = input.items.map(item => ({ menu: resolveMenuName(item.name, menu), quantity: Math.max(1, Math.min(50, Math.floor(item.quantity || 1))) }));
  if (resolved.some(item => !item.menu)) throw new Error('menu_item_not_found');
  for (const item of resolved) {
    if (!item.menu!.is_orderable || item.menu!.available_servings < item.quantity) throw new Error(`menu_item_unavailable:${item.menu!.name}`);
  }
  const environment = await guestEnvironment(input.guestDbId);
  const canonicalItems = resolved
    .map(item => ({ menuItemId:item.menu!.menu_item_id, quantity:item.quantity }))
    .sort((a,b) => a.menuItemId.localeCompare(b.menuItemId));
  const idempotencyKey = 'restaurant-preorder:v2:' + createHash('sha256').update(JSON.stringify({
    guestDbId:input.guestDbId, requestedFor:requestedFor.toISOString(), items:canonicalItems,
    customerName:input.customerName.trim().toLowerCase(), note:(input.note ?? '').trim(), environment,
  })).digest('hex');
  const rid = await restaurantId();
  const created = await rpc<{ id:string; preorderCode:string; totalAmount:number; status:string; duplicate?:boolean }>('create_restaurant_preorder_v2', {
    p_restaurant_id: rid, p_requested_for: requestedFor.toISOString(), p_customer_name: input.customerName,
    p_phone: input.phone ?? '', p_email: input.email ?? '', p_source_channel: input.channel,
    p_customer_note: input.note ?? '', p_items: canonicalItems, p_guest_id:input.guestDbId,
    p_environment:environment, p_idempotency_key:idempotencyKey,
  });
  const result: PreorderCreateResult = {
    ...created, items: resolved.map(item => ({ name:item.menu!.name, quantity:item.quantity })),
    requestedFor: requestedFor.toISOString(), environment,
  };
  await notifyRestaurantPreorderTeam(created.id).catch(error => {
    console.error('RESTAURANT_PREORDER_NOTIFY_ERROR', error instanceof Error ? error.message.slice(0,220) : 'unknown');
  });
  return result;
}

async function preorderById(id: string): Promise<PreorderRow | null> {
  const response = await chartDbFetch(`restaurant_preorders?id=eq.${id}&select=*&limit=1`);
  return (await response.json() as PreorderRow[])[0] ?? null;
}
async function preorderItems(id: string): Promise<PreorderItemRow[]> {
  const response = await chartDbFetch(`restaurant_preorder_items?preorder_id=eq.${id}&select=menu_name,quantity,unit_price,line_total&order=created_at.asc`);
  return await response.json() as PreorderItemRow[];
}

/**
 * Item-breakdown + pickup-time composition for the generic _payments.ts
 * customer message — used only when payment_requests.entity_type =
 * 'restaurant_preorder'. Reuses preorderById/preorderItems/thaiDateTime
 * (the same queries and formatting the restaurant team's order card already
 * uses) rather than duplicating a second read of the same source of truth.
 */
export async function restaurantPreorderPaymentSummary(
  preorderId: string,
): Promise<{ itemLines: string[]; pickupText: string } | null> {
  const preorder = await preorderById(preorderId);
  if (!preorder) return null;
  const items = await preorderItems(preorderId);
  return {
    itemLines: items.map(item => `${item.menu_name} × ${item.quantity} = ${Number(item.line_total).toFixed(0)} บาท`),
    pickupText: thaiDateTime(preorder.requested_for),
  };
}

function thaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH',{ timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value));
}
function statusLabel(status: string): string {
  return ({ requested:'รอร้านรับออเดอร์',confirmed:'รับออเดอร์แล้ว',preparing:'กำลังทำ',ready:'พร้อมรับ',completed:'ส่งมอบแล้ว',cancelled:'ยกเลิกแล้ว' } as Record<string,string>)[status] ?? status;
}
function postback(action: string, id: string): string { return `rpo=${action}&id=${encodeURIComponent(id)}`; }

async function preorderFlex(preorder: PreorderRow): Promise<Json> {
  const items = await preorderItems(preorder.id);
  const buttons: Json[] = [];
  const button = (label:string, action:string, style:'primary'|'secondary'='secondary'):Json => ({
    type:'button',style,margin:'sm',height:'sm',action:{type:'postback',label,data:postback(action,preorder.id),displayText:label},
  });
  if (preorder.status==='requested') buttons.push(button('✅ รับออเดอร์','confirm','primary'),button('❌ ยกเลิก','cancel_prompt'));
  if (preorder.status==='confirmed') buttons.push(button('👩‍🍳 เริ่มทำ','preparing','primary'),button('❌ ยกเลิก','cancel_prompt'));
  if (preorder.status==='preparing') buttons.push(button('🛎 พร้อมรับ','ready','primary'),button('❌ ยกเลิก','cancel_prompt'));
  if (preorder.status==='ready') buttons.push(button('✅ ส่งมอบแล้ว','complete_prompt','primary'),button('❌ ยกเลิก','cancel_prompt'));
  const prefix = preorder.environment==='test' ? '🧪 TEST • ' : '';
  return {
    type:'flex',altText:`${prefix}ออเดอร์ล่วงหน้า ${preorder.preorder_code}`,
    contents:{type:'bubble',header:{type:'box',layout:'vertical',backgroundColor:'#6B7A4E',paddingAll:'18px',contents:[
      {type:'text',text:`${prefix}🍽️ ${statusLabel(preorder.status)}`,color:'#FFFFFF',weight:'bold',size:'lg'},
      {type:'text',text:'ตำมา-ชาติ',color:'#F4EEDC',size:'sm',margin:'sm'},
    ]},body:{type:'box',layout:'vertical',spacing:'md',paddingAll:'18px',contents:[
      {type:'text',text:`รับอาหาร: ${thaiDateTime(preorder.requested_for)}`,weight:'bold',wrap:true},
      {type:'text',text:`ลูกค้า: ${preorder.customer_name}`,wrap:true},
      ...(preorder.phone ? [{type:'text',text:`โทร: ${preorder.phone}`,size:'sm',wrap:true}] : []),
      {type:'separator'},
      ...items.map(item => ({type:'text',text:`${item.quantity} × ${item.menu_name}  ${Number(item.line_total).toFixed(0)} บาท`,wrap:true,size:'sm'})),
      {type:'separator'},
      {type:'text',text:`รวม ${Number(preorder.total_amount).toFixed(0)} บาท`,weight:'bold',align:'end'},
      ...(preorder.customer_note ? [{type:'text',text:`หมายเหตุ: ${preorder.customer_note}`,size:'sm',wrap:true,color:'#6B6B6B'}] : []),
      {type:'text',text:`อ้างอิง ${preorder.preorder_code}`,size:'xs',color:'#999999'},
    ]},...(buttons.length ? {footer:{type:'box',layout:'vertical',spacing:'sm',paddingAll:'14px',contents:buttons}} : {})},
  };
}

async function restaurantChannel(): Promise<NotificationChannel | null> {
  const response = await publicDbFetch('ops_notification_channels?team_code=eq.restaurant&provider=eq.line&enabled=eq.true&select=id,target_id_enc&limit=1');
  return (await response.json() as NotificationChannel[])[0] ?? null;
}

async function linePush(targetId: string, messages: Json[]): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN missing');
  const response = await fetch(LINE_PUSH_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({to:targetId,messages:messages.slice(0,5)})});
  if (!response.ok) throw new Error(`line_push_${response.status}`);
}

export async function notifyRestaurantPreorderTeam(preorderId: string): Promise<'sent'|'duplicate'|'not_bound'> {
  const preorder = await preorderById(preorderId);
  if (!preorder) throw new Error('preorder_not_found');
  const channel = await restaurantChannel();
  if (!channel) return 'not_bound';
  const targetId = decryptPii(channel.target_id_enc);
  if (!targetId) throw new Error('restaurant_line_target_invalid');
  const key = `restaurant_preorder_created:${preorder.id}:restaurant`;
  const insert = await publicDbFetch('ops_notification_deliveries?on_conflict=idempotency_key',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({
    channel_id:channel.id,entity_type:'restaurant_preorder',entity_id:preorder.id,idempotency_key:key,delivery_type:'restaurant_preorder_created',provider:'line',status:'pending',payload:{preorder_code:preorder.preorder_code,ui:'restaurant-preorder-flex-v1'},
  })});
  const delivery = (await insert.json() as Array<{id:string}>)[0];
  if (!delivery?.id) return 'duplicate';
  try {
    await linePush(targetId,[await preorderFlex(preorder)]);
    await publicDbFetch(`ops_notification_deliveries?id=eq.${delivery.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'sent',error_message:null})});
    return 'sent';
  } catch(error) {
    await publicDbFetch(`ops_notification_deliveries?id=eq.${delivery.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'failed',error_message:error instanceof Error ? error.message.slice(0,300) : 'unknown'})}).catch(()=>undefined);
    throw error;
  }
}

async function customerLineTarget(guestId: string | null): Promise<string | null> {
  if (!guestId) return null;
  const accountRes = await publicDbFetch(`customer_accounts?guest_id=eq.${guestId}&select=id&limit=1`);
  const account = (await accountRes.json() as Array<{id:string}>)[0];
  if (!account) return null;
  const contactRes = await publicDbFetch(`customer_channel_contacts?customer_id=eq.${account.id}&provider=eq.line&reachable=eq.true&verified=eq.true&select=external_id_enc&order=last_seen_at.desc&limit=1`);
  const contact = (await contactRes.json() as Array<{external_id_enc:string}>)[0];
  return decryptPii(contact?.external_id_enc) ?? null;
}

async function notifyPreorderCustomer(preorder: PreorderRow): Promise<boolean> {
  const target = await customerLineTarget(preorder.guest_id);
  if (!target) return false;
  const items = await preorderItems(preorder.id);
  const text = [
    `${preorder.environment==='test'?'🧪 TEST — ':''}🍽️ ทองไทยอัปเดตออเดอร์ ${preorder.preorder_code}`,
    `สถานะ: ${statusLabel(preorder.status)}`,
    `รับอาหาร: ${thaiDateTime(preorder.requested_for)}`,
    ...items.map(item=>`${item.quantity} × ${item.menu_name}`),
    `รวม ${Number(preorder.total_amount).toFixed(0)} บาท`,
  ].join('\n');
  await linePush(target,[{type:'text',text}]);
  return true;
}

export async function handleRestaurantPreorderPostback(input:{targetId:string;data:string}):Promise<Json[]|null> {
  if (!(await restaurantTeamBound(input.targetId))) return null;
  const params = new URLSearchParams(input.data);
  const action = params.get('rpo'); const id = params.get('id');
  if (!action || !id) return null;
  const preorder = await preorderById(id);
  if (!preorder) return [{type:'text',text:'หาออเดอร์นี้ไม่เจอครับ'}];
  if (action==='cancel_prompt') return [{type:'template',altText:'ยืนยันยกเลิกออเดอร์',template:{type:'confirm',text:`ยกเลิก ${preorder.preorder_code} ใช่ไหม?`,actions:[{type:'postback',label:'ใช่ ยกเลิก',data:postback('cancel',id),displayText:'ยืนยันยกเลิก'},{type:'postback',label:'ไม่ยกเลิก',data:postback('refresh',id),displayText:'ไม่ยกเลิก'}]}}];
  if (action==='complete_prompt') return [{type:'template',altText:'ยืนยันส่งมอบออเดอร์',template:{type:'confirm',text:`ส่งมอบ ${preorder.preorder_code} แล้วใช่ไหม?`,actions:[{type:'postback',label:'ใช่ ส่งมอบแล้ว',data:postback('completed',id),displayText:'ยืนยันส่งมอบแล้ว'},{type:'postback',label:'ยัง',data:postback('refresh',id),displayText:'ยังไม่ส่งมอบ'}]}}];
  const statusMap:Record<string,string>={confirm:'confirmed',preparing:'preparing',ready:'ready',completed:'completed',cancel:'cancelled'};
  if (action==='refresh') return [await preorderFlex(preorder)];
  const next=statusMap[action]; if (!next) return null;
  await rpc('set_restaurant_preorder_status',{p_preorder_id:id,p_status:next});
  const fresh=await preorderById(id); if (!fresh) return [{type:'text',text:'อัปเดตแล้วครับ'}];
  const sent=await notifyPreorderCustomer(fresh).catch(()=>false);
  return [{type:'text',text:`✅ ${statusLabel(fresh.status)}${sent?' · แจ้งลูกค้าแล้ว':''}`},await preorderFlex(fresh)];
}
