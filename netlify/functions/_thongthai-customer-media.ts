export type CustomerImageMedia = {
  type:'image';
  url:string;
  alt:string;
  source:'otop_catalog';
  sku:string;
  productName:string;
};

export type OtopMediaProduct = {
  sku:string;
  name:string;
  metadata?:Record<string,unknown>;
  images?:Array<{url?:string;alt?:string;position?:number;primary?:boolean}>;
};

function compact(value:unknown):string {
  return String(value??'')
    .normalize('NFKC')
    .toLocaleLowerCase('th-TH')
    .replace(/[\s\p{P}\p{S}]+/gu,'')
    .trim();
}

export function wantsProductImage(message:string):boolean {
  return /(?:ขอ|ดู|มี|ส่ง|เอา|อยากดู)?.{0,8}(?:รูป|ภาพ)|(?:รูป|ภาพ).{0,12}(?:สินค้า|ของ|otop)|(?:photo|image|picture)/iu.test(message);
}

function storyKeywords(metadata:Record<string,unknown>|undefined):string[] {
  const story=metadata?.story;
  if(!story||typeof story!=='object'||Array.isArray(story))return[];
  const value=(story as Record<string,unknown>).storyKeywords;
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0):[];
}

export function resolveRequestedOtopProductMedia(
  message:string,
  products:readonly OtopMediaProduct[],
):{product:OtopMediaProduct;media:CustomerImageMedia[]}|null {
  if(!wantsProductImage(message))return null;
  const haystack=compact(message);
  const candidates:Array<{product:OtopMediaProduct;score:number}>=[];
  for(const product of products){
    const needles=[product.name,product.sku,...storyKeywords(product.metadata)]
      .map(compact)
      .filter(value=>value.length>=3);
    const score=needles.reduce((best,needle)=>haystack.includes(needle)?Math.max(best,needle.length):best,0);
    if(score>0)candidates.push({product,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const winner=candidates[0];
  if(!winner)return null;
  if(candidates[1]&&candidates[1].score===winner.score&&candidates[1].product.sku!==winner.product.sku)return null;

  const allImages=(winner.product.images??[])
    .filter(image=>typeof image.url==='string'&&/^https:\/\//iu.test(image.url))
    .sort((a,b)=>Number(b.primary===true)-Number(a.primary===true)||Number(a.position??999)-Number(b.position??999));
  if(!allImages.length)return null;
  const wantsMany=/(?:ทั้งหมด|ทุกรูป|ทุกมุม|หลายรูป|รูปอื่น|อีก.*รูป|all\s*(?:photos|images)|more\s*(?:photos|images))/iu.test(message);
  const chosen=allImages.slice(0,wantsMany?4:1);
  return {
    product:winner.product,
    media:chosen.map(image=>({
      type:'image' as const,
      url:String(image.url),
      alt:typeof image.alt==='string'&&image.alt.trim()?image.alt:winner.product.name,
      source:'otop_catalog' as const,
      sku:winner.product.sku,
      productName:winner.product.name,
    })),
  };
}

export function productMediaAck(
  productName:string,
  count:number,
  language:'th'|'en'|'zh'|'lo'|'vi',
):string {
  if(language==='th')return count>1
    ? `ได้ครับ นี่รูป${productName}ที่มีอยู่ตอนนี้ ${count} รูปครับ`
    : `ได้ครับ นี่รูป${productName}ที่มีอยู่ตอนนี้ครับ`;
  if(language==='zh')return `可以，这是目前的${productName}图片。`;
  if(language==='lo')return `ໄດ້ເລີຍ ນີ້ແມ່ນຮູບ${productName}ທີ່ມີຢູ່ຕອນນີ້.`;
  if(language==='vi')return `Được, đây là ảnh ${productName} hiện có.`;
  return `Sure — here ${count>1?'are the current photos':'is the current photo'} of ${productName}.`;
}
