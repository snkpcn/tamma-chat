// Phase L expansion: 70 additional meaningful semantic scenarios.
// Combined with the existing 89-case corpus this gives 159 stored semantic
// ground-truth cases before multi-turn/task/source/composer regression suites.
//
// These are intentionally different customer goals/state shapes rather than
// spelling-only duplicates. They remain network-free contract fixtures; the
// same ground truth is consumed by scripts/run-semantic-live-eval.ts during
// final live-provider acceptance.
import type { SemanticContext } from '../../netlify/functions/_semantic-interpreter';
import type { SemanticEvalCase, SemanticEvalCategory } from './semantic-eval-corpus';

function out(
  domain: SemanticEvalCase['expected']['domain'],
  intent: string,
  action: NonNullable<SemanticEvalCase['expected']['action']>,
  entities: Record<string,unknown> = {},
  constraints: string[] = [],
  confidence = 0.86,
  needsClarification = false,
  informationNeed?: string,
): Record<string,unknown> {
  return {
    domain,intent,action,
    ...(informationNeed ? { informationNeed } : {}),
    entities,references:[],constraints,confidence,needsClarification,
  };
}

function c(
  id:string,
  category:SemanticEvalCategory,
  domain:SemanticEvalCase['expected']['domain'],
  message:string,
  action:NonNullable<SemanticEvalCase['expected']['action']>,
  intent:string,
  entities:Record<string,unknown>={},
  context?:SemanticContext,
  constraints:string[]=[],
  needsClarification=false,
  informationNeed?:string,
): SemanticEvalCase {
  return {
    id,category,domainArea:domain,message,context,
    expected:{domain,action,needsClarification},
    simulatedModelOutput:out(domain,intent,action,entities,constraints,0.86,needsClarification,informationNeed),
  };
}

const ACTIVITY_CONTEXT:SemanticContext={
  activeDomain:'activity',
  recentEntities:[
    {id:'horse:paradon',type:'horse',name:'ภาราดร',domain:'activity',source:'conversation',canonical:false},
    {id:'activity:atv',type:'activity',name:'ATV',domain:'activity',source:'catalog',canonical:true},
  ],
  lastAction:'ask',
};
const RESTAURANT_CONTEXT:SemanticContext={
  activeDomain:'restaurant',
  recentEntities:[{id:'menu_set:set-1',type:'proposed_set',name:'ชุดแนะนำ',domain:'restaurant',source:'tool_result',canonical:true}],
  lastAction:'recommend',
  openQuestion:'pickup details',
};
const STAY_CONTEXT:SemanticContext={
  activeDomain:'stay',
  recentEntities:[{id:'stay:house-1',type:'stay_unit',name:'บ้านแนะนำ',domain:'stay',source:'catalog',canonical:true}],
  lastAction:'recommend',
};
const PROMO_CONTEXT:SemanticContext={
  activeDomain:'promotion',
  recentEntities:[{id:'promo:p1',type:'promotion',name:'โปรล่าสุด',domain:'promotion',source:'catalog',canonical:true}],
  lastAction:'discover',
};
const OTOP_CONTEXT:SemanticContext={
  activeDomain:'otop',
  recentEntities:[{id:'otop:honey',type:'product',name:'น้ำผึ้งป่า',domain:'otop',source:'catalog',canonical:true}],
  lastAction:'ask',
};
const CAFE_CONTEXT:SemanticContext={
  activeDomain:'cafe',
  recentEntities:[{id:'cafe:drink',type:'cafe_item',name:'เครื่องดื่มที่ถาม',domain:'cafe',source:'conversation',canonical:false}],
  lastAction:'ask',
};
const JOURNEY_CONTEXT:SemanticContext={
  activeDomain:'journey',
  recentEntities:[{id:'journey:current',type:'journey',name:'แผนปัจจุบัน',domain:'journey',source:'conversation',canonical:false}],
  lastAction:'recommend',
};

