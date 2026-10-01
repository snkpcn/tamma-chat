import { randomUUID } from 'node:crypto';
import { decryptPii, encryptPii } from './_operations-db';
import {
  addressSnapshot,
  calculateShippingQuote,
  normalizeMemberAddress,
  type MemberAddressInput,
  type ShippingSettings,
} from './_member-delivery';
import { resolveOtopStoreStory } from './_otop-store-story';
import { completedUnitsByProduct } from './_otop-merchandising';
import { ALL_OTOP_PRODUCTS } from '../../src/data/otop';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKU_RE = /^[A-Z0-9][A-Z0-9_-]{2,79}$/;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  if (!c) throw new Error('Operations database is not configured');
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Member delivery database request failed ${response.status}: ${body.slice(0, 240)}`);
  }
  return response;
}

type AccountRow = { id: string; guest_id: string | null; phone_enc: string | null; full_name_enc: string | null };

async function memberAccount(authUserId: string): Promise<AccountRow> {
  if (!UUID_RE.test(authUserId)) throw new Error('authentication_required');
  const response = await dbFetch(
    `customer_accounts?auth_user_id=eq.${encodeURIComponent(authUserId)}`
    + '&member_status=eq.member&select=id,guest_id,phone_enc,full_name_enc&limit=1',
  );
  const rows = await response.json() as AccountRow[];
  if (!rows[0]) throw new Error('member_profile_required');
  return rows[0];
}

type AddressRow = {
  id: string;
  label: string;
  recipient_name_enc: string;
  phone_enc: string;
  address_line1_enc: string;
  address_line2_enc: string | null;
  subdistrict_enc: string | null;
  district_enc: string;
  province: string;
  postal_code_enc: string;
  delivery_instructions_enc: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

function addressOutput(row: AddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipientName: decryptPii(row.recipient_name_enc),
    phone: decryptPii(row.phone_enc),
    addressLine1: decryptPii(row.address_line1_enc),
    addressLine2: decryptPii(row.address_line2_enc),
    subdistrict: decryptPii(row.subdistrict_enc),
    district: decryptPii(row.district_enc),
    province: row.province,
    postalCode: decryptPii(row.postal_code_enc),
    deliveryInstructions: decryptPii(row.delivery_instructions_enc),
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ADDRESS_SELECT = [
  'id', 'label', 'recipient_name_enc', 'phone_enc', 'address_line1_enc',
  'address_line2_enc', 'subdistrict_enc', 'district_enc', 'province',
  'postal_code_enc', 'delivery_instructions_enc', 'is_default', 'created_at', 'updated_at',
].join(',');

export async function listMemberAddresses(authUserId: string) {
  const account = await memberAccount(authUserId);
  const response = await dbFetch(
    `customer_addresses?customer_id=eq.${account.id}&active=eq.true`
    + `&select=${ADDRESS_SELECT}&order=is_default.desc,created_at.desc`,
  );
  const rows = await response.json() as AddressRow[];
  return rows.map(addressOutput);
}

export async function saveMemberAddress(
  authUserId: string,
  value: unknown,
  addressId?: string | null,
) {
  const account = await memberAccount(authUserId);
  const address = normalizeMemberAddress(value);
  let id = addressId && UUID_RE.test(addressId) ? addressId : null;

  if (id) {
    const ownerResponse = await dbFetch(
      `customer_addresses?id=eq.${id}&customer_id=eq.${account.id}&active=eq.true&select=id&limit=1`,
    );
    const ownerRows = await ownerResponse.json() as Array<{ id: string }>;
    if (!ownerRows[0]) throw new Error('address_not_found');
  }

  const countResponse = await dbFetch(
    `customer_addresses?customer_id=eq.${account.id}&active=eq.true&select=id`,
    { headers: { Prefer: 'count=exact' } },
  );
  const existingAddresses = await countResponse.json() as Array<{ id: string }>;
  const shouldDefault = address.isDefault || existingAddresses.length === 0;
  if (shouldDefault) {
    await dbFetch(`customer_addresses?customer_id=eq.${account.id}&is_default=eq.true`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }),
    });
  }

  const body = {
    customer_id: account.id,
    label: address.label,
    recipient_name_enc: encryptPii(address.recipientName),
    phone_enc: encryptPii(address.phone),
    address_line1_enc: encryptPii(address.addressLine1),
    address_line2_enc: encryptPii(address.addressLine2),
    subdistrict_enc: encryptPii(address.subdistrict),
    district_enc: encryptPii(address.district),
    province: address.province,
    postal_code_enc: encryptPii(address.postalCode),
    delivery_instructions_enc: encryptPii(address.deliveryInstructions),
    is_default: shouldDefault,
    active: true,
    updated_at: new Date().toISOString(),
  };

  let response: Response;
  if (id) {
    response = await dbFetch(`customer_addresses?id=eq.${id}&customer_id=eq.${account.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
  } else {
    response = await dbFetch('customer_addresses', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
  }
  const rows = await response.json() as AddressRow[];
  if (!rows[0]) throw new Error('address_not_saved');
  id = rows[0].id;
  return addressOutput(rows[0]);
}

