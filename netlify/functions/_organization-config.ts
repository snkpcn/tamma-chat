// Organization details supplied directly by the owner on 2026-10-18.
// Regular venue hours only: not individual business-unit hours, live opening
// status, special holiday exceptions, booking availability or pet permission.
export const ORGANIZATION_CONFIG = {
  sourceId:'owner_organization_config_20261018',
  confirmedAt:'2026-10-18',
  scope:'ecosystem',
  nameTh:'ทำมา-ชาติ',
  taglineTh:'กิน • เที่ยว • เล่น • พัก ในแบบทำมา-ชาติ 🌿',
  descriptionTh:'จากอีสาน สู่ประสบการณ์ที่เราตั้งใจสร้าง',
  locationTh:'ตาดโตน • ชัยภูมิ',
  timezone:'Asia/Bangkok',
  regularOpeningHours:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,opens:'06:00',closes:'18:00'})),
} as const;

// Supplied by the user; the linked Facebook post was not independently fetched.
// Scope is Inthanin Tadtone only, not all Inthanin branches or venue units.
export const INTHANIN_TADTONE_CONFIG = {
  sourceId:'user_supplied_inthanin_tadtone_20261018',
  referenceUrl:'https://www.facebook.com/100048194478590/posts/1237887751161029/',
  verification:'user_supplied_excerpt_not_independently_verified',
  confirmedAt:'2026-10-18',
  branchCode:'inthanin_tadtone',
  nameTh:'อินทนิล สาขาตาดโตน',
  addressTh:'ตำบลนาฝาย อำเภอเมือง จังหวัดชัยภูมิ',
  directionsTh:'มาจากมหาวิทยาลัยราชภัฏชัยภูมิ ร้านอยู่ซ้ายมือก่อนถึงทางขึ้นอุทยานแห่งชาติตาดโตน',
  atmosphereTh:['ร้านกว้างขวาง บรรยากาศร่มรื่น','มีมุมแคมป์ปิ้ง สวนหย่อม มุมน้ำตกจำลอง และวิวบึงเล็กสำหรับถ่ายรูป'],
  timezone:'Asia/Bangkok',
  regularOpeningHours:Array.from({length:7},(_,dayOfWeek)=>({dayOfWeek,opens:'06:00',closes:'18:00'})),
  // Review notes only; never emitted as authoritative prices/availability.
  unverifiedClaims:[
    {topic:'horse_riding',claim:'ราคาประมาณ 500 บาท / 1.30 ชั่วโมง',status:'needs_current_operational_confirmation'},
    {topic:'evening_social_area',claim:'บางวันอาจมีโซนร้านนั่งดื่มสังสรรค์',status:'needs_current_operational_confirmation'},
  ],
} as const;

export function namesInthaninTadtone(message:string):boolean {
  const normalized=message.replace(/สาขา\s+ตาดโตน/gu,'สาขาตาดโตน');
  return /(?:อินทนิล|inthanin)/iu.test(normalized)
    && !/(?:สาขา(?!ตาดโตน)|สาขาอื่น|ทุกสาขา)/u.test(normalized);
}

// Dog policy supplied by the user in this conversation. This does not
// establish permission for other animals, indoor areas or accommodation.
export const INTHANIN_TADTONE_DOG_POLICY = {
  sourceId:'user_supplied_inthanin_tadtone_dog_policy_20261018',
  confirmedAt:'2026-10-18',
  branchCode:'inthanin_tadtone',
  species:'dog',
  subjectTh:'โซน Outdoor ของอินทนิล สาขาตาดโตน ในพื้นที่ทำมา-ชาติ',
  allowedZones:['Outdoor (Open Air)','โซนแคมป์ปิ้ง'],
  excludedZones:['ห้องแอร์ที่เป็นจุดสั่งเครื่องดื่ม','พื้นที่ปิด'],
  leashRequired:true,
  precautionsTh:'ใส่สายจูงตลอดเวลา ระวังม้าในพื้นที่และไม่รบกวนลูกค้าคนอื่น',
  cleanupTh:'เตรียมถุงเก็บขับถ่ายและเก็บทำความสะอาดทุกครั้ง',
} as const;