export const PHASE_L_SEMANTIC_CASES:SemanticEvalCase[]=[
  // Activity — availability/capacity/safety/recommendation/change/cancel.
  c('l-activity-01','formal','activity','ราคาขี่ม้าตอนนี้เท่าไหร่ครับ','ask','ask_horse_price',{activityType:'horse'}),
  c('l-activity-02','formal','activity','เด็ก 7 ขวบขี่ม้าได้ไหม','ask','ask_horse_child_policy',{activityType:'horse',childAge:7}),
  c('l-activity-03','formal','activity','ATV สามคันออกพร้อมกันได้ไหม','ask','ask_atv_capacity',{activityType:'atv',quantity:3}),
  c('l-activity-04','colloquial','activity','ไม่เคยยิงธนูเลย เล่นได้ปะ','ask','ask_archery_beginner',{activityType:'archery'},undefined,['beginner']),
  c('l-activity-05','correction','activity','เปลี่ยนจาก ATV เป็นขี่ม้าแทน','correct_previous','change_activity',{activityType:'horse'},ACTIVITY_CONTEXT),
  c('l-activity-06','cancel','activity','ไม่เอากิจกรรมแล้ว ยกเลิกก่อน','cancel','cancel_activity',{},ACTIVITY_CONTEXT),
  c('l-activity-07','formal','activity','จอง ATV วันเสาร์ 3 คน','book','book_atv',{activityType:'atv',date:'วันเสาร์',partySize:3}),
  c('l-activity-08','follow_up','activity','บ่ายสามว่างไหม','status','check_activity_time',{time:'15:00'},ACTIVITY_CONTEXT,[],false,'availability'),
  c('l-activity-09','colloquial','activity','อยากทำอะไรชิล ๆ ไม่เหนื่อย','recommend','recommend_low_effort_activity',{},undefined,['low_effort']),
  c('l-activity-10','formal','activity','ช่วยเทียบขี่ม้ากับ ATV ให้หน่อย','compare','compare_activities',{options:['horse','atv']}),

  // Restaurant — constraints, recommendation, preorder/status/correction.
  c('l-restaurant-01','formal','restaurant','มีเมนูปลาที่พร้อมขายไหม','ask','ask_fish_menu',{ingredientCategory:'fish'}),
  c('l-restaurant-02','formal','restaurant','มากันสองคน งบ 500 แนะนำให้หน่อย','recommend','recommend_for_budget',{partySize:2,budget:500}),
  c('l-restaurant-03','colloquial','restaurant','ไม่กินหมู เอาอะไรดี','recommend','recommend_without_pork',{},undefined,['no_pork']),
  c('l-restaurant-04','formal','restaurant','แพ้ถั่ว มีเมนูไหนควรเลี่ยงบ้าง','ask','ask_allergen_menu',{allergen:'peanut'},undefined,['peanut_allergy']),
  c('l-restaurant-05','follow_up','restaurant','เอาชุดเดิมครับ','confirm','confirm_previous_set',{},RESTAURANT_CONTEXT),
  c('l-restaurant-06','correction','restaurant','เปลี่ยนเวลารับเป็นบ่ายสอง','correct_previous','change_pickup_time',{time:'14:00'},RESTAURANT_CONTEXT),
  c('l-restaurant-07','cancel','restaurant','ยกเลิกออเดอร์เมื่อกี้','cancel','cancel_preorder',{},RESTAURANT_CONTEXT),
  c('l-restaurant-08','follow_up','restaurant','ออเดอร์เมื่อกี้ถึงไหนแล้ว','status','preorder_status',{},RESTAURANT_CONTEXT,[],false,'transaction_status'),
  c('l-restaurant-09','confirmation_gating','restaurant','สั่งชุดนี้เลยครับ','order','submit_preorder',{},RESTAURANT_CONTEXT),
  c('l-restaurant-10','formal','restaurant','มีเมนูสำหรับเด็กไหม','ask','ask_child_friendly_menu',{travelerType:'family'}),

  // Stay — policy, capacity, recommend, modify, cancel, status.
  c('l-stay-01','formal','stay','เช็กอินได้ตั้งแต่กี่โมง','ask','ask_checkin_time'),
  c('l-stay-02','typo','stay','เช็คเอ้าท์กี่โมงคับ','ask','ask_checkout_time'),
  c('l-stay-03','formal','stay','มีบ้านสองห้องนอนไหม','ask','ask_two_bedroom_stay',{bedrooms:2}),
  c('l-stay-04','formal','stay','สี่คนคืนเดียว แนะนำหลังไหนดี','recommend','recommend_stay',{partySize:4,nights:1}),
  c('l-stay-05','formal','stay','จองบ้านพักวันศุกร์หนึ่งคืน','book','book_stay',{checkIn:'วันศุกร์',nights:1}),
  c('l-stay-06','correction','stay','เปลี่ยนเป็นสองคืนครับ','correct_previous','change_stay_nights',{nights:2},STAY_CONTEXT),
  c('l-stay-07','cancel','stay','ขอยกเลิกห้องที่จองไว้','cancel','cancel_stay',{},STAY_CONTEXT),
  c('l-stay-08','follow_up','stay','สถานะจองห้องตอนนี้เป็นยังไง','status','stay_booking_status',{},STAY_CONTEXT,[],false,'transaction_status'),
  c('l-stay-09','follow_up','stay','เอาหลังเดิมที่แนะนำ','confirm','select_recommended_stay',{},STAY_CONTEXT),
  c('l-stay-10','formal','stay','อยากได้หลังเงียบ ๆ แนะนำหน่อย','recommend','recommend_quiet_stay',{},undefined,['quiet']),

  // Promotions — discovery, applicability, eligibility, redemption/cancel.
  c('l-promo-01','formal','promotion','วันนี้มีโปรโมชั่นอะไรเปิดอยู่บ้าง','discover','discover_current_promotions'),
  c('l-promo-02','formal','promotion','มีโปรของร้านอาหารไหม','discover','discover_restaurant_promotions',{businessUnit:'restaurant'}),
  c('l-promo-03','formal','promotion','กิจกรรมมีโปรอะไรบ้าง','discover','discover_activity_promotions',{businessUnit:'activity'}),
  c('l-promo-04','follow_up','promotion','โปรนี้ยังใช้ได้ไหม','status','promotion_status',{},PROMO_CONTEXT,[],false,'availability'),
  c('l-promo-05','confirmation_gating','promotion','ใช้โปรนี้เลยครับ','confirm','accept_promotion',{},PROMO_CONTEXT),
  c('l-promo-06','cancel','promotion','ไม่ใช้โปรนี้แล้ว ยกเลิกครับ','cancel','cancel_promotion',{},PROMO_CONTEXT),
  c('l-promo-07','formal','promotion','โปรนี้หมดเขตวันไหน','ask','ask_promotion_end',{},PROMO_CONTEXT),
  c('l-promo-08','formal','promotion','โปรนี้ใช้ผ่าน LINE ได้ไหม','ask','ask_promotion_channel',{channel:'line'},PROMO_CONTEXT),

  // Membership — informational/status/update/cancel.
  c('l-member-01','formal','membership','สมัครสมาชิกยังไงครับ','ask','ask_membership_signup'),
  c('l-member-02','confirmation_gating','membership','สมัครสมาชิกเลยครับ','confirm','confirm_membership_signup'),
  c('l-member-03','formal','membership','สถานะสมาชิกของผมเป็นยังไง','status','membership_status',{},undefined,[],false,'transaction_status'),
  c('l-member-04','formal','membership','ขอเปลี่ยนข้อมูลสมาชิกได้ไหม','modify','modify_membership_profile'),
  c('l-member-05','cancel','membership','ขอยกเลิกสมาชิก','cancel','cancel_membership'),
  c('l-member-06','formal','membership','สมาชิกได้สิทธิอะไรบ้าง','discover','discover_membership_benefits'),

  // OTOP — catalog, price, stock, order/modify/cancel.
  c('l-otop-01','formal','otop','มีของฝากอะไรบ้าง','discover','discover_otop_products'),
  c('l-otop-02','formal','otop','น้ำผึ้งป่าราคาเท่าไหร่','ask','ask_otop_price',{productName:'น้ำผึ้งป่า'}),
  c('l-otop-03','follow_up','otop','อันนี้ยังมีของไหม','status','ask_otop_stock',{},OTOP_CONTEXT,[],false,'inventory'),
  c('l-otop-04','confirmation_gating','otop','เอาน้ำผึ้งสองขวด สั่งเลย','order','order_otop',{productName:'น้ำผึ้งป่า',quantity:2},OTOP_CONTEXT),
  c('l-otop-05','correction','otop','เปลี่ยนเป็นสามขวด','modify','modify_otop_quantity',{quantity:3},OTOP_CONTEXT),
  c('l-otop-06','cancel','otop','ยกเลิกออเดอร์ของฝากเมื่อกี้','cancel','cancel_otop_order',{},OTOP_CONTEXT),

  // Café — intentionally informational while no verified live catalog exists.
  c('l-cafe-01','formal','cafe','อินทนินเปิดอยู่ไหม','status','ask_cafe_open',{},undefined,[],false,'availability'),
  c('l-cafe-02','formal','cafe','คาเฟ่มีเมนูอะไรบ้าง','discover','discover_cafe_menu'),
  c('l-cafe-03','colloquial','cafe','มีลาเต้ปะ','ask','ask_cafe_item',{itemName:'ลาเต้'}),
  c('l-cafe-04','formal','cafe','อยากถามเรื่องเครื่องดื่มเย็น','ask','ask_cafe_drinks',{category:'cold_drink'}),
  c('l-cafe-05','follow_up','cafe','แก้วนี้ราคาเท่าไหร่','ask','ask_cafe_price',{},CAFE_CONTEXT),

  // Payment — information/status/cancel only; semantic layer never verifies money itself.
  c('l-payment-01','formal','payment','ชำระเงินยังไงครับ','ask','ask_payment_method'),
  c('l-payment-02','follow_up','payment','ส่งสลิปแล้วครับ','provide_information','payment_proof_submitted',{proofSubmitted:true}),
  c('l-payment-03','formal','payment','สถานะการชำระเงินถึงไหนแล้ว','status','payment_status',{},undefined,[],false,'transaction_status'),
  c('l-payment-04','formal','payment','ยอดที่ต้องจ่ายเท่าไหร่','ask','ask_payment_amount'),
  c('l-payment-05','colloquial','payment','จ่ายแล้วทำไมยังขึ้นว่ารออยู่','status','payment_pending_after_payment',{},undefined,[],false,'transaction_status'),
  c('l-payment-06','cancel','payment','ขอยกเลิกรายการชำระนี้','cancel','cancel_payment'),

  // Journey / ecosystem / support — planning, modification, resume, vague support.
  c('l-journey-01','formal','journey','ช่วยจัดทริปครึ่งวันให้หน่อย','recommend','recommend_half_day_journey',{duration:'half_day'}),
  c('l-journey-02','formal','journey','มากับครอบครัว มีเด็กกับผู้สูงอายุ ช่วยจัดแผนให้หน่อย','recommend','recommend_family_journey',{travelerType:'family'},undefined,['children','elderly']),
  c('l-journey-03','colloquial','journey','วันนี้อยากชิล ๆ ไม่รีบ จัดให้หน่อย','recommend','recommend_slow_journey',{},undefined,['slow_pace']),
  c('l-journey-04','multi_intent','journey','ก่อนกินข้าวอยากทำกิจกรรมเบา ๆ สักอย่าง','recommend','recommend_pre_meal_activity',{},undefined,['low_effort','before_meal']),
  c('l-journey-05','correction','journey','เปลี่ยนแผน ไม่เอากิจกรรมผจญภัยแล้ว','modify','modify_journey_remove_adventure',{},JOURNEY_CONTEXT,['no_adventure']),
  c('l-journey-06','follow_up','journey','กลับไปแผนเดิมได้ไหม','correct_previous','restore_previous_journey',{},JOURNEY_CONTEXT),
  c('l-journey-07','follow_up','journey','ช่วยต่อจากเมื่อกี้ให้หน่อย','ask','resume_journey',{},JOURNEY_CONTEXT),
  c('l-support-01','ambiguous','support','ไม่เข้าใจ ช่วยหน่อย','unknown','vague_support',{},undefined,[],true),
  c('l-support-02','formal','support','ขอคุยกับทีมงานได้ไหม','ask','request_human_support'),

  // Extra Phase L breadth — cross-domain planning and less common customer goals.
  c('l-journey-08','formal','journey','พาแม่มาเที่ยว ไม่อยากเดินเยอะ ช่วยจัดแผนให้หน่อย','recommend','recommend_low_walking_journey',{travelerType:'family'},undefined,['low_walking']),
  c('l-journey-09','multi_intent','journey','มีอะไรทำแล้วไปกินข้าวต่อได้พอดี','recommend','recommend_activity_then_meal',{},undefined,['before_meal']),
  c('l-journey-10','multi_intent','journey','อยากขี่ม้าแล้วพักค้างคืน ช่วยจัดให้หน่อย','recommend','recommend_horse_and_stay',{activityType:'horse',nights:1}),
  c('l-topic-activity-01','topic_switch','activity','ไม่เอาห้องแล้ว ขอไปดูกิจกรรมแทน','discover','switch_from_stay_to_activity'),
  c('l-promo-09','formal','promotion','โปรร้านอาหารกับที่พักใช้ร่วมกันได้ไหม','ask','ask_cross_business_promotion',{businessUnits:['restaurant','stay']}),
  c('l-promo-10','formal','promotion','ถ้าเป็นสมาชิก ใช้โปรนี้ได้ไหม','ask','ask_member_promotion_eligibility',{membershipRequired:true},PROMO_CONTEXT),
  c('l-payment-07','formal','payment','สลิปไม่ผ่าน ต้องทำยังไงต่อ','ask','ask_payment_rejection_next_step'),
  c('l-otop-07','formal','otop','ของฝากอันไหนเหมาะซื้อเป็นของขวัญ','recommend','recommend_otop_gift'),
  c('l-cafe-06','correction','cafe','แก้วเมื่อกี้เอาแบบไม่หวาน','modify','modify_cafe_preference',{sweetness:'none'},CAFE_CONTEXT,['no_sugar']),
  c('l-journey-11','confirmation_gating','journey','เอาแผนนี้เลย','confirm','confirm_current_journey',{},JOURNEY_CONTEXT),
];

export const PHASE_L_TOTAL_NEW_CASES=PHASE_L_SEMANTIC_CASES.length;