export async function deleteMemberAddress(authUserId: string, addressId: string) {
  if (!UUID_RE.test(addressId)) throw new Error('address_not_found');
  const account = await memberAccount(authUserId);
  const response = await dbFetch(
    `customer_addresses?id=eq.${addressId}&customer_id=eq.${account.id}&active=eq.true`
    + '&select=id,is_default&limit=1',
  );
  const rows = await response.json() as Array<{ id: string; is_default: boolean }>;
  if (!rows[0]) throw new Error('address_not_found');
  await dbFetch(`customer_addresses?id=eq.${addressId}&customer_id=eq.${account.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ active: false, is_default: false, updated_at: new Date().toISOString() }),
  });
  if (rows[0].is_default) {
    const nextResponse = await dbFetch(
      `customer_addresses?customer_id=eq.${account.id}&active=eq.true`
      + '&select=id&order=created_at.desc&limit=1',
    );
    const next = await nextResponse.json() as Array<{ id: string }>;
    if (next[0]) {
      await dbFetch(`customer_addresses?id=eq.${next[0].id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_default: true, updated_at: new Date().toISOString() }),
      });
    }
  }
  return { deleted: true };
}

export type StoreItem = { sku: string; quantity: number };

export function normalizeStoreItems(value: unknown): StoreItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Error('invalid_items');
  const grouped = new Map<string, number>();
  for (const candidate of value) {
    const row = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
    const sku = typeof row.sku === 'string' ? row.sku.trim().toUpperCase() : '';
    const quantity = Number(row.quantity);
    if (!SKU_RE.test(sku) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error('invalid_items');
    }
    grouped.set(sku, (grouped.get(sku) ?? 0) + quantity);
  }
  const items = [...grouped.entries()].map(([sku, quantity]) => ({ sku, quantity }));
  if (items.some(item => item.quantity > 99)) throw new Error('invalid_items');
  return items;
}

export async function loadShippingSettings(): Promise<ShippingSettings> {
  const response = await dbFetch(
    'otop_shipping_settings?id=eq.default'
    + '&select=enabled,domestic_base_fee,free_shipping_threshold,estimated_min_days,estimated_max_days&limit=1',
  );
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) throw new Error('shipping_settings_missing');
  return {
    enabled: row.enabled === true,
    domesticBaseFee: Number(row.domestic_base_fee),
    freeShippingThreshold: row.free_shipping_threshold === null ? null : Number(row.free_shipping_threshold),
    estimatedMinDays: Number(row.estimated_min_days),
    estimatedMaxDays: Number(row.estimated_max_days),
  };
}

async function loadOtopCompletedUnits(): Promise<Map<string, number>> {
  const completedResponse = await dbFetch(
    'otop_orders?environment=eq.live&status=eq.completed&select=id&limit=1000',
  );
  const completedOrders = await completedResponse.json() as Array<{ id: string }>;
  const ids = completedOrders.map(order => order.id).filter(id => UUID_RE.test(id));
  if (!ids.length) return new Map();
  const itemResponse = await dbFetch(
    `otop_order_items?order_id=in.(${ids.map(encodeURIComponent).join(',')})&select=order_id,product_id,quantity&limit=5000`,
  );
  const items = await itemResponse.json() as Array<{ order_id: string; product_id: string; quantity: number | string }>;
  return completedUnitsByProduct(ids, items);
}

