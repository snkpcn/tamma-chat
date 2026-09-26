-- ตำมา-ชาติ OS — initial schema
-- Isolated Supabase project. Do NOT run against any other project's database.
--
-- Design notes:
--   * Single restaurant tenant per deployment, with room for multiple branches
--     and multiple staff logins (profiles.restaurant_id).
--   * auth_restaurant_id() resolves the caller's restaurant from their profile
--     row; every table's RLS policy scopes reads/writes to that restaurant.
--   * RLS is enabled on every table with no default-allow policy: a table with
--     no matching policy denies all access.
--   * History tables (ingredient_price_history, recipe_cost_snapshots,
--     menu_price_history, stock_movements, waste_records, activity_logs) are
--     append-only from the application's point of view — rows are never
--     rewritten when a new price/quantity is recorded.

create extension if not exists pgcrypto;

-- =========================================================================
-- 1. IDENTITY / TENANCY
-- =========================================================================

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  restaurant_id uuid references restaurants (id) on delete set null,
  full_name text,
  role text not null default 'เจ้าของร้าน',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  address text,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id from profiles where id = auth.uid();
$$;

-- =========================================================================
-- 2. SHARED LOOKUPS
-- =========================================================================

create table units (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  category text not null default 'อื่น ๆ',
  is_base_unit boolean not null default false,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

-- =========================================================================
-- 3. INVESTMENT OS
-- =========================================================================

create table investment_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table investments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references investment_categories (id) on delete set null,
  project_id uuid, -- fk added after `projects` exists (see below)
  name text not null,
  description text,
  vendor_name text,
  budget_amount numeric(14, 2) not null default 0 check (budget_amount >= 0),
  actual_amount numeric(14, 2) not null default 0 check (actual_amount >= 0),
  quantity numeric(14, 3) not null default 1 check (quantity >= 0),
  unit text,
  order_date date,
  paid_date date,
  status text not null default 'วางแผน' check (
    status in (
      'วางแผน', 'ขอราคา', 'อนุมัติแล้ว', 'สั่งซื้อแล้ว',
      'ชำระบางส่วน', 'ชำระแล้ว', 'ได้รับของแล้ว', 'ยกเลิก'
    )
  ),
  payment_method text,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table investment_documents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  investment_id uuid not null references investments (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);

-- =========================================================================
-- 4. SUPPLIERS
-- =========================================================================

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  supplier_type text,
  contact_name text,
  phone text,
  line_id text,
  address text,
  tax_id text,
  payment_terms text,
  delivery_days text,
  minimum_order text,
  notes text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ไม่ใช้งาน')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 5. INGREDIENT MASTER + PRICE HISTORY
-- =========================================================================

create table ingredient_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  unique (restaurant_id, name)
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references ingredient_categories (id) on delete set null,
  name text not null,
  base_unit text not null,
  purchase_unit text not null,
  conversion_factor numeric(14, 6) not null default 1 check (conversion_factor > 0),
  primary_supplier_id uuid references suppliers (id) on delete set null,
  latest_cost_per_base_unit numeric(14, 4),
  reorder_point numeric(14, 3) not null default 0,
  minimum_stock_quantity numeric(14, 3) not null default 0,
  shelf_life_days int,
  notes text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ไม่ใช้งาน')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table supplier_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  supplier_id uuid not null references suppliers (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  latest_price numeric(14, 4),
  last_purchase_date date,
  notes text,
  unique (supplier_id, ingredient_id)
);

create table ingredient_price_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  supplier_id uuid references suppliers (id) on delete set null,
  purchase_date date not null default current_date,
  price numeric(14, 4) not null check (price >= 0),
  purchase_unit text not null,
  purchase_quantity numeric(14, 3) not null check (purchase_quantity > 0),
  cost_per_base_unit numeric(14, 4) not null,
  notes text,
  recorded_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ingredient_price_history_ingredient_date_idx
  on ingredient_price_history (ingredient_id, purchase_date desc);

-- =========================================================================
-- 6. RECIPE OS
-- =========================================================================

create table recipe_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (restaurant_id, name)
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references recipe_categories (id) on delete set null,
  name text not null,
  image_path text,
  description text,
  standard_serving_size numeric(10, 2) not null default 1,
  method text,
  notes text,
  packaging_cost numeric(14, 4) not null default 0,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ไม่ใช้งาน')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  recipe_id uuid not null references recipes (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null,
  sort_order int not null default 0,
  notes text
);

