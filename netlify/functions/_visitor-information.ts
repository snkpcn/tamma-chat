import { USER_VENUE_FACTS, CAFE_PRICE_REFERENCES, CAFE_PRICE_REFERENCE_PROVENANCE } from './_user-supplied-venue-facts';
// Bounded, read-only visitor-information topics. No bookings, notifications,
// cancellations or payment actions are permitted here. Unknown operational
// fields stay unknown; a catalog entry never proves today's opening status.
import { normalizeCustomerText } from './_customer-text';
import { ORGANIZATION_CONFIG, INTHANIN_TADTONE_CONFIG } from './_organization-config';
import { ECOSYSTEM_ENTITY_GRAPH } from './_ecosystem-entity-graph';
import { buildRealKnowledgeSourceAdapters } from './_dialog-source-adapters';
import { resolveKnowledge, type KnowledgeSourceAdapters } from './_knowledge-resolver';
import type { BrainChannel } from './_thongthai-brain-v3';

export type VisitorTopic = 'overview'|'brand_relationship'|'admission'|'facilities'|'accessibility'
  |'horse_reference_quote'|'cafe_menu_reference'|'food_browse'|'restaurant_opening'|'group_tables'|'activity_opening'|'horse_instruction'
  |'horse_child_safety'|'horse_weight'|'boat_safety'|'weather_changes'|'stay_opening'
  |'stay_availability'|'package'|'product_origin'|'product_browse'|'shipping';
export type VisitorInformationAnswer = {
  topic:VisitorTopic|'public_lookup'; message:string; sourceIds:string[]; usedFactKeys:string[];
  missingFields:string[]; domain:'ecosystem'|'restaurant'|'activity'|'stay'|'otop'|'cafe';
};