export async function loadOtopStoreCatalog() {
  const [productResponse, settings, completedUnits] = await Promise.all([
    dbFetch(
      'otop_products?environment=eq.live&active=eq.true&verified=eq.true&stock_qty=gt.0'
      + '&select=id,sku,name,description,price,stock_qty,metadata,otop_product_images(public_url,alt_text,sort_order,is_primary)'
      + '&order=sku.asc',
    ),
    loadShippingSettings(),
    loadOtopCompletedUnits(),
  ]);
  const products = await productResponse.json() as Array<Record<string, unknown> & {
    otop_product_images?: Array<Record<string, unknown>>;
  }>;
  return {
    products: products.map(row => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
      const resolvedStory = resolveOtopStoreStory(
        { id: String(row.id), name: String(row.name), metadata },
        ALL_OTOP_PRODUCTS,
      );
      return {
        sku: String(row.sku),
        name: String(row.name),
        description: typeof row.description === 'string' ? row.description : null,
        price: Number(row.price),
        stock: Number(row.stock_qty),
        completedUnits: completedUnits.get(String(row.id)) ?? 0,
        metadata,
        story: resolvedStory.story,
        storySource: resolvedStory.source,
        catalogProductId: resolvedStory.catalogProductId,
        images: (Array.isArray(row.otop_product_images) ? row.otop_product_images : [])
          .map(image => ({
            url: typeof image.public_url === 'string' ? image.public_url : '',
            alt: typeof image.alt_text === 'string' ? image.alt_text : String(row.name),
            position: Number(image.sort_order),
            primary: image.is_primary === true,
          }))
          .filter(image => /^https:\/\//i.test(image.url))
          .sort((a, b) => Number(b.primary) - Number(a.primary) || a.position - b.position)
          .slice(0, 4),
      };
    }),
    shipping: settings,
  };
}

async function authoritativeSubtotal(items: StoreItem[]) {
  const skus = items.map(item => encodeURIComponent(item.sku)).join(',');
  const response = await dbFetch(
    `otop_products?environment=eq.live&active=eq.true&verified=eq.true&sku=in.(${skus})`
    + '&select=sku,price,stock_qty',
  );
  const products = await response.json() as Array<{ sku: string; price: number | string; stock_qty: number }>;
  const bySku = new Map(products.map(product => [product.sku, product]));
  let subtotal = 0;
  for (const item of items) {
    const product = bySku.get(item.sku);
    if (!product) throw new Error(`product_not_available:${item.sku}`);
    if (Number(product.stock_qty) < item.quantity) throw new Error(`insufficient_stock:${item.sku}`);
    subtotal += Number(product.price) * item.quantity;
  }
  return subtotal;
}

export async function checkoutMemberOtopOrder(authUserId: string, value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const account = await memberAccount(authUserId);
  const items = normalizeStoreItems(input.items);
  const addressId = typeof input.addressId === 'string' && UUID_RE.test(input.addressId)
    ? input.addressId : null;
  if (!addressId) throw new Error('shipping_address_required');

  const addressResponse = await dbFetch(
    `customer_addresses?id=eq.${addressId}&customer_id=eq.${account.id}&active=eq.true`
    + `&select=${ADDRESS_SELECT}&limit=1`,
  );
  const addressRows = await addressResponse.json() as AddressRow[];
  if (!addressRows[0]) throw new Error('shipping_address_not_found');
  const outputAddress = addressOutput(addressRows[0]);
  const normalizedAddress = normalizeMemberAddress(outputAddress);
  const [subtotal, settings] = await Promise.all([
    authoritativeSubtotal(items),
    loadShippingSettings(),
  ]);
  const quote = calculateShippingQuote(subtotal, settings);
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.length >= 16
    ? input.idempotencyKey.slice(0, 120) : randomUUID();
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : null;

  const rpcResponse = await dbFetch('rpc/create_member_otop_order_v1', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      p_customer_id: account.id,
      p_guest_id: account.guest_id,
      p_items: items,
      p_shipping_address_id: addressId,
      p_shipping_recipient_name_enc: encryptPii(normalizedAddress.recipientName),
      p_shipping_phone_enc: encryptPii(normalizedAddress.phone),
      p_shipping_address_enc: encryptPii(addressSnapshot(normalizedAddress)),
      p_customer_note: note,
      p_shipping_fee: quote.shippingFee,
      p_checkout_idempotency_key: idempotencyKey,
      p_environment: 'live',
    }),
  });
  const rows = await rpcResponse.json() as Array<Record<string, unknown>>;
  const order = rows[0];
  if (!order) throw new Error('order_not_created');
  return {
    orderCode: order.order_code,
    subtotal: Number(order.subtotal),
    shippingFee: Number(order.shipping_fee),
    total: Number(order.total),
    paymentCode: order.payment_code,
    shippingStatus: order.shipping_status,
    estimatedMinDays: settings.estimatedMinDays,
    estimatedMaxDays: settings.estimatedMaxDays,
  };
}
