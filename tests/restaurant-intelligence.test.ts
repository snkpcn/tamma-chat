import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviseRestaurantMenu, normalizeRestaurantProfile, type RestaurantAdvisorItem } from '../netlify/functions/_restaurant-intelligence';

function item(overrides: Partial<RestaurantAdvisorItem> & Pick<RestaurantAdvisorItem,'name'|'price'>): RestaurantAdvisorItem {
  return {
    id:overrides.name,
    name:overrides.name,
    category:overrides.category ?? 'ย่าง • ทอด',
    price:overrides.price,
    signature:overrides.signature ?? false,
    orderable:overrides.orderable ?? true,
    availableServings:overrides.availableServings ?? 20,
    ingredients:overrides.ingredients ?? [],
    unavailableIngredients:overrides.unavailableIngredients ?? [],
    profile:overrides.profile ?? normalizeRestaurantProfile({ mealRoles:['main','share'], shareability:4, beginnerFriendly:true }),
  };
}

const menu: RestaurantAdvisorItem[] = [
  item({ name:'ตำไทย', price:89, category:'ตำ', signature:false, ingredients:['มะละกอดิบ','ถั่วลิสงคั่ว','กุ้งแห้ง'], profile:normalizeRestaurantProfile({mealRoles:['salad','share'],tasteTags:['sour','sweet'],allergenFlags:['peanut','shrimp'],spiceLevel:3,sweetLevel:2,isanIntensity:3,shareability:4,beginnerFriendly:true}) }),
  item({ name:'ตำลาว', price:79, category:'ตำ', ingredients:['มะละกอดิบ','น้ำปลาร้า'], profile:normalizeRestaurantProfile({mealRoles:['salad','share'],tasteTags:['sour','fermented_savory'],spiceLevel:3,isanIntensity:5,shareability:4}) }),
  item({ name:'ตำข้าวโพด', price:99, category:'ตำ', ingredients:['ข้าวโพด','ถั่วลิสงคั่ว'], profile:normalizeRestaurantProfile({mealRoles:['salad','share'],tasteTags:['sweet','sour'],allergenFlags:['peanut'],spiceLevel:1,sweetLevel:2,isanIntensity:2,shareability:4,beginnerFriendly:true,kidFriendly:true}) }),
  item({ name:'คอหมูย่างจิ้มแจ่ว', price:159, signature:true, ingredients:['คอหมู','น้ำจิ้มแจ่ว'], profile:normalizeRestaurantProfile({mealRoles:['grill_or_fry','protein','main','share'],proteinTags:['pork'],occasionTags:['signature','with_drinks'],pairingTags:['salad','soup_or_steam','side'],heaviness:4,shareability:4,beginnerFriendly:true}) }),
  item({ name:'เสือร้องไห้', price:189, signature:true, ingredients:['เนื้อวัว','น้ำจิ้มแจ่ว'], profile:normalizeRestaurantProfile({mealRoles:['grill_or_fry','protein','main','share'],proteinTags:['beef'],occasionTags:['signature','with_drinks'],pairingTags:['salad','soup_or_steam','side'],heaviness:4,isanIntensity:4,shareability:4}) }),
  item({ name:'ไก่บ้านย่างจิ้มแจ่ว', price:219, ingredients:['ไก่บ้าน','น้ำจิ้มแจ่ว'], profile:normalizeRestaurantProfile({mealRoles:['grill_or_fry','protein','main','share'],proteinTags:['chicken'],pairingTags:['salad','soup_or_steam','side'],heaviness:4,shareability:4,beginnerFriendly:true,kidFriendly:true}) }),
  item({ name:'ต้มแซ่บไก่บ้าน', price:179, category:'ต้ม • นึ่ง', ingredients:['ไก่บ้าน','ตะไคร้','มะนาว'], profile:normalizeRestaurantProfile({mealRoles:['soup_or_steam','main','share'],proteinTags:['chicken'],spiceLevel:2,sourLevel:3,isanIntensity:4,heaviness:2,shareability:4,pairingTags:['salad','grill_or_fry','side']}) }),
  item({ name:'ลาบปลาช่อน', price:169, category:'เมนูปลา', ingredients:['ปลาช่อน','ข้าวคั่ว'], profile:normalizeRestaurantProfile({mealRoles:['salad','protein','share'],proteinTags:['fish'],allergenFlags:['fish'],spiceLevel:2,sourLevel:3,isanIntensity:4,shareability:4}) }),
  item({ name:'ข้าวเหนียว', price:20, category:'ข้าว • เส้น • เคียง', ingredients:['ข้าวเหนียว'], profile:normalizeRestaurantProfile({mealRoles:['side'],heaviness:2,shareability:2,beginnerFriendly:true,kidFriendly:true}) }),
  item({ name:'ไอศกรีมกะทิสด', price:69, category:'ของหวาน', ingredients:['ไอศกรีมกะทิสด'], profile:normalizeRestaurantProfile({mealRoles:['dessert'],sweetLevel:4,heaviness:3,beginnerFriendly:true,kidFriendly:true}) }),
];

test('hard avoidance: no pork never recommends pork dishes', () => {
  const result = adviseRestaurantMenu(menu,{query:'มีอะไรแนะนำบ้าง ไม่กินหมู'});
  assert.equal(result.recommendations.some((row:any)=>row.name==='คอหมูย่างจิ้มแจ่ว'), false);
  assert.equal((result as any).parsed.avoidProteins.includes('pork'), true);
});