export function classifyVisitorInformation(message:string):VisitorTopic|null {
  const text=normalizeCustomerText(message);
  // A factual question must never authorize a financial or staff action.
  if(/(?:ช่วย|รบกวน|ดำเนินการ).{0,35}(?:จอง|ยกเลิก|คืนเงิน|สั่ง|ติดต่อ|ส่งเรื่อง)|ขอคืนเงิน|ขอยกเลิก|จองให้|ยกเลิกให้|ส่งเรื่องให้|ติดต่อให้|เกิดอุบัติเหตุ|บาดเจ็บ|ร้องเรียน/u.test(text))return null;
  const horse=/ขี่ม้า|horse/iu.test(text);
  if(/ฝน|อากาศ/u.test(text) && /เลื่อน|คืนเงิน|ยกเลิก/u.test(text) && /ได้ไหม|ได้มั้ย|เงื่อนไข|อย่างไร|ยังไง/u.test(text))return 'weather_changes';
  if(/รถเข็น|วีลแชร์|wheelchair/iu.test(text) && /สะดวก|ทางลาด|เข้าถึง|เที่ยวได้|ใช้งาน|เข็นไป|เข็นเข้า/u.test(text))return 'accessibility';
  if(/ค่าเข้า|ค่าผ่านประตู|ค่าเข้าชม|เสียค่าเข้าชม|admission/iu.test(text))return 'admission';
  if(/ที่จอดรถ|ห้องน้ำ/u.test(text) && /มี|ไหม|มั้ย|สะดวก|ตรงไหน/u.test(text)
      && !/ของหาย|หาย|สกปรก|เสียหาย|ขโมย|ร้องเรียน/u.test(text))return 'facilities';
  if(/อินทนิ[ลน]|inthanin/iu.test(text) && /ทำมา[-\s]?ชาติ/u.test(text)
      && /เดียวกัน|ที่เดียว|เกี่ยวข้อง|เป็นส่วน|ต่างกัน/u.test(text))return 'brand_relationship';
  if(/ทำมา[-\s]?ชาติ/u.test(text) && /คืออะไร|มีอะไรให้เที่ยว|มีอะไรให้ทำ|มีอะไรบ้าง/u.test(text)
      && !/ตอนนี้|วันนี้|เปิดให้|ราคา|จอง/u.test(text))return 'overview';
  if(/(?:ร้าน)?ตำมา[-\s]?ชาติ|ร้านอาหาร/u.test(text) && /เปิดแล้ว|เปิดหรือยัง|เปิดให้บริการ|เปิดอยู่/u.test(text))return 'restaurant_opening';
  if(/(?:\d+|สิบห้า|หลาย|หมู่คณะ)\s*(?:คน|ท่าน)|กรุ๊ป|กลุ่มใหญ่/u.test(text)
      && /ต้องจอง|ควรจอง|จำเป็น.*จอง|จองโต๊ะไหม/u.test(text))return 'group_tables';
  const cafePriceTopic=CAFE_PRICE_REFERENCES.some(item=>item.aliases.some(alias=>text.toLowerCase().includes(alias.toLowerCase())));
  if(!/แพ้|สารก่อภูมิแพ้|กินได้ไหม|เด็ก|ไม่เผ็ด/u.test(text) && ((cafePriceTopic && /ราคา|กี่บาท|เท่าไร|เท่าไหร่|เมนู|ช็อต|shot/iu.test(text))
      || /(?:อินทนิ[ลน]|คาเฟ่).*ราคา|(?:ขอเมนู|ดูเมนู|ราคา).*(?:อินทนิ[ลน]|คาเฟ่)|ครัวซองต์|เบเกอรี|เค้ก|ขนมปัง/iu.test(text)))return 'cafe_menu_reference';
  if(/(?:กิน|อาหาร|ของกิน)/u.test(text) && /นอกจากกาแฟ|นอกจากเครื่องดื่ม|ที่ไม่ใช่กาแฟ/u.test(text))return 'food_browse';
  if(horse && /ชั่วโมงครึ่ง|90\s*นาที|1[.:]30/u.test(text) && /ราคา|500|ใช่ไหม|กี่บาท|เท่าไร|เท่าไหร่/u.test(text))return 'horse_reference_quote';
  if(horse && /น้ำหนัก|กิโล|กก\.?/u.test(text))return 'horse_weight';
  if(horse && /เด็ก|ขวบ|อายุ/u.test(text) && /ได้ไหม|ได้มั้ย|เหมาะ|ขั้นต่ำ|จำกัด/u.test(text))return 'horse_child_safety';
  if(horse && /คนสอน|สอนขี่|ครูฝึก|คนจูง|เจ้าหน้าที่สอน/u.test(text) && /ไหม|มั้ย|มีคน|เงื่อนไข|อย่างไร|ยังไง/u.test(text))return 'horse_instruction';
  if(/เป็ดน้ำ|เรือเป็ด|ปั่นเป็ด/u.test(text) && /กี่คน|ชูชีพ|ปลอดภัย|จำกัดคน/u.test(text))return 'boat_safety';
  if(/กิจกรรม|ATV|เอทีวี|ยิงธนู/u.test(text) && /เปิด.*(?:จริง|แล้ว|ยัง)|เล่นได้จริง|เปิดให้เล่น|เปิดอยู่/u.test(text))return 'activity_opening';
  if(/เฮือนสเตย์|ที่พัก|ห้องพัก/u.test(text) && /แพ็กเกจ|แพคเกจ|รวมอาหาร|รวมกิจกรรม/u.test(text))return 'package';
  if(/ห้องว่าง|ที่พักว่าง/u.test(text) && /คืนนี้|วันนี้|พรุ่งนี้|\d|คน|ไหม|มั้ย/u.test(text))return 'stay_availability';
  if(/เฮือนสเตย์|ที่พัก|ห้องพัก/u.test(text) && /เปิด.*(?:แล้ว|ยัง)|เปิดให้พัก/u.test(text))return 'stay_opening';
  if(/ของฝาก|OTOP|โอทอป/iu.test(text) && /มี.*(?:อะไร|ขาย)|ขายอะไร|ขอดูรายการ/u.test(text))return 'product_browse';
  if(/สินค้า|ของฝาก|ชิ้นนี้|อันนี้/u.test(text) && /ใคร.*ทำ|คนทำ|ชุมชน|ผลิต|มาจาก/u.test(text))return 'product_origin';
  if(/ของฝาก|สินค้า|จัดส่ง|ค่าส่ง/u.test(text) && /ส่งไป|กรุงเทพ|จัดส่ง|ค่าส่ง/u.test(text)
      && /ได้ไหม|ได้มั้ย|เท่าไร|เท่าไหร่|อย่างไร|ยังไง/u.test(text))return 'shipping';
  return null;
}

