// Centralized, STATIC business-fact knowledge for ทำมา-ชาติ's ecosystem --
// same discipline as _local-concierge-knowledge.ts (which this module sits
// alongside, not replaces): only facts the owner has actually provided
// belong here, nothing invented, nothing live/mutable (no price, no
// availability, no schedule that changes day-to-day). Reuses
// _ecosystem-entity-graph.ts's real business-unit ids and
// _local-concierge-location.ts's real map link rather than re-deriving
// either. See THONGTHAI_HANDOFF.md's "Knowledge Base + Scenario Brain"
// entry for exactly which facts came from which owner instruction.

export type EcosystemPathId = 'chill' | 'activity' | 'stay';

export type EcosystemPath = {
  id: EcosystemPathId;
  labelTh: string;
  descriptionTh: string;
  businessUnits: string[];
};

/** The three-path framing the owner gave verbatim for a first-time-visitor
 *  opener -- not a business-unit list dump, a curated shape. */
export const ECOSYSTEM_PATHS: EcosystemPath[] = [
  {
    id: 'chill', labelTh: 'สายชิล', descriptionTh: 'คาเฟ่ + ถ่ายรูป + อาหาร',
    businessUnits: ['inthanin', 'thamma-chat-restaurant'],
  },
  {
    id: 'activity', labelTh: 'สายกิจกรรม', descriptionTh: 'ขี่ม้า / ATV / ยิงธนู',
    businessUnits: ['thamma-chat-adventure'],
  },
  {
    id: 'stay', labelTh: 'สายพัก', descriptionTh: 'เฮือนสเตย์ + ธรรมชาติ',
    businessUnits: ['thamma-chat-stay'],
  },
];

/** Owner-provided homestay facts (category B, same discipline as
 *  _local-concierge-knowledge.ts's HORSE_FACTS: exactly what was
 *  configured, nothing beyond it -- room COUNT and house TYPE mix are
 *  stable facts; actual night-by-night AVAILABILITY is not listed here on
 *  purpose because it changes daily and must never be answered from a
 *  static table. */
export type HomestayFacts = {
  totalHouses: number;
  twoBedroomHouses: number;
  oneBedroomHouses: number;
  checkInByTh: string;
  checkOutByTh: string;
  roomServiceHoursTh: string;
  bookingWindowTh: string;
  finalConfirmationChannelsTh: string;
};

export const HOMESTAY_FACTS: HomestayFacts = {
  totalHouses: 6,
  twoBedroomHouses: 3,
  oneBedroomHouses: 3,
  checkInByTh: 'เช็คอินได้ถึง 14:00 น.',
  checkOutByTh: 'เช็คเอาท์ภายใน 12:00 น.',
  roomServiceHoursTh: 'รูมเซอร์วิส 10:00–22:00 น.',
  bookingWindowTh: 'จองผ่านทองไทยล่วงหน้าได้ 24 ชั่วโมง',
  finalConfirmationChannelsTh: 'ยืนยันจริงผ่าน LINE, อีเมล หรือโทรศัพท์เท่านั้น',
};
