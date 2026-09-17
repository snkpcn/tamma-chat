create table if not exists tamma_chart_os.restaurant_menu_intelligence_profiles (
  menu_item_id uuid primary key references tamma_chart_os.menu_items(id) on delete cascade,
  restaurant_id uuid not null references tamma_chart_os.restaurants(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  curation_status text not null default 'auto' check (curation_status in ('auto','curated')),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_menu_intelligence_profiles_restaurant_idx
  on tamma_chart_os.restaurant_menu_intelligence_profiles (restaurant_id);

insert into tamma_chart_os.restaurant_menu_intelligence_profiles (menu_item_id, restaurant_id, profile, curation_status, updated_at)
select
  v.menu_item_id,
  v.restaurant_id,
  jsonb_build_object(
    'summary', case
      when v.name = 'ตำลาว' then 'อีสานชัด ปลาร้านัว เปรี้ยวเค็ม เผ็ดปรับได้ เหมาะกับคนที่อยากได้รสท้องถิ่นตรง ๆ'
      when v.name = 'ตำไทย' then 'หวานเปรี้ยว กินง่ายกว่า มีถั่วลิสงและกุ้งแห้ง เหมาะกับคนเริ่มกินส้มตำหรือไม่เอาปลาร้า'
      when v.name = 'ตำซั่วปลาร้า' then 'ตำปลาร้ากับขนมจีน รสเข้มและอิ่มขึ้น เป็นหนึ่งในเมนูอีสานเด่นของร้าน'
      when v.name = 'ลาบปลาช่อน' then 'ลาบปลาเนื้อแน่น เปรี้ยวหอมข้าวคั่ว สมุนไพรชัด เป็นเมนูเด่นสำหรับคนอยากลองปลาแบบอีสาน'
      when v.name = 'คอหมูย่างจิ้มแจ่ว' then 'ย่างหอม นุ่มมัน กินง่าย จิ้มแจ่วช่วยตัดเลี่ยน เหมาะแชร์และเข้าคู่กับตำหรือต้มแซ่บ'
      when v.name = 'เสือร้องไห้' then 'เนื้อย่างรสเข้ม เคี้ยวมีสัมผัส จิ้มแจ่ว เหมาะกับคนชอบเนื้อและกับแกล้ม'
      when v.name = 'ไก่บ้านนึ่งสมุนไพรใส่วุ้นเส้น' then 'ไก่บ้านกับสมุนไพรและวุ้นเส้น กลิ่นหอม อิ่มแต่ไม่หนักทอด เป็นเมนูเด่นสำหรับแชร์'
      when v.name like 'ต้มแซ่บ%' then 'น้ำซุปร้อน เปรี้ยวเผ็ด หอมตะไคร้ใบมะกรูด ช่วยบาลานซ์โต๊ะที่มีของย่างหรือทอด'
      when v.category_name = 'ย่าง • ทอด' then 'เมนูโปรตีนย่างหรือทอด เหมาะแชร์ ช่วยบาลานซ์กับตำ ลาบ และต้ม'
      when v.category_name = 'ลาบ • น้ำตก • ยำ' then 'รสเปรี้ยวเค็มสมุนไพรเด่น เหมาะแชร์และกินคู่ข้าวเหนียว'
      when v.category_name = 'เมนูปลา' then 'เมนูปลาสำหรับแชร์ มีทั้งแนวลาบและทอดสมุนไพร'
      when v.category_name = 'ข้าว • เส้น • เคียง' then 'เมนูข้าว เส้น หรือของเคียง ใช้เติมความอิ่มและบาลานซ์รสบนโต๊ะ'
      when v.category_name = 'ของหวาน' then 'ของหวานไทยปิดมื้อ รสนุ่มหวาน ช่วยพักรสหลังอาหารอีสาน'
      when v.category_name = 'น้ำสมุนไพร' then 'เครื่องดื่มสมุนไพรไม่มีแอลกอฮอล์ ช่วยพักรสและเข้ากับอาหารรสจัด'
      when v.category_name in ('เบียร์สด','Thai Craft Spirits','สุรา') then 'เครื่องดื่มแอลกอฮอล์สำหรับผู้ใหญ่ เหมาะจับคู่กับของย่าง ทอด และกับแกล้ม'
      else coalesce(v.description, v.name)
    end,
    'mealRoles', case
      when v.category_name = 'ตำ' then array['salad','fresh_spicy','share']::text[]
      when v.category_name = 'เมนูปลา' then array['protein','main','share']::text[]
      when v.category_name = 'ต้ม • นึ่ง' then array['soup_or_steam','main','share']::text[]
      when v.category_name = 'ลาบ • น้ำตก • ยำ' then array['salad','protein','share']::text[]
      when v.category_name = 'ย่าง • ทอด' then array['grill_or_fry','protein','main','share']::text[]
      when v.category_name = 'ข้าว • เส้น • เคียง' and (v.name like 'ข้าว%ย่าง%' or v.name like 'ข้าวคอหมู%') then array['single_plate','main']::text[]
      when v.category_name = 'ข้าว • เส้น • เคียง' then array['side']::text[]
      when v.category_name = 'น้ำสมุนไพร' then array['drink','non_alcoholic']::text[]
      when v.category_name in ('เบียร์สด','Thai Craft Spirits','สุรา') then array['drink','alcohol']::text[]
      when v.category_name = 'ของหวาน' then array['dessert']::text[]
      else array['main']::text[]
    end,
    'tasteTags', array_remove(array[
      case when v.name like 'ตำ%' or v.name like 'ลาบ%' or v.name like 'น้ำตก%' or v.name like 'ยำ%' or v.name like 'ต้มแซ่บ%' then 'sour' end,
      case when v.name like 'ตำไทย%' or v.category_name = 'ของหวาน' or v.category_name = 'น้ำสมุนไพร' then 'sweet' end,
      case when v.name like '%ย่าง%' then 'smoky' end,
      case when v.name like '%ทอด%' then 'crispy' end,
      case when v.name like '%สมุนไพร%' or v.name like 'ต้มแซ่บ%' or v.name like 'ลาบ%' then 'herbal' end,
      case when 'น้ำปลาร้า' = any(coalesce(v.ingredient_names,array[]::text[])) then 'fermented_savory' end,
      case when v.name like 'ต้มแซ่บ%' or v.name like 'ตำ%' or v.name like 'ลาบ%' or v.name like 'น้ำตก%' or v.name like 'ยำ%' then 'spicy' end,
      case when v.category_name in ('ย่าง • ทอด','เมนูปลา') then 'savory' end
    ]::text[], null),
    'textureTags', array_remove(array[
      case when v.name like '%ทอด%' then 'crispy' end,
      case when v.name like '%ย่าง%' or v.name = 'เสือร้องไห้' then 'grilled' end,
      case when v.name like '%นึ่ง%' then 'tender_steam' end,
      case when v.name like 'ต้ม%' then 'brothy' end,
      case when v.name like 'ตำ%' then 'crunchy_fresh' end
    ]::text[], null),
    'proteinTags', array_remove(array[
      case when 'หมูสับ' = any(coalesce(v.ingredient_names,array[]::text[])) or 'คอหมู' = any(coalesce(v.ingredient_names,array[]::text[])) then 'pork' end,
      case when 'เนื้อวัว' = any(coalesce(v.ingredient_names,array[]::text[])) then 'beef' end,
      case when 'ไก่บ้าน' = any(coalesce(v.ingredient_names,array[]::text[])) then 'chicken' end,
      case when 'ปลาช่อน' = any(coalesce(v.ingredient_names,array[]::text[])) or 'ปลานิล' = any(coalesce(v.ingredient_names,array[]::text[])) then 'fish' end,
      case when 'ไข่ไก่' = any(coalesce(v.ingredient_names,array[]::text[])) then 'egg' end
    ]::text[], null),
    'allergenFlags', array_remove(array[
      case when 'ถั่วลิสงคั่ว' = any(coalesce(v.ingredient_names,array[]::text[])) then 'peanut' end,
      case when 'ไข่ไก่' = any(coalesce(v.ingredient_names,array[]::text[])) then 'egg' end,
      case when 'กุ้งแห้ง' = any(coalesce(v.ingredient_names,array[]::text[])) then 'shrimp' end,
      case when 'ปลาช่อน' = any(coalesce(v.ingredient_names,array[]::text[])) or 'ปลานิล' = any(coalesce(v.ingredient_names,array[]::text[])) then 'fish' end
    ]::text[], null),
    'spiceLevel', case when v.name like 'ตำ%' then 3 when v.name like 'ต้มแซ่บ%' or v.name like 'ลาบ%' or v.name like 'น้ำตก%' or v.name like 'ยำ%' then 2 when v.name like '%สมุนไพร%' then 1 else 0 end,
    'sourLevel', case when v.name like 'ตำ%' or v.name like 'ต้มแซ่บ%' or v.name like 'ลาบ%' or v.name like 'น้ำตก%' or v.name like 'ยำ%' then 3 else 0 end,
    'sweetLevel', case when v.name like 'ตำไทย%' or v.name = 'ตำข้าวโพด' then 2 when v.category_name in ('ของหวาน','น้ำสมุนไพร') then 4 else 0 end,
    'richnessLevel', case when v.name like '%ทอด%' or v.name like '%คอหมู%' or v.name = 'เสือร้องไห้' then 4 when v.name like '%ย่าง%' or v.category_name = 'ของหวาน' then 3 else 2 end,
    'isanIntensity', case when 'น้ำปลาร้า' = any(coalesce(v.ingredient_names,array[]::text[])) then 5 when v.name like 'ลาบ%' or v.name like 'น้ำตก%' or v.name like 'ต้มแซ่บ%' or v.name = 'เสือร้องไห้' then 4 when v.name like 'ตำไทย%' or v.name like '%จิ้มแจ่ว%' then 3 else 2 end,
    'heaviness', case when v.category_name = 'ข้าว • เส้น • เคียง' and v.name like 'ข้าว%ย่าง%' then 4 when v.name like '%ทอด%' or v.name like '%ย่าง%' or v.name = 'เสือร้องไห้' then 4 when v.category_name = 'ของหวาน' then 3 when v.name like 'ต้ม%' or v.name like 'ตำ%' then 2 else 3 end,
    'shareability', case when v.category_name in ('น้ำสมุนไพร','เบียร์สด','Thai Craft Spirits','สุรา') then 1 when v.category_name = 'ข้าว • เส้น • เคียง' and (v.name like 'ข้าว%ย่าง%' or v.name like 'ข้าวคอหมู%') then 1 when v.category_name = 'ข้าว • เส้น • เคียง' then 2 else 4 end,
    'beginnerFriendly', case when v.name in ('ตำไทย','ตำข้าวโพด','คอหมูย่างจิ้มแจ่ว','ไก่บ้านย่างจิ้มแจ่ว','ทอดมันปลาช่อน','ไข่เจียวหมูสับ','ไข่เจียวสมุนไพร','ข้าวคอหมูย่างจิ้มแจ่ว','ข้าวเนื้อย่างจิ้มแจ่ว') then true when 'น้ำปลาร้า' = any(coalesce(v.ingredient_names,array[]::text[])) then false else v.category_name not in ('ลาบ • น้ำตก • ยำ') end,
    'kidFriendly', case when v.name in ('ไก่บ้านย่างจิ้มแจ่ว','ทอดมันปลาช่อน','ไข่เจียวหมูสับ','ไข่เจียวสมุนไพร','ข้าวคอหมูย่างจิ้มแจ่ว','ข้าวเนื้อย่างจิ้มแจ่ว','ข้าวหอมมะลิ','ข้าวเหนียว','ไอศกรีมกะทิสด','กล้วยบวชชี','ข้าวเหนียวดำเปียกมะพร้าวอ่อน') then true else false end,
    'occasionTags', array_remove(array[
      case when v.is_signature then 'first_visit' end,
      case when v.is_signature then 'signature' end,
      case when v.category_name in ('ย่าง • ทอด','ลาบ • น้ำตก • ยำ','เมนูปลา') then 'sharing' end,
      case when v.category_name in ('ย่าง • ทอด','ลาบ • น้ำตก • ยำ') then 'with_drinks' end,
      case when v.category_name = 'ของหวาน' then 'finish_meal' end,
      case when v.category_name = 'น้ำสมุนไพร' then 'refreshing' end
    ]::text[], null),
    'pairingTags', case when v.category_name = 'ตำ' then array['grill_or_fry','soup_or_steam','side']::text[] when v.category_name = 'ย่าง • ทอด' then array['salad','soup_or_steam','side']::text[] when v.category_name = 'ต้ม • นึ่ง' then array['salad','grill_or_fry','side']::text[] when v.category_name = 'ลาบ • น้ำตก • ยำ' then array['grill_or_fry','side','drink']::text[] when v.category_name = 'ของหวาน' then array['finish_meal']::text[] else array[]::text[] end,
    'curationVersion','v1'
  ),
  'auto',
  now()
from tamma_chart_os.restaurant_menu_live v
where v.menu_item_id is not null
on conflict (menu_item_id) do update set
  restaurant_id = excluded.restaurant_id,
  profile = case when tamma_chart_os.restaurant_menu_intelligence_profiles.curation_status = 'curated' then tamma_chart_os.restaurant_menu_intelligence_profiles.profile else excluded.profile end,
  updated_at = case when tamma_chart_os.restaurant_menu_intelligence_profiles.curation_status = 'curated' then tamma_chart_os.restaurant_menu_intelligence_profiles.updated_at else now() end;

insert into public.world_facts(fact_key,category,fact_value,verified,active,source,updated_at)
values(
  'restaurant_menu_intelligence_policy','operations',
  jsonb_build_object(
    'version','v1',
    'purpose','Help Thongthai recommend, compare and compose real restaurant menu choices from live menu + recipe + stock + curated profile metadata.',
    'rules',jsonb_build_array(
      'For any request asking what to eat, what is good, what suits a person/group, budget, taste, comparison, pairing, complete table/set, or what to add to an existing order, use the live restaurant menu and the intelligence profile; prefer calling list_restaurant_menu so the deterministic advisor result is available.',
      'Never recommend menu items that are not orderable. If a recommended item becomes unavailable, recompute with another orderable item rather than merely deleting it.',
      'Treat explicit avoidances and allergies as hard exclusions against known ingredient names and allergen flags. Do not claim the kitchen is cross-contamination-free; if the guest asks about a serious allergy, state that cross-contact controls are not verified and staff confirmation is appropriate.',
      'When the guest gives party size and/or budget, build a balanced table rather than a random list: cover complementary roles such as salad/tum, protein grill/fry, soup/steam, side/rice, then optional dessert/drink as budget allows.',
      'When the guest changes a constraint such as no pork/no pla-ra/less spicy, recompute the whole suggestion so the table remains balanced.',
      'When comparing dishes, compare only verified dimensions: ingredients, profile taste/texture, price, signature flag, live availability. Do not invent cooking details not present in verified data.',
      'Use guestContext constraints, budget and recent chat as preferences. When a guest explicitly states a durable food avoidance or taste preference, include a concise normalized form in contextUpdates.constraints so the same customer context can carry it forward.',
      'On LINE keep the answer compact: usually 2-5 choices or one complete set, total price, why it fits, and one useful caveat if needed.'
    ),
    'modes',jsonb_build_array('recommend','compare','compose_set','pairing','substitution','budget_fit','group_fit','constraint_filter'),
    'safety',jsonb_build_object('crossContaminationVerified',false,'medicalDietClaimsAllowed',false)
  ),
  true,true,'owner-configured restaurant menu intelligence policy',now()
)
on conflict (fact_key) do update set category=excluded.category,fact_value=excluded.fact_value,verified=true,active=true,source=excluded.source,updated_at=now();