export async function answerVisitorInformation(input:{
  message:string; channel:BrainChannel; environment?:'live'|'test';
  adapters?:KnowledgeSourceAdapters;
}):Promise<VisitorInformationAnswer|null> {
  const topic=classifyVisitorInformation(input.message);
  if(!topic)return null;
  const result:VisitorInformationAnswer={topic,message:'',domain:'ecosystem',sourceIds:[],usedFactKeys:[],missingFields:[]};
  const unknown=(fields:string[],message:string,domain:VisitorInformationAnswer['domain']='ecosystem')=>{
    result.missingFields=fields;result.message=message;result.domain=domain;return result;
  };
  switch(topic) {
    case 'overview': {
      const units=(ECOSYSTEM_ENTITY_GRAPH.children ?? []).map(unit=>unit.label.replace(/\s*\([^)]*\)/gu,''));
      const activities=(ECOSYSTEM_ENTITY_GRAPH.children ?? []).flatMap(unit=>(unit.children ?? []).filter(node=>node.type==='activity').map(node=>node.label.replace(/\s*\([^)]*\)/gu,'')));
      result.message=`${ORGANIZATION_CONFIG.taglineTh}\n${ORGANIZATION_CONFIG.descriptionTh}\nทำมา-ชาติเป็นพื้นที่ท่องเที่ยวแถว${ORGANIZATION_CONFIG.locationTh.replace(' • ',' จังหวัด')} รวม ${units.join(' · ')}ครับ`
        +`\nในภาพรวมมีกิจกรรม ${activities.join(' · ')} ส่วนกิจกรรมที่เปิดจริงในวันเดินทางต้องเช็กสถานะล่าสุดอีกครั้งครับ`;
      result.sourceIds=['canonical_ecosystem_graph',ORGANIZATION_CONFIG.sourceId];return result;
    }
    case 'brand_relationship':
      result.message=`${INTHANIN_TADTONE_CONFIG.nameTh}เป็นคาเฟ่ส่วนหนึ่งในพื้นที่ทำมา-ชาติครับ ทำมา-ชาติเป็นภาพรวมของพื้นที่ที่รวมคาเฟ่ ร้านอาหาร กิจกรรม และเฮือนสเตย์ ส่วนอินทนิลเป็นชื่อคาเฟ่ในพื้นที่นี้ครับ`;
      result.sourceIds=['canonical_ecosystem_graph',INTHANIN_TADTONE_CONFIG.sourceId];return result;
    case 'admission':
      result.message='เข้าคาเฟ่อินทนิล สาขาตาดโตน จอดรถ ถ่ายรูปในสวนหย่อม และเดินชมบึงน้ำได้ฟรี ไม่มีค่าเข้าบริการส่วนนี้ครับ ชำระเฉพาะอาหาร เครื่องดื่ม และบริการเสริม เช่น กิจกรรม ส่วนโซนอื่นต้องเช็กเงื่อนไขแยกครับ';
      result.sourceIds=[USER_VENUE_FACTS.sourceId];result.usedFactKeys=['cafe:admission'];return result;
    case 'facilities': {
      if(/ที่พัก|เฮือน|ห้องพัก|กิจกรรม|ร้านอาหาร|ตำมา-ชาติ/u.test(input.message) && !/อินทนิ[ลน]|คาเฟ่/u.test(input.message))return unknown(['requested_unit.facilities'],'ข้อมูลที่มีตอนนี้ยืนยันที่จอดรถและห้องน้ำฝั่งคาเฟ่อินทนิลตาดโตนครับ ยังไม่มีข้อมูลแยกของส่วนที่ถาม ต้องเช็กกับทีมงานอีกครั้งครับ');
      const parking=/ที่จอดรถ/u.test(input.message),toilets=/ห้องน้ำ/u.test(input.message);
      const lines=['ฝั่งคาเฟ่อินทนิล สาขาตาดโตนครับ'];
      if(parking)lines.push('มีที่จอดรถเป็นลานกว้างขวางด้านหน้าร้าน พร้อมช่องจอดสำหรับผู้สูงอายุ/ผู้พิการอยู่ใกล้ทางลาดเข้าตัวร้าน');
      if(toilets)lines.push('มีห้องน้ำแยกเป็นสัดส่วน และห้องน้ำสำหรับผู้สูงอายุ/ผู้ใช้วีลแชร์ มีพื้นที่หมุนรถเข็นและราวจับ');
      result.message=lines.join('\n');result.sourceIds=[USER_VENUE_FACTS.sourceId];
      result.usedFactKeys=[...(parking?['cafe:parking']:[]),...(toilets?['cafe:toilets']:[])];return result;
    }
    case 'accessibility':
      result.message='ฝั่งคาเฟ่อินทนิล สาขาตาดโตน มีช่องจอดสำหรับผู้สูงอายุ/ผู้พิการใกล้ทางลาดเข้าสู่ตัวร้าน และมีห้องน้ำสำหรับผู้ใช้วีลแชร์ที่มีพื้นที่หมุนรถเข็นกับราวจับครับ ข้อมูลนี้ครอบคลุมทางเข้าคาเฟ่และห้องน้ำ ส่วนเส้นทางไปสวน กิจกรรม หรือที่พักแต่ละโซนยังต้องเช็กกับทีมงาน และยังไม่มีข้อมูลบริการรถเข็นให้ยืมหรือเช่าครับ';
      result.sourceIds=[USER_VENUE_FACTS.sourceId];result.usedFactKeys=['cafe:parking','cafe:ramp','cafe:accessible_toilets'];
      result.missingFields=['venue.all_zone_accessibility','venue.wheelchair_loan'];return result;
    case 'restaurant_opening':
      result.sourceIds=[USER_VENUE_FACTS.sourceId];result.usedFactKeys=['restaurant:expanded_phase','restaurant:menu_examples'];
      return unknown(['restaurant.current_opening_status','restaurant.opening_hours'],'ข้อมูลที่ได้รับระบุว่าขยายเฟสเป็นร้านอาหารแล้ว มีเมนูส้มตำ ไก่ทอด คอหมูย่าง และของเคียงครับ แต่ยังไม่มีข้อมูลยืนยันเวลาเปิดร้านอาหารกับสถานะรับลูกค้าในวันเดินทาง เวลา 06:00–18:00 น. ที่มีเป็นข้อมูลเวลารวม/คาเฟ่ครับ','restaurant');
    case 'group_tables': {
      const size=input.message.match(/(\d+)\s*(?:คน|ท่าน)/u)?.[1];
      return unknown(['restaurant.group_reservation_policy','restaurant.table_capacity'],`ถ้าไป${size?`ประมาณ ${size} คน`:'เป็นกลุ่มใหญ่'} แนะนำติดต่อร้านล่วงหน้าเพื่อให้ทีมงานเช็กโต๊ะและเตรียมรับกลุ่มครับ แต่ตอนนี้ยังไม่มีนโยบายยืนยันว่าต้องจองหรือไม่ รวมถึงจำนวนโต๊ะว่าง ยังไม่ได้ทำรายการจองให้ครับ`,'restaurant');
    }
    case 'activity_opening':
      return unknown(['activities.current_operating_status'],'ตอนนี้ยังไม่มีข้อมูลสถานะเปิดให้เล่นจริงแบบล่าสุดของกิจกรรมครับ การมีชื่อขี่ม้า เป็ดน้ำ ATV หรือยิงธนูในรายการแนะนำไม่ได้แปลว่าเปิดครบทุกอย่างวันนี้ ควรให้ทีมงานยืนยันกิจกรรมที่เปิดและรอบเล่นในวันเดินทางครับ','activity');
    case 'horse_instruction':
      return unknown(['horse.beginner_eligibility','horse.instructor_service'],'ถ้าไม่เคยขี่ม้ามาก่อน ต้องให้ทีมกิจกรรมประเมินความเหมาะสมก่อนครับ ตอนนี้ยังไม่มีข้อมูลยืนยันเรื่องเงื่อนไขสำหรับมือใหม่หรือบริการคนสอน/จูงม้า จึงยังรับปากว่าเล่นได้หรือมีคนสอนให้ไม่ได้ครับ','activity');
    case 'horse_child_safety': {
      const age=input.message.match(/(?:อายุ\s*)?(\d+)\s*(?:ขวบ|ปี)/u)?.[1];
      return unknown(['horse.minimum_age','horse.child_riding_conditions'],`สำหรับ${age?`เด็กอายุ ${age} ขวบ`:'เด็ก'} ยังไม่มีข้อมูลยืนยันอายุขั้นต่ำและเงื่อนไขการขี่ม้าครับ ต้องให้ทีมกิจกรรมประเมินก่อน ไม่ควรสรุปว่าเล่นได้จากอายุอย่างเดียวครับ`,'activity');
    }
    case 'horse_weight':
      return unknown(['horse.maximum_rider_weight'],'ตอนนี้ยังไม่มีข้อมูลยืนยันน้ำหนักสูงสุดสำหรับขี่ม้าครับ ควรแจ้งน้ำหนักผู้เล่นให้ทีมกิจกรรมตรวจเงื่อนไขก่อน ยังไม่สามารถระบุตัวเลขหรือรับรองว่าเล่นได้ครับ','activity');
    case 'boat_safety':
      return unknown(['pedal_boat.passenger_capacity','pedal_boat.life_jackets'],'ตอนนี้ยังไม่มีข้อมูลยืนยันว่าเป็ดน้ำขึ้นได้กี่คน และมีเสื้อชูชีพขนาดใดให้บ้างครับ ต้องเช็กทั้งจำนวนผู้เล่น น้ำหนักรวม และอุปกรณ์ชูชีพกับทีมงานก่อนลงเล่นครับ','activity');
    case 'weather_changes':
      return unknown(['activities.weather_reschedule_policy','activities.refund_policy'],'ตอนนี้ยังไม่มีนโยบายยืนยันว่าฝนตกแล้วเลื่อนกิจกรรมหรือคืนเงินได้ในเงื่อนไขใดครับ หากจองไว้แล้วควรเตรียมเลขการจองและสอบถามทีมงานก่อน ยังไม่ได้เปลี่ยนวัน ยกเลิก คืนเงิน หรือส่งเรื่องแทนคุณครับ','activity');
    case 'stay_opening': {
      const adapters=input.adapters ?? buildRealKnowledgeSourceAdapters(input.channel,{environment:input.environment ?? 'live'});
      const bundle=await resolveKnowledge({domain:'stay',intent:'visitor_stay_opening',action:'ask',entities:{},constraints:[],needs:['price']},adapters);
      const prices=bundle.facts.filter(fact=>/^stay:.+:price$/u.test(fact.key) && typeof fact.value==='number' && Number.isFinite(fact.value));
      result.sourceIds=bundle.sources.filter(source=>source.status==='ok').map(source=>source.sourceId);
      result.usedFactKeys=prices.map(fact=>fact.key);
      const rateText=prices.map(price=>{
        const name=bundle.facts.find(fact=>fact.key===price.key.replace(/:price$/u,':name'));
        if(name)result.usedFactKeys.push(name.key);
        return `${name?String(name.value):'ที่พัก'} ${String(price.value)} บาทต่อคืน`;
      }).join(' · ');
      return unknown(['stay.opening_status',...(prices.length?[]:['stay.nightly_rates'])],
        (prices.length?`ในข้อมูลหลังบ้านมีราคา ${rateText} ครับ แต่ราคาที่บันทึกไว้ยังไม่ยืนยันว่าเปิดรับพักหรือมีห้องว่างในวันเดินทาง`:'ตอนนี้ยังไม่มีข้อมูลยืนยันว่าเฮือนสเตย์เปิดรับพักแล้วหรือยัง และราคาต่อคืนเท่าไรครับ')
        +' ควรเช็กวันเข้าพัก จำนวนผู้เข้าพัก และประเภทห้องกับทีมที่พักก่อน ยังไม่ได้จองให้ครับ','stay');
    }
    case 'stay_availability': {
      const party=input.message.match(/(\d+)\s*(?:คน|ท่าน)/u)?.[1];
      const arrival=/คืนนี้/u.test(input.message)?'คืนนี้':/พรุ่งนี้/u.test(input.message)?'พรุ่งนี้':'วันที่ถาม';
      return unknown(['stay.checkout_date','stay.live_room_availability'],`ต้องการเช็กห้องว่าง${arrival}${party?`สำหรับ ${party} คน`:''}ใช่ไหมครับ ขอวันเช็กเอาต์หรือจำนวนคืนที่จะพักด้วยครับ จึงจะเช็กให้ตรงช่วงวันได้ ตอนนี้ยังไม่ได้ยืนยันห้องว่าง จองห้อง หรือส่งเรื่องให้ทีมงานครับ`,'stay');
    }
    case 'package':
      return unknown(['packages.stay_food_activity'],'ตอนนี้ยังไม่มีข้อมูลแพ็กเกจที่ยืนยันว่ารวมที่พัก อาหาร และกิจกรรมครับ จึงยังสรุปราคารวมหรือรายการที่รวมให้ไม่ได้ ต้องเช็กชื่อแพ็กเกจ วันใช้บริการ จำนวนคน และเงื่อนไขกับทีมงานก่อนครับ','stay');
    case 'product_browse': {
      result.domain='otop';
      const adapters=input.adapters ?? buildRealKnowledgeSourceAdapters(input.channel,{environment:input.environment ?? 'live'});
      const bundle=await resolveKnowledge({domain:'otop',intent:'visitor_product_browse',action:'discover',entities:{},constraints:[],needs:['catalog']},adapters);
      const names=bundle.facts.filter(fact=>/^otop:.+:name$/u.test(fact.key));
      result.sourceIds=bundle.sources.filter(source=>source.status==='ok').map(source=>source.sourceId);
      const lines=names.slice(0,8).map(name=>{
        result.usedFactKeys.push(name.key);
        const price=bundle.facts.find(fact=>fact.key===name.key.replace(/:name$/u,':price') && typeof fact.value==='number');
        if(price)result.usedFactKeys.push(price.key);
        return `• ${String(name.value)}${price?` — ${String(price.value)} บาท`:''}`;
      });
      result.message=lines.length?`รายการของฝากในหลังบ้านที่อ่านได้ตอนนี้ครับ\n${lines.join('\n')}\nหากสนใจชิ้นไหน บอกชื่อสินค้าได้ครับ ส่วนผู้ผลิตและชุมชนที่มาต้องมีข้อมูลยืนยันรายชิ้น`
        // Read fine but empty is not a failed read: the live query only returns
        // rows with stock_qty > 0, so sold-out and no-stock-figure items are both
        // absent. Say exactly that -- neither "sold out" nor "could not read".
        :bundle.sources.some(source=>source.status==='empty')
          ?'ตอนนี้ยังไม่มีของฝากที่ระบบยืนยันว่ามีสต๊อกพร้อมขายครับ ทองไทยจึงยังไม่ขอเสนอชิ้นไหน'
          :'ตอนนี้ยังอ่านรายการของฝากปัจจุบันไม่ได้ครับ จึงยังไม่ขอเดาชื่อสินค้า ราคา หรือชุมชนผู้ผลิต';
      if(!lines.length)result.missingFields=['otop.current_catalog'];return result;
    }
    case 'product_origin':
      return unknown(['otop.selected_product','otop.producer','otop.community'],'หมายถึงสินค้าชิ้นไหนครับ ส่งชื่อหรือรหัสสินค้ามาได้เลย ตอนนี้ยังไม่มีข้อมูลผู้ผลิตและชุมชนที่มายืนยันสำหรับสินค้าที่ถาม จึงไม่ขอเดาว่าใครเป็นคนทำครับ','otop');
    case 'shipping':
      return unknown(['otop.shipping_destinations','otop.shipping_rates'],'ตอนนี้ยังไม่มีข้อมูลยืนยันเงื่อนไขจัดส่งของฝากและค่าส่งสำหรับปลายทางที่ถามครับ ต้องทราบสินค้า จำนวน และรหัสไปรษณีย์ แล้วเช็กวิธีจัดส่งกับอัตราค่าส่งก่อน ยังไม่ได้สร้างคำสั่งซื้อหรือรายการจัดส่งครับ','otop');
    case 'horse_reference_quote': {
      result.domain='activity';
      const adapters=input.adapters ?? buildRealKnowledgeSourceAdapters(input.channel,{environment:input.environment ?? 'live'});
      const bundle=await resolveKnowledge({domain:'activity',intent:'horse_reference_quote',action:'ask',entities:{activityCode:'horse'},constraints:[],needs:['price']},adapters);
      const options=bundle.facts.find(fact=>fact.key==='activity:horse:durationOptions');
      const live=Array.isArray(options?.value)?options.value.find((option:any)=>option.durationMinutes===90 && typeof option.price==='number'):null;
      if(live && options) {
        result.message=`เมนูกิจกรรมหลังบ้านระบุขี่ม้า 90 นาที ${live.price} บาทครับ ต้องเช็กรอบว่างก่อนจองอีกครั้ง`;
        result.sourceIds=[options.sourceId];result.usedFactKeys=[options.key];return result;
      }
      result.message='ข้อมูลอ้างอิงที่ได้รับระบุขี่ม้า 90 นาที (ชั่วโมงครึ่ง) 500 บาทครับ แต่ยังไม่ตรงกับรายการแพ็กเกจที่อ่านได้จากหลังบ้าน จึงต้องให้ทีมกิจกรรมยืนยันราคาและระยะเวลาปัจจุบันก่อนจองครับ';
      result.sourceIds=[USER_VENUE_FACTS.sourceId,...bundle.sources.filter(source=>source.status==='ok').map(source=>source.sourceId)];
      result.usedFactKeys=['user_reference:horse:90_minutes'];result.missingFields=['horse.current_90_minute_offering'];return result;
    }
    case 'cafe_menu_reference': {
      if(/สาขา(?!\s*ตาดโตน)|สาขาอื่น|ทุกสาขา/u.test(input.message))return unknown(['cafe.requested_branch_prices'],'ตอนนี้มีข้อมูลอ้างอิงที่ให้ไว้สำหรับอินทนิลและข้อมูลสาขาตาดโตนครับ ยังยืนยันราคาของสาขาที่ถามไม่ได้','cafe');
      const adapters=input.adapters ?? buildRealKnowledgeSourceAdapters(input.channel,{environment:input.environment ?? 'live'});
      const bundle=await resolveKnowledge({domain:'cafe',intent:'cafe_menu_price',action:'ask',entities:{},constraints:[],needs:['price']},adapters);
      const text=input.message.toLowerCase();
      const matches=CAFE_PRICE_REFERENCES.filter(item=>item.aliases.some(alias=>text.includes(alias.toLowerCase())));
      // Prefer the longest matched drink alias (ชาไทยลาเต้ must not become ลาเต้).
      const occurrences=matches.flatMap(item=>item.aliases.flatMap(alias=>{
        const start=text.indexOf(alias.toLowerCase());return start<0?[]:[{code:item.code,start,end:start+alias.length}];
      }));
      const selected=matches.length?matches.filter(item=>occurrences.some(own=>own.code===item.code
        && !occurrences.some(other=>other.code!==item.code && other.start<=own.start && other.end>=own.end && (other.end-other.start)>(own.end-own.start)))):CAFE_PRICE_REFERENCES;
      const style=/ปั่น/u.test(text)?'blended':/เย็น/u.test(text)?'iced':/ร้อน/u.test(text)?'hot':null;
      const labels:Record<string,string>={hot:'ร้อน',iced:'เย็น',blended:'ปั่น',addon:'เพิ่มช็อต'};
      let usedReference=false;
      const lines=selected.map(item=>{
        const livePrice=bundle.facts.filter(fact=>fact.key.startsWith(`cafe:${item.code}:price:`) && typeof fact.value==='number');
        const choices=style?livePrice.filter(fact=>fact.key.endsWith(':'+style)):livePrice;
        if(choices.length) {
          result.sourceIds.push(...choices.map(fact=>fact.sourceId));result.usedFactKeys.push(...choices.map(fact=>fact.key));
          return `• ${item.nameTh}: ${choices.map(fact=>`${labels[fact.key.split(':').pop()!] ?? ''} ${String(fact.value)} บาท`).join(' / ')} (ราคาจากเมนูหลังบ้าน)`;
        }
        usedReference=true;result.sourceIds.push(CAFE_PRICE_REFERENCE_PROVENANCE.sourceId);result.usedFactKeys.push(`cafe_reference:${item.code}:prices`);
        const entries=Object.entries(item.prices).filter(([key])=>item.category==='addon' || !style || key===style);
        return `• ${item.nameTh}: ${entries.length?entries.map(([key,value])=>`${labels[key]} ${value} บาท`).join(' / '):'ยังไม่มีราคาอ้างอิงรูปแบบที่ถาม'}`;
      });
      const bakery=/ครัวซองต์|เบเกอรี|เค้ก|ขนมปัง/u.test(text);
      result.message=(usedReference && !bakery?'ราคาอ้างอิงที่ได้รับ ยังรอการยืนยันราคาของสาขาตาดโตนครับ\n':'')
        +(bakery?`ตัวอย่างขนมมี ${USER_VENUE_FACTS.bakery.examples.join(' · ')} รายการหมุนเวียนในแต่ละวัน ต้องเช็กของที่เคาน์เตอร์ครับ`:lines.join('\n'));
      if(bakery){result.sourceIds=[USER_VENUE_FACTS.sourceId];result.usedFactKeys=['cafe:bakery_examples'];result.missingFields=['cafe.bakery_today','cafe.bakery_branch_prices'];}
      if(usedReference && !bakery)result.missingFields=['cafe.confirmed_branch_prices'];
      result.sourceIds=[...new Set(result.sourceIds)];result.domain='cafe';return result;
    }
    case 'food_browse': {
      result.domain='restaurant';
      const adapters=input.adapters ?? buildRealKnowledgeSourceAdapters(input.channel,{environment:input.environment ?? 'live'});
      const bundle=await resolveKnowledge({domain:'restaurant',intent:'visitor_food_browse',action:'discover',entities:{},constraints:[],needs:['catalog']},adapters);
      const names=bundle.facts.filter(fact=>/^menu:.+:name$/u.test(fact.key));
      const verified=names.filter(name=>bundle.facts.some(fact=>fact.key===name.key.replace(/:name$/u,':orderable') && fact.value===true));
      result.sourceIds=bundle.sources.map(source=>source.sourceId);result.usedFactKeys=verified.map(fact=>fact.key);
      result.message=verified.length?`นอกจากกาแฟ มีฝั่งอาหารของร้านตำมา-ชาติครับ ในเมนูหลังบ้านที่อ่านได้มี ${verified.slice(0,8).map(fact=>String(fact.value)).join(' · ')}\nรายการเมนูไม่ได้ยืนยันว่าร้านเปิดอยู่ตอนนี้ ต้องเช็กเวลาและการให้บริการในวันเดินทางอีกครั้งครับ`
        :'นอกจากคาเฟ่ ทำมา-ชาติมีส่วนร้านอาหารตำมา-ชาติครับ แต่ตอนนี้ยังอ่านรายการอาหารปัจจุบันไม่ได้ จึงยังไม่ขอระบุชื่อเมนูหรือราคาครับ';
      result.message+=`\nข้อมูลเมนูที่ได้รับเพิ่มเติมมี ${USER_VENUE_FACTS.restaurant.examples.join(' · ')} และฝั่งขนมมี ${USER_VENUE_FACTS.bakery.examples.join(' · ')} โดยขนมหมุนเวียนรายวัน รายการเพิ่มเติมยังต้องยืนยันเมนู ราคา และของพร้อมขายกับร้านครับ`;
      result.sourceIds.push(USER_VENUE_FACTS.sourceId);result.usedFactKeys.push('restaurant:menu_examples','cafe:bakery_examples');
      if(!verified.length)result.missingFields=['restaurant.current_menu'];return result;
    }
  }
}
