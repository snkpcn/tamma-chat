/**
 * experiences.ts — shared catalog for BOTH Netlify functions
 * (thongthai-agent.ts for planning, thongthai-chat.ts for conversation).
 * Identical to the version delivered alongside the Journey Agent function.
 * Kept in one file so both endpoints stay in sync with the real business.
 */
export type ExperienceCategory = 'welcome' | 'dining' | 'stay' | 'adventure' | 'local' | 'journal';
export type Intensity = 'low' | 'medium' | 'high';

export interface Experience {
  id: string;
  name: string;
  category: ExperienceCategory;
  description: string;
  suitableFor: Array<'solo' | 'couple' | 'family' | 'friends'>;
  durationMinutes: number;
  intensity: Intensity;
  tags: string[];
  constraints: Array<'not_for_elderly' | 'not_for_young_children'>;
}

export const EXPERIENCES: Experience[] = [
  { id: 'inthanin', name: 'Inthanin', category: 'welcome', description: 'Official Welcome Partner — the first stop of every Journey.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 25, intensity: 'low', tags: ['arrival','coffee'], constraints: [] },
  { id: 'reception', name: 'Reception', category: 'welcome', description: 'Orientation before the experience starts.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 10, intensity: 'low', tags: ['orientation'], constraints: [] },
  { id: 'dining', name: 'ตำมา-ชาติ', category: 'dining', description: 'Contemporary Isan cooking from local ingredients.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 70, intensity: 'low', tags: ['food','isan'], constraints: [] },
  { id: 'stay', name: 'ทำมา-ชาติ เฮือนสเตย์', category: 'stay', description: 'Slow, private rest close to water and nature.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 90, intensity: 'low', tags: ['rest','slow'], constraints: [] },
  { id: 'adventure', name: 'ทำมา-ชาติ ผจญภัย', category: 'adventure', description: 'Outdoor movement through real terrain.', suitableFor: ['couple','family','friends'], durationMinutes: 80, intensity: 'high', tags: ['nature','outdoor'], constraints: ['not_for_elderly'] },
  { id: 'landscape', name: 'เดินชมพื้นที่กลาง', category: 'local', description: 'A light, unhurried walk — a gentler alternative to the full adventure trail.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 20, intensity: 'low', tags: ['walk','scenery'], constraints: [] },
  { id: 'sunset', name: 'ชมพระอาทิตย์ตก', category: 'local', description: 'A shared, unhurried moment.', suitableFor: ['couple','family','friends'], durationMinutes: 25, intensity: 'low', tags: ['scenery','couple'], constraints: [] },
  { id: 'morning', name: 'เช้าแบบสโลว์ๆ', category: 'stay', description: 'A slow morning by the water.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 45, intensity: 'low', tags: ['rest','slow'], constraints: [] },
  { id: 'journal', name: 'Journey Journal', category: 'journal', description: 'Where the visit gets remembered.', suitableFor: ['solo','couple','family','friends'], durationMinutes: 10, intensity: 'low', tags: ['memory'], constraints: [] },
];

/**
 * Previously this function REMOVED any experience with a matching hard
 * constraint from the catalog entirely — which meant a mixed group (e.g.
 * grandmother + grandchildren) could never be offered Adventure at all,
 * even for the family members it suits fine. That was too blunt.
 *
 * Now: return the full catalog unchanged, but flag which entries carry a
 * constraint relevant to this guest context. The agent's system prompt
 * instructs it to reason about splitting the group — assigning a flagged
 * experience only to the travelers it suits, with a parallel lower-intensity
 * option for others — rather than removing the experience for everyone.
 */
export function annotateForGroup(hasElderly: boolean, hasYoungChildren: boolean): Array<Experience & { flaggedFor?: string }> {
  return EXPERIENCES.map(e => {
    const flags: string[] = [];
    if (hasElderly && e.constraints.includes('not_for_elderly')) flags.push('unsuitable for a traveler with mobility limitations — fine for other members of a mixed group');
    if (hasYoungChildren && e.constraints.includes('not_for_young_children')) flags.push('unsuitable for young children — fine for other members of a mixed group');
    return flags.length ? { ...e, flaggedFor: flags.join('; ') } : e;
  });
}

/** @deprecated kept only so any old caller doesn't hard-crash; use annotateForGroup instead */
export function filterByConstraints(hasElderly: boolean, hasYoungChildren: boolean): Experience[] {
  return annotateForGroup(hasElderly, hasYoungChildren);
}
