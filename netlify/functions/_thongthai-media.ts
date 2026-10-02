import type { ChatTurn } from './_thongthai-brain-v3';

export type CustomerMediaImage = {
  type: 'image';
  url: string;
  deliveryUrl: string;
  alt: string;
  source: 'otop_product_images';
  sku: string;
  productName: string;
  primary: boolean;
};

type CatalogImage = { url:string; alt:string; position:number; primary:boolean };
export type MediaCatalogProduct = { sku:string; name:string; images:CatalogImage[] };

const IMAGE_REQUEST_RE = /(?:ขอดูรูป|ดูรูป|มีรูป|ขอรูป|อยากเห็นรูป|รูป.*หน่อย|ภาพ.*หน่อย|show\s+(?:me\s+)?(?:a\s+)?(?:photo|picture|image)|(?:photo|picture|image)s?\s+of|看.*(?:图片|照片)|(?:图片|照片).*看看|ຂໍເບິ່ງຮູບ|ເບິ່ງຮູບ|cho\s+(?:tôi\s+)?xem\s+(?:ảnh|hình)|xem\s+(?:ảnh|hình))/iu;
const ALL_IMAGES_RE = /(?:รูปทั้งหมด|ทุกรูป|ทุกมุม|หลายรูป|หลายมุม|all\s+(?:photos|pictures|images)|more\s+(?:photos|pictures|images)|所有.*(?:图片|照片)|ຮູບທັງໝົດ|ຫຼາຍຮູບ|tất\s+cả\s+(?:ảnh|hình)|nhiều\s+(?:ảnh|hình))/iu;
const REFERENTIAL_RE = /(?:อันนี้|ตัวนี้|ชิ้นนี้|ของมัน|รูปมัน|this\s+(?:one|item|product)|这个|ໂຕນີ້|ອັນນີ້|sản\s+phẩm\s+này|cái\s+này)/iu;