create table recipe_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  recipe_id uuid not null references recipes (id) on delete cascade,
  ingredient_cost numeric(14, 4) not null,
  packaging_cost numeric(14, 4) not null default 0,
  total_cost numeric(14, 4) not null,
  snapshot_reason text,
  created_at timestamptz not null default now()
);

create index recipe_cost_snapshots_recipe_idx
  on recipe_cost_snapshots (recipe_id, created_at desc);

-- =========================================================================
-- 7. MENU OS
-- =========================================================================

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (restaurant_id, name)
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references menu_categories (id) on delete set null,
  recipe_id uuid references recipes (id) on delete set null,
  name text not null,
  selling_price numeric(14, 2) not null default 0 check (selling_price >= 0),
  image_path text,
  description text,
  is_available boolean not null default true,
  notes text,
  status text not null default 'ใช้งาน' check (status in ('ใช้งาน', 'ไม่ใช้งาน')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table menu_price_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  menu_item_id uuid not null references menu_items (id) on delete cascade,
  selling_price numeric(14, 2) not null,
  effective_from timestamptz not null default now(),
  notes text
);

-- =========================================================================
-- 8. STOCK OS
-- =========================================================================

create table stock_lots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  lot_number text,
  received_date date not null default current_date,
  expiry_date date,
  quantity_received numeric(14, 3) not null check (quantity_received >= 0),
  cost_per_base_unit numeric(14, 4) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  movement_type text not null check (
    movement_type in (
      'รับเข้า', 'เบิกใช้', 'ขาย', 'ของเสีย',
      'นับสต๊อก', 'ปรับยอด', 'โอน', 'คืนผู้ขาย'
    )
  ),
  quantity_base_unit numeric(14, 3) not null,
  cost_per_base_unit numeric(14, 4),
  supplier_id uuid references suppliers (id) on delete set null,
  lot_id uuid references stock_lots (id) on delete set null,
  reference text,
  reason text,
  notes text,
  recorded_by uuid references profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index stock_movements_ingredient_idx
  on stock_movements (ingredient_id, occurred_at desc);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  counted_quantity_base_unit numeric(14, 3) not null,
  system_quantity_base_unit numeric(14, 3) not null,
  variance_base_unit numeric(14, 3) generated always as
    (counted_quantity_base_unit - system_quantity_base_unit) stored,
  counted_by uuid references profiles (id) on delete set null,
  counted_at timestamptz not null default now(),
  notes text
);

-- =========================================================================
-- 9. WASTE / LOSS
-- =========================================================================

create table waste_reasons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  unique (restaurant_id, name)
);