test('positive pork preference can recommend pork dishes', () => {
  const result = adviseRestaurantMenu(menu,{query:'ชอบหมู อยากกินอะไรแนะนำ'});
  assert.equal(result.recommendations.some((row:any)=>row.name==='คอหมูย่างจิ้มแจ่ว'), true);
  assert.equal((result as any).parsed.avoidProteins.includes('pork'), false);
});

test('allergy filtering removes direct known allergen and adds cross-contact notice', () => {
  const result = adviseRestaurantMenu(menu,{query:'แพ้ถั่ว แนะนำอะไรได้บ้าง'});
  assert.equal(result.recommendations.some((row:any)=>row.name==='ตำไทย'), false);
  assert.equal(result.notices.length > 0, true);
  assert.match(result.notices[0], /ปนเปื้อนข้าม/);
});

test('authentic Isan request prefers higher Isan intensity', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'เอาอีสานแท้ มีอะไรแนะนำ'});
  assert.ok(result.recommendations.slice(0,3).some((row:any)=>row.isanIntensity >= 4));
});

test('beginner or foreigner friendly request prefers beginner-friendly items', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'ฝรั่งกินง่าย คนไม่เคยกินอีสาน'});
  assert.equal(result.recommendations[0].beginnerFriendly, true);
});

test('kid context weights kid-friendly items', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'เด็กกินด้วย แนะนำอะไร'});
  assert.equal(result.recommendations[0].kidFriendly, true);
});

test('no spicy excludes high-spice items by policy', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'ไม่เผ็ด กินอะไรดี'});
  assert.equal(result.recommendations.some((row:any)=>row.spiceLevel >= 3), false);
});

test('compose set respects budget and includes complementary roles', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'มา 3 คน จัดให้หน่อย งบ 600',partySize:3,budget:600});
  assert.equal(result.mode,'compose_set');
  assert.ok(result.set.total <= 600);
  assert.ok(result.set.items.length >= 2);
  assert.ok(result.set.balancedRoles.includes('salad'));
  assert.ok(result.set.balancedRoles.some((role:string)=>role==='protein' || role==='soup_or_steam'));
});

test('very low group budget does not overflow and marks limited set', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'6 คน งบ 300 จัดให้หน่อย'});
  assert.equal(result.mode,'compose_set');
  assert.ok(result.set.total <= 300);
  assert.equal(result.set.limitedByBudget, true);
});

test('live availability is a hard gate even for a signature dish', () => {
  const unavailable = menu.map(row => row.name==='คอหมูย่างจิ้มแจ่ว' ? {...row,orderable:false,availableServings:0} : row);
  const result = adviseRestaurantMenu(unavailable,{query:'มาครั้งแรก เอาเมนูเด่นร้าน'});
  assert.equal(result.recommendations.some((row:any)=>row.name==='คอหมูย่างจิ้มแจ่ว'), false);
});

test('available_servings zero is a hard gate', () => {
  const unavailable = menu.map(row => row.name==='ไก่บ้านย่างจิ้มแจ่ว' ? {...row,availableServings:0} : row);
  const result = adviseRestaurantMenu(unavailable,{query:'เด็กกินด้วย แนะนำไก่'});
  assert.equal(result.recommendations.some((row:any)=>row.name==='ไก่บ้านย่างจิ้มแจ่ว'), false);
});

test('comparison mode returns only named real menu items with verified dimensions', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'ตำลาวกับตำไทยต่างกันยังไง'});
  assert.equal(result.mode,'compare');
  assert.deepEqual(result.comparison.map((row:any)=>row.name).sort(),['ตำลาว','ตำไทย']);
  assert.equal(result.comparison.every((row:any)=>typeof row.price==='number'), true);
});

test('pairing mode does not recommend the already selected dish again', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'มีตำลาวแล้ว เพิ่มอะไรดี'});
  assert.equal(result.mode,'pairing');
  assert.equal(result.recommendations.some((row:any)=>row.name==='ตำลาว'), false);
});

test('current pairing intent beats prior budget-set context', () => {
  const result:any = adviseRestaurantMenu(menu,{
    query:'มีตำลาวแล้ว เพิ่มอะไรดี',
    recentMessages:['มากัน 3 คน งบไม่เกิน 700 จัดชุดให้หน่อย'],
  });
  assert.equal(result.mode,'pairing');
  assert.equal(result.recommendations.some((row:any)=>row.name==='ตำลาว'), false);
});

test('no pla-ra excludes direct pla-ra ingredient dishes', () => {
  const result = adviseRestaurantMenu(menu,{query:'ไม่เอาปลาร้า มีอะไรแนะนำ'});
  assert.equal(result.recommendations.some((row:any)=>row.ingredients.includes('น้ำปลาร้า')), false);
});

test('customer changed constraint recomposes whole set without pork', () => {
  const first:any = adviseRestaurantMenu(menu,{query:'3 คน งบ 600 จัดชุดให้หน่อย'});
  assert.equal(first.mode,'compose_set');
  const second:any = adviseRestaurantMenu(menu,{
    query:'ไม่เอาหมู',
    recentMessages:['3 คน งบ 600 จัดชุดให้หน่อย'],
  });
  assert.equal(second.mode,'compose_set');
  assert.equal(second.set.items.some((line:any)=>line.name.includes('หมู')), false);
  assert.ok(second.set.balancedRoles.length >= 2);
});

test('advisor only returns real menu names', () => {
  const result:any = adviseRestaurantMenu(menu,{query:'มีอะไรอร่อยแนะนำ'});
  const realNames = new Set(menu.map(row=>row.name));
  assert.equal(result.recommendations.every((row:any)=>realNames.has(row.name)), true);
});
