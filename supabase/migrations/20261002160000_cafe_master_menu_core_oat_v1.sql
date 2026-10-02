-- Inthanin Café source of truth: corporate core master + Tad Tone oat-milk option.
-- Scope is intentionally narrow: no seasonal, LITE, fresh-fruit or branch-only items.

create table if not exists public.cafe_master_menu_items (
  code text primary key,
  category text not null check(category in ('coffee','non_coffee','tea','matcha')),
  name_th text not null,
  name_en text not null,
  prices jsonb not null default '{}'::jsonb,
  available_all_branches boolean not null default true,
  active boolean not null default true,
  source text not null,
  source_verified_at date not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.cafe_branch_modifiers (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null,
  modifier_code text not null,
  name_th text not null,
  name_en text not null,
  surcharge numeric(14,2) not null check(surcharge>=0),
  applies_to text[] not null default '{}'::text[],
  styles text[] not null default '{}'::text[],
  active boolean not null default true,
  source text not null,
  source_verified_at date not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(branch_code,modifier_code)
);

alter table public.cafe_master_menu_items enable row level security;
alter table public.cafe_branch_modifiers enable row level security;

revoke all on public.cafe_master_menu_items from public,anon,authenticated;
revoke all on public.cafe_branch_modifiers from public,anon,authenticated;
grant select,insert,update,delete on public.cafe_master_menu_items to service_role;
grant select,insert,update,delete on public.cafe_branch_modifiers to service_role;

insert into public.cafe_master_menu_items(
  code,category,name_th,name_en,prices,available_all_branches,active,source,source_verified_at,metadata
) values
  ('espresso','coffee','เอสเพรสโซ่','Espresso','{"hot":40,"iced":65,"frappe":75}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('americano','coffee','อเมริกาโน่','Americano','{"hot":40,"iced":60}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('es_all_day','coffee','เอสออลเดย์','Es All Day','{"hot":40,"iced":60,"frappe":70}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('cappuccino','coffee','คาปูชิโน่','Cappuccino','{"hot":55,"iced":70,"frappe":80}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('cafe_latte','coffee','คาเฟ่ลาเต้','Cafe Latte','{"hot":60,"iced":75,"frappe":85}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('mocha','coffee','มอคค่า','Mocha','{"hot":60,"iced":75,"frappe":85}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('caramel_macchiato','coffee','คาราเมล มัคคิอาโต้','Caramel Macchiato','{"hot":70,"iced":80,"frappe":90}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),

  ('cocoa','non_coffee','โกโก้','Cocoa','{"hot":50,"iced":60,"frappe":70}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('fresh_milk','non_coffee','นมสด','Fresh Milk','{"hot":45,"iced":55,"frappe":65}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('pink_milk','non_coffee','นมชมพู','Pink Milk','{"iced":55,"frappe":65}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),

  ('thai_tea_latte','tea','ชาไทยลาเต้','Thai Tea Latte','{"hot":50,"iced":60,"frappe":70}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('green_tea_latte','tea','ชาเขียวลาเต้','Green Tea Latte','{"hot":50,"iced":60,"frappe":70}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('black_tea','tea','ชาดำ','Black Tea','{"iced":50}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),
  ('lemon_tea','tea','ชามะนาว','Lemon Tea','{"iced":55}'::jsonb,true,true,'Inthanin core menu 2569','2026-09-04','{"scope":"corporate_core"}'::jsonb),

  ('uji_pure_matcha','matcha','อูจิ เพียวมัทฉะ','Uji Pure Matcha','{"hot":60,"iced":70}'::jsonb,true,true,'Inthanin current product + all-branch promotion','2026-10-02','{"scope":"corporate_core","sweetness_default":"0%"}'::jsonb)
on conflict(code) do update set
  category=excluded.category,
  name_th=excluded.name_th,
  name_en=excluded.name_en,
  prices=excluded.prices,
  available_all_branches=excluded.available_all_branches,
  active=excluded.active,
  source=excluded.source,
  source_verified_at=excluded.source_verified_at,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.cafe_branch_modifiers(
  branch_code,modifier_code,name_th,name_en,surcharge,applies_to,styles,active,source,source_verified_at,metadata
) values (
  'inthanin_tadtone',
  'oat_milk',
  'นมโอ๊ต',
  'Oat Milk',
  15,
  array['cafe_latte','thai_tea_latte','green_tea_latte','cocoa','fresh_milk','pink_milk']::text[],
  array['hot','iced']::text[],
  true,
  'Owner confirmed Tad Tone availability + current Inthanin Smart Order pricing',
  '2026-10-02',
  '{"branch_option":true,"pricing_rule":"base_plus_surcharge","exclude_styles":["frappe"]}'::jsonb
)
on conflict(branch_code,modifier_code) do update set
  name_th=excluded.name_th,
  name_en=excluded.name_en,
  surcharge=excluded.surcharge,
  applies_to=excluded.applies_to,
  styles=excluded.styles,
  active=excluded.active,
  source=excluded.source,
  source_verified_at=excluded.source_verified_at,
  metadata=excluded.metadata,
  updated_at=now();