function dbConfig(): { url:string; key:string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

function compact(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('th-TH').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function productRoots(name: string): string[] {
  const raw = name.trim();
  const variants = new Set<string>([raw]);
  for (const piece of raw.split(/[\/|•]/u)) if (piece.trim()) variants.add(piece.trim());
  const beforeBrand = raw.split(/ตรา/u)[0]?.trim();
  if (beforeBrand) variants.add(beforeBrand);
  const withoutPlace = raw
    .replace(/\s+บ้านเขว้า.*$/u, '')
    .replace(/\s+ชัยภูมิ$/u, '')
    .trim();
  if (withoutPlace) variants.add(withoutPlace);
  return [...variants].map(compact).filter(value => value.length >= 4);
}

export function isCustomerImageRequest(message: string): boolean {
  return IMAGE_REQUEST_RE.test(String(message ?? ''));
}

export function selectOtopProductForMedia(
  products: readonly MediaCatalogProduct[],
  customerMessage: string,
  assistantMessage = '',
  chatHistory: readonly ChatTurn[] = [],
): MediaCatalogProduct | null {
  const direct = compact(customerMessage);
  const directMatches = products.filter(product => productRoots(product.name).some(root => direct.includes(root)));
  if (directMatches.length === 1) return directMatches[0] ?? null;
  if (directMatches.length > 1) return null;

  if (!REFERENTIAL_RE.test(customerMessage)) return null;
  const context = [
    ...chatHistory.slice(-4).map(turn => turn.content),
    assistantMessage,
  ].join(' ');
  const normalizedContext = compact(context);
  const contextMatches = products.filter(product => productRoots(product.name).some(root => normalizedContext.includes(root)));
  return contextMatches.length === 1 ? contextMatches[0] ?? null : null;
}

function lineSafeImageUrl(originalUrl: string): string {
  const encoded = encodeURIComponent(originalUrl);
  return `https://tamma-chat.netlify.app/.netlify/images?url=${encoded}&w=1024&fm=jpg&q=88`;
}

async function loadLiveOtopMediaCatalog(): Promise<MediaCatalogProduct[]> {
  const config = dbConfig();
  if (!config) return [];
  const endpoint = new URL(`${config.url}/rest/v1/otop_products`);
  endpoint.searchParams.set('environment','eq.live');
  endpoint.searchParams.set('active','eq.true');
  endpoint.searchParams.set('verified','eq.true');
  endpoint.searchParams.set('select','sku,name,otop_product_images(public_url,alt_text,sort_order,is_primary)');
  endpoint.searchParams.set('order','sku.asc');
  const response = await fetch(endpoint, {
    headers: { apikey:config.key, Authorization:`Bearer ${config.key}` },
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []) as Array<{
    sku?:unknown; name?:unknown; otop_product_images?:Array<Record<string,unknown>>;
  }>;
  return rows.map(row => ({
    sku:String(row.sku ?? ''),
    name:String(row.name ?? ''),
    images:(Array.isArray(row.otop_product_images) ? row.otop_product_images : [])
      .map(image => ({
        url:typeof image.public_url === 'string' ? image.public_url : '',
        alt:typeof image.alt_text === 'string' ? image.alt_text : String(row.name ?? ''),
        position:Number(image.sort_order ?? 0),
        primary:image.is_primary === true,
      }))
      .filter(image => /^https:\/\//iu.test(image.url))
      .sort((a,b)=>Number(b.primary)-Number(a.primary)||a.position-b.position)
      .slice(0,4),
  })).filter(product => product.sku && product.name && product.images.length > 0);
}

function mediaReply(language:string, productName:string, count:number): string {
  if (language === 'en') return count > 1
    ? `Yes — here are ${count} images of ${productName} from the live product record.`
    : `Yes — here is the image of ${productName} from the live product record.`;
  if (language === 'zh') return count > 1
    ? `有的，这里是系统里 ${productName} 的 ${count} 张商品图片。`
    : `有的，这是系统里 ${productName} 的商品图片。`;
  if (language === 'lo') return count > 1
    ? `ມີຄັບ ນີ້ແມ່ນຮູບ ${productName} ຈາກຂໍ້ມູນສິນຄ້າ ${count} ຮູບ.`
    : `ມີຄັບ ນີ້ແມ່ນຮູບ ${productName} ຈາກຂໍ້ມູນສິນຄ້າ.`;
  if (language === 'vi') return count > 1
    ? `Có — đây là ${count} ảnh ${productName} đang có trong hồ sơ sản phẩm.`
    : `Có — đây là ảnh ${productName} đang có trong hồ sơ sản phẩm.`;
  return count > 1
    ? `มีครับ ทองไทยส่งรูป${productName}ที่มีอยู่ในหลังบ้านให้เบิ่ง ${count} รูปครับ`
    : `มีครับ นี่คือรูป${productName}ที่มีอยู่ในหลังบ้าน ทองไทยส่งให้เบิ่งครับ`;
}

export async function resolveRequestedCustomerMedia(input: {
  customerMessage:string;
  assistantMessage:string;
  language:string;
  chatHistory?:readonly ChatTurn[];
}): Promise<{ media:CustomerMediaImage[]; overrideMessage:string } | null> {
  if (!isCustomerImageRequest(input.customerMessage)) return null;
  try {
    const products = await loadLiveOtopMediaCatalog();
    const product = selectOtopProductForMedia(
      products,
      input.customerMessage,
      input.assistantMessage,
      input.chatHistory ?? [],
    );
    if (!product) return null;
    const count = ALL_IMAGES_RE.test(input.customerMessage) ? Math.min(4,product.images.length) : 1;
    const media = product.images.slice(0,count).map(image => ({
      type:'image' as const,
      url:image.url,
      deliveryUrl:lineSafeImageUrl(image.url),
      alt:image.alt || product.name,
      source:'otop_product_images' as const,
      sku:product.sku,
      productName:product.name,
      primary:image.primary,
    }));
    if (!media.length) return null;
    return { media, overrideMessage:mediaReply(input.language,product.name,media.length) };
  } catch (error) {
    console.error('THONGTHAI_MEDIA_RESOLVE_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown');
    return null;
  }
}
