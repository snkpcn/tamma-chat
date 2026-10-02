export type CafeMenuPriceSlot={
  id:string;
  menu_code:string;
  slot_code:string;
  label_th:string;
  label_en:string;
  price:number;
  active:boolean;
  sort_order:number;
  metadata:Record<string,unknown>;
  updated_at:string;
};

export type CafeMasterMenuItem={
  code:string;
  category:'coffee'|'non_coffee'|'tea'|'matcha';
  name_th:string;
  name_en:string;
  prices:Record<string,number>;
  available_all_branches:boolean;
  active:boolean;
  source:string;
  source_verified_at:string;
  metadata:Record<string,unknown>;
  updated_at:string;
  slots:CafeMenuPriceSlot[];
};

export type CafeBranchModifier={
  modifier_code:string;
  name_th:string;
  name_en:string;
  surcharge:number;
  applies_to:string[];
  styles:string[];
  active:boolean;
  source:string;
  source_verified_at:string;
  metadata:Record<string,unknown>;
  updated_at:string;
};

function config():{url:string;key:string}{
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Supabase configuration missing');
  return {url:url.replace(/\/$/,''),key};
}

async function dbFetch(path:string):Promise<Response>{
  const c=config();
  const res=await fetch(c.url+'/rest/v1/'+path,{
    headers:{
      apikey:c.key,
      Authorization:'Bearer '+c.key,
      'Content-Type':'application/json',
    },
  });
  if(!res.ok){
    const body=await res.text().catch(()=>'');
    throw new Error('cafe_sot_'+res.status+':'+body.slice(0,180));
  }
  return res;
}

export async function listCafeMasterMenu():Promise<CafeMasterMenuItem[]>{
  const [menuRes,slotRes]=await Promise.all([
    dbFetch(
      'cafe_master_menu_items?active=eq.true&available_all_branches=eq.true'
      +'&select=code,category,name_th,name_en,prices,available_all_branches,active,source,source_verified_at,metadata,updated_at'
      +'&order=category.asc,name_th.asc'
    ),
    dbFetch(
      'cafe_menu_price_slots?active=eq.true'
      +'&select=id,menu_code,slot_code,label_th,label_en,price,active,sort_order,metadata,updated_at'
      +'&order=menu_code.asc,sort_order.asc,slot_code.asc'
    ),
  ]);
  const menus=await menuRes.json() as Array<Omit<CafeMasterMenuItem,'slots'>>;
  const rawSlots=await slotRes.json() as Array<Omit<CafeMenuPriceSlot,'price'> & {price:number|string}>;
  const slots=rawSlots.map(slot=>({...slot,price:Number(slot.price)}));
  return menus.map(menu=>({...menu,slots:slots.filter(slot=>slot.menu_code===menu.code)}));
}

export async function listCafeBranchModifiers(branchCode='inthanin_tadtone'):Promise<CafeBranchModifier[]>{
  const res=await dbFetch(
    'cafe_branch_modifiers?branch_code=eq.'+encodeURIComponent(branchCode)
    +'&active=eq.true'
    +'&select=modifier_code,name_th,name_en,surcharge,applies_to,styles,active,source,source_verified_at,metadata,updated_at'
    +'&order=modifier_code.asc'
  );
  const rows=await res.json() as Array<Omit<CafeBranchModifier,'surcharge'> & {surcharge:number|string}>;
  return rows.map(row=>({...row,surcharge:Number(row.surcharge)}));
}

export async function loadCafeWorldFacts(branchCode='inthanin_tadtone'):Promise<Array<{
  fact_key:string;
  category:string;
  fact_value:unknown;
  source:string;
  updated_at:string;
}>>{
  try{
    const [items,modifiers]=await Promise.all([
      listCafeMasterMenu(),
      listCafeBranchModifiers(branchCode),
    ]);
    const updatedAt=[...items.map(x=>x.updated_at),...modifiers.map(x=>x.updated_at)]
      .filter(Boolean)
      .reduce((latest,value)=>value>latest?value:latest,new Date(0).toISOString());
    return [{
      fact_key:'cafe_menu_live',
      category:'operations',
      source:'cafe_master_menu_items+cafe_menu_price_slots+cafe_branch_modifiers',
      updated_at:updatedAt,
      fact_value:{
        brand:'Inthanin',
        branchCode,
        sourceOfTruth:true,
        masterScope:'corporate_core_all_branches',
        excludes:['seasonal','LITE','branch_only','fresh_fruit_branch_variants'],
        items:items.map(item=>({
          code:item.code,
          category:item.category,
          nameTh:item.name_th,
          nameEn:item.name_en,
          prices:item.prices,
          slots:item.slots.map(slot=>({
            code:slot.slot_code,
            labelTh:slot.label_th,
            labelEn:slot.label_en,
            price:slot.price,
            sortOrder:slot.sort_order,
          })),
          availableAllBranches:item.available_all_branches,
        })),
        modifiers:modifiers.map(mod=>({
          code:mod.modifier_code,
          nameTh:mod.name_th,
          nameEn:mod.name_en,
          surcharge:mod.surcharge,
          appliesTo:mod.applies_to,
          styles:mod.styles,
          pricingRule:'base_plus_surcharge',
        })),
      },
    }];
  }catch(error){
    console.error('THONGTHAI_CAFE_FACTS_ERROR',error instanceof Error?error.message.slice(0,180):'unknown');
    return [];
  }
}