create table waste_records (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  quantity_base_unit numeric(14, 3) not null check (quantity_base_unit > 0),
  reason_id uuid references waste_reasons (id) on delete set null,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 10. PERSONNEL
-- =========================================================================

create table employee_positions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  unique (restaurant_id, name)
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  full_name text not null,
  nickname text,
  position_id uuid references employee_positions (id) on delete set null,
  phone text,
  start_date date,
  employment_type text,
  wage_amount numeric(14, 2),
  status text not null default 'ทำงานอยู่' check (status in ('ทำงานอยู่', 'พ้นสภาพ')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 11. PROJECTS / TASKS
-- =========================================================================

create table projects (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  description text,
  category text,
  status text not null default 'ยังไม่เริ่ม' check (
    status in ('ยังไม่เริ่ม', 'กำลังทำ', 'รอ', 'เสร็จแล้ว', 'ยกเลิก')
  ),
  start_date date,
  due_date date,
  budget numeric(14, 2),
  owner_employee_id uuid references employees (id) on delete set null,
  progress_percent int not null default 0 check (progress_percent between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table investments
  add constraint investments_project_id_fkey
  foreign key (project_id) references projects (id) on delete set null;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  name text not null,
  description text,
  owner_employee_id uuid references employees (id) on delete set null,
  due_date date,
  priority text not null default 'ปกติ' check (priority in ('ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน')),
  status text not null default 'ยังไม่เริ่ม' check (
    status in ('ยังไม่เริ่ม', 'กำลังทำ', 'รอ', 'เสร็จแล้ว', 'ยกเลิก')
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 12. OPENING READINESS CHECKLIST
-- =========================================================================

create table opening_checklist_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (restaurant_id, name)
);

create table opening_checklist_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references opening_checklist_categories (id) on delete set null,
  name text not null,
  owner_employee_id uuid references employees (id) on delete set null,
  due_date date,
  status text not null default 'ยังไม่เริ่ม' check (
    status in ('ยังไม่เริ่ม', 'กำลังทำ', 'เสร็จแล้ว')
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 13. ALERTS + ACTIVITY LOG
-- =========================================================================

create table alerts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  alert_type text not null,
  severity text not null default 'ปกติ' check (severity in ('ปกติ', 'เตือน', 'วิกฤต')),
  message text not null,
  related_table text,
  related_id uuid,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  summary text not null,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 14. SETTINGS
-- =========================================================================

create table settings (
  restaurant_id uuid primary key references restaurants (id) on delete cascade,
  food_cost_threshold_percent numeric(5, 2) not null default 35,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- 15. updated_at TRIGGER
-- =========================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'restaurants', 'profiles', 'branches',
      'investment_categories', 'investments',
      'suppliers', 'ingredients', 'recipes', 'menu_items',
      'employees', 'projects', 'tasks', 'opening_checklist_items'
    ])
  loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t
    );
  end loop;
end;
$$;

-- =========================================================================
-- 16. ROW LEVEL SECURITY — default deny, owner/restaurant scoped
-- =========================================================================

alter table restaurants enable row level security;
alter table profiles enable row level security;
alter table branches enable row level security;
alter table units enable row level security;
alter table investment_categories enable row level security;
alter table investments enable row level security;
alter table investment_documents enable row level security;
alter table suppliers enable row level security;
alter table ingredient_categories enable row level security;
alter table ingredients enable row level security;
alter table supplier_ingredients enable row level security;
alter table ingredient_price_history enable row level security;
alter table recipe_categories enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_cost_snapshots enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table menu_price_history enable row level security;
alter table stock_lots enable row level security;
alter table stock_movements enable row level security;
alter table stock_counts enable row level security;
alter table waste_reasons enable row level security;
alter table waste_records enable row level security;
alter table employee_positions enable row level security;
alter table employees enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table opening_checklist_categories enable row level security;
alter table opening_checklist_items enable row level security;
alter table alerts enable row level security;
alter table activity_logs enable row level security;
alter table settings enable row level security;

-- =========================================================================
-- 17. BOOTSTRAP DEFAULTS FOR A NEW RESTAURANT
-- =========================================================================

create or replace function bootstrap_restaurant_defaults(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into investment_categories (restaurant_id, name, sort_order)
  values
    (p_restaurant_id, 'ก่อสร้าง', 1),
    (p_restaurant_id, 'งานระบบ', 2),
    (p_restaurant_id, 'อุปกรณ์ครัว', 3),
    (p_restaurant_id, 'เฟอร์นิเจอร์', 4),
    (p_restaurant_id, 'ตกแต่ง', 5),
    (p_restaurant_id, 'เครื่องใช้ไฟฟ้า', 6),
    (p_restaurant_id, 'ระบบ POS', 7),
    (p_restaurant_id, 'อุปกรณ์หน้าร้าน', 8),
    (p_restaurant_id, 'วัตถุดิบเริ่มต้น', 9),
    (p_restaurant_id, 'การตลาด', 10),
    (p_restaurant_id, 'บุคลากร', 11),
    (p_restaurant_id, 'ใบอนุญาต / ค่าธรรมเนียม', 12),
    (p_restaurant_id, 'อื่น ๆ', 13)
  on conflict (restaurant_id, name) do nothing;

  insert into ingredient_categories (restaurant_id, name, sort_order)
  values
    (p_restaurant_id, 'ผัก', 1),
    (p_restaurant_id, 'เนื้อสัตว์', 2),
    (p_restaurant_id, 'เครื่องปรุง', 3),
    (p_restaurant_id, 'อาหารแห้ง', 4),
    (p_restaurant_id, 'เครื่องดื่ม', 5),
    (p_restaurant_id, 'แอลกอฮอล์', 6),
    (p_restaurant_id, 'บรรจุภัณฑ์', 7),
    (p_restaurant_id, 'ของใช้สิ้นเปลือง', 8),
    (p_restaurant_id, 'อื่น ๆ', 9)
  on conflict (restaurant_id, name) do nothing;

  insert into menu_categories (restaurant_id, name, sort_order)
  values
    (p_restaurant_id, 'ส้มตำ', 1),
    (p_restaurant_id, 'ยำ', 2),
    (p_restaurant_id, 'ลาบ/ก้อย', 3),
    (p_restaurant_id, 'ย่าง', 4),
    (p_restaurant_id, 'ทอด', 5),
    (p_restaurant_id, 'ต้ม', 6),
    (p_restaurant_id, 'ข้าว', 7),
    (p_restaurant_id, 'เครื่องดื่ม', 8),
    (p_restaurant_id, 'เบียร์', 9),
    (p_restaurant_id, 'อื่น ๆ', 10)
  on conflict (restaurant_id, name) do nothing;

  insert into waste_reasons (restaurant_id, name)
  values
    (p_restaurant_id, 'หมดอายุ'),
    (p_restaurant_id, 'เสีย'),
    (p_restaurant_id, 'ทำตก'),
    (p_restaurant_id, 'เตรียมเกิน'),
    (p_restaurant_id, 'คุณภาพไม่ผ่าน'),
    (p_restaurant_id, 'นับผิด'),
    (p_restaurant_id, 'อื่น ๆ')
  on conflict (restaurant_id, name) do nothing;

  insert into employee_positions (restaurant_id, name)
  values
    (p_restaurant_id, 'ผู้จัดการร้าน'),
    (p_restaurant_id, 'ครัว'),
    (p_restaurant_id, 'ส้มตำ'),
    (p_restaurant_id, 'ย่าง'),
    (p_restaurant_id, 'หน้าร้าน'),
    (p_restaurant_id, 'แคชเชียร์'),
    (p_restaurant_id, 'บาร์'),
    (p_restaurant_id, 'ล้างจาน'),
    (p_restaurant_id, 'พาร์ทไทม์')
  on conflict (restaurant_id, name) do nothing;

  insert into opening_checklist_categories (restaurant_id, name, sort_order)
  values
    (p_restaurant_id, 'สถานที่', 1),
    (p_restaurant_id, 'ก่อสร้าง', 2),
    (p_restaurant_id, 'ครัว', 3),
    (p_restaurant_id, 'POS', 4),
    (p_restaurant_id, 'ใบอนุญาต', 5),
    (p_restaurant_id, 'วัตถุดิบ', 6),
    (p_restaurant_id, 'สูตรอาหาร', 7),
    (p_restaurant_id, 'พนักงาน', 8),
    (p_restaurant_id, 'การตลาด', 9),
    (p_restaurant_id, 'Soft Opening', 10),
    (p_restaurant_id, 'อื่น ๆ', 11)
  on conflict (restaurant_id, name) do nothing;

  insert into settings (restaurant_id)
  values (p_restaurant_id)
  on conflict (restaurant_id) do nothing;
end;
$$;

create policy "owner can manage own restaurant"
  on restaurants for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "user can view own profile"
  on profiles for select
  using (id = auth.uid());

create policy "user can update own profile"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Generic "restaurant-scoped" policy, applied per table below.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'branches', 'units',
      'investment_categories', 'investments', 'investment_documents',
      'suppliers',
      'ingredient_categories', 'ingredients', 'supplier_ingredients', 'ingredient_price_history',
      'recipe_categories', 'recipes', 'recipe_ingredients', 'recipe_cost_snapshots',
      'menu_categories', 'menu_items', 'menu_price_history',
      'stock_lots', 'stock_movements', 'stock_counts',
      'waste_reasons', 'waste_records',
      'employee_positions', 'employees',
      'projects', 'tasks',
      'opening_checklist_categories', 'opening_checklist_items',
      'alerts', 'activity_logs', 'settings'
    ])
  loop
    execute format(
      'create policy "restaurant scoped access" on %I for all using (restaurant_id = auth_restaurant_id()) with check (restaurant_id = auth_restaurant_id());',
      t
    );
  end loop;
end;
$$;
