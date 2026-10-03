export const WW11_COUNTRY_CERTIFICATION_VERSION='ww11-country-certification-2026-10-03';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKET_RE=/^[A-Z0-9][A-Z0-9_-]{1,23}$/;

export function normalizeCertificationMarket(value:unknown):string{
  const market=typeof value==='string'?value.trim().toUpperCase():'';
  if(!MARKET_RE.test(market))throw new Error('invalid_market_code');
  return market;
}

export function normalizeCertificationProductIds(value:unknown):string[]{
  if(!Array.isArray(value)||value.length<1||value.length>50)throw new Error('invalid_product_ids');
  const ids=value.map(item=>{
    const id=typeof item==='string'?item.trim().toLowerCase():'';
    if(!UUID_RE.test(id))throw new Error('invalid_product_ids');
    return id;
  });
  if(new Set(ids).size!==ids.length)throw new Error('duplicate_product_ids');
  return [...ids].sort();
}

export function normalizeCertificationPriceRevisions(value:unknown){
  if(!Array.isArray(value)||value.length<1||value.length>50)throw new Error('invalid_product_price_revisions');
  const rows=value.map(raw=>{
    if(!raw||typeof raw!=='object')throw new Error('invalid_product_price_revisions');
    const item=raw as Record<string,unknown>;
    const productId=typeof item.productId==='string'?item.productId.trim().toLowerCase():'';
    const priceRevisionId=typeof item.priceRevisionId==='string'?item.priceRevisionId.trim().toLowerCase():'';
    if(!UUID_RE.test(productId)||!UUID_RE.test(priceRevisionId))throw new Error('invalid_product_price_revisions');
    return{productId,priceRevisionId};
  });
  const keys=rows.map(row=>row.productId);
  if(new Set(keys).size!==keys.length)throw new Error('duplicate_product_price_revisions');
  return rows.sort((a,b)=>a.productId.localeCompare(b.productId));
}
