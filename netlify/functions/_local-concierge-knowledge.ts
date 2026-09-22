// Local Concierge knowledge pack -- STATIC LOCAL KNOWLEDGE only (Isan/
// Chaiyaphum culture, general seasons, general travel prep, food culture,
// general suitability guidance). Mirrors _ecosystem-entity-graph.ts's own
// discipline exactly: only STABLE, doctrine-level structure lives here,
// never a mutable/real-time fact. This module must NEVER be asked to answer
// "is it raining right now", "is the horse available today", or any other
// live/business fact -- those come from real adapters via
// _knowledge-resolver.ts, or (for real-time facts with no integrated
// source, like live weather) must be honestly declined by the caller, never
// answered from here.
//
// Kept intentionally small and structured (a lookup table), not prose --
// see THONGTHAI_HANDOFF.md's Local Concierge Intelligence Framework section
// for the product reasoning. Extend by adding entries to the existing maps,
// never by hand-writing a new paragraph of prose per phrase.

export type LocalSeason = 'hot' | 'rainy' | 'cool';

export type SeasonGuidance = {
  /** One short line: what this season generally means for a visit. */
  summary: string;
  /** Practical prep guidance for this condition -- never a specific
   *  forecast, never a promise about "today". */
  prepGuidance: string;
  /** What to do when the condition makes outdoor activity less appealing
   *  (rain, heavy sun) -- business-unit-agnostic phrasing; the composer
   *  fills in real names from _ecosystem-entity-graph.ts. */
  indoorFriendlyNote: string;
};

export const SEASON_GUIDANCE: Record<LocalSeason, SeasonGuidance> = {
  hot: {
    summary: 'ช่วงแดดจัด อากาศเปิดโล่งจะร้อนตอนกลางวัน',
    prepGuidance: 'พกน้ำ หมวก/ร่ม และเลี่ยงกิจกรรมกลางแจ้งช่วงเที่ยงถึงบ่ายสาม',
    indoorFriendlyNote: 'ช่วงแดดแรงแนะนำเริ่มจากที่ร่มก่อน แล้วค่อยไปกิจกรรมกลางแจ้งตอนแดดอ่อนลง',
  },
  rainy: {
    summary: 'ช่วงฝนตก พื้นที่กลางแจ้งอาจลื่น/เปียก',
    prepGuidance: 'พกร่ม/เสื้อกันฝนบางๆ และรองเท้าที่เดินพื้นเปียกได้',
    indoorFriendlyNote: 'ถ้าฝนตก แนะนำแผนสำรองที่ไม่ต้องเปียกก่อน แล้วค่อยดูกิจกรรมกลางแจ้งอีกที',
  },
  cool: {
    summary: 'ช่วงอากาศเย็นสบาย เหมาะกับกิจกรรมกลางแจ้ง',
    prepGuidance: 'พกเสื้อกันหนาวบางๆ ไว้เผื่อช่วงเช้า/เย็น',
    indoorFriendlyNote: 'อากาศแบบนี้เหมาะกับกิจกรรมกลางแจ้งเกือบทั้งวัน',
  },
};

/** Ecosystem business-unit node ids (see _ecosystem-entity-graph.ts) that
 *  are a natural "not-too-wet/not-too-hot" fallback when weather makes
 *  outdoor activity less appealing -- never a fabricated new business,
 *  just a pointer to real existing nodes. */
export const INDOOR_FRIENDLY_BUSINESS_UNITS = ['thamma-chat-restaurant', 'inthanin', 'thamma-chat-stay'] as const;

/** Ecosystem activity node ids that weather/ground-condition guidance
 *  actually applies to -- reuses the SAME ids _ecosystem-entity-graph.ts
 *  already defines, never a second copy of "which activities are outdoor". */
export const OUTDOOR_SENSITIVE_ACTIVITY_NODES = ['activity-horse', 'activity-atv', 'activity-archery'] as const;

export type LocalTopicGuidance = {
  /** 1-3 short lines, never a paragraph block. */
  lines: string[];
  relatedBusinessUnits: string[];
};

/** Region/place-character guidance -- who ทำมา-ชาติ is, not a Wikipedia
 *  article about Isan/Chaiyaphum. Kept short by design (quality bar: "not
 *  an encyclopedia dump"). */
export const REGION_GUIDANCE: LocalTopicGuidance = {
  lines: [
    'ทำมา-ชาติอยู่ในบรรยากาศอีสาน-ชัยภูมิ เน้นธรรมชาติ จังหวะสบายๆ และวิถีท้องถิ่นจริงๆ',
    'จุดเด่นคือกินอาหารอีสานแท้ ใกล้ชิดธรรมชาติ (ขี่ม้า/ATV/ยิงธนู) และพักแบบเฮือนสเตย์ในที่เดียวกัน',
  ],
  relatedBusinessUnits: ['thamma-chat-restaurant', 'thamma-chat-adventure', 'thamma-chat-stay'],
};

export const FOOD_CULTURE_GUIDANCE: LocalTopicGuidance = {
  lines: [
    'อาหารอีสานแท้ๆ ที่ร้านเน้นรสจัดจ้าน (นัว เผ็ด เปรี้ยว) แบบลาบ ต้มแซ่บ ส้มตำ ปลาร้า',
    'ถ้าไม่กินเผ็ด/ปลาร้า บอกได้เลย ทองไทยแนะนำเมนูที่ปรับได้จากเมนูจริงในร้าน',
  ],
  relatedBusinessUnits: ['thamma-chat-restaurant'],
};

export const SAFETY_GENERAL_GUIDANCE: LocalTopicGuidance = {
  lines: [
    'กิจกรรมกลางแจ้ง (ขี่ม้า/ATV/ยิงธนู) มีทีมงานดูแลหน้างานเสมอ และจะแจ้งเงื่อนไขความปลอดภัยตามสภาพจริงวันนั้น',
    'สภาพพื้นที่/ความเหมาะสมรายบุคคล (เด็ก ผู้สูงอายุ มือใหม่) ขอให้ทีมงานยืนยันตอนถึงหน้างานอีกครั้ง เพื่อความชัวร์',
  ],
  relatedBusinessUnits: ['thamma-chat-adventure'],
};
