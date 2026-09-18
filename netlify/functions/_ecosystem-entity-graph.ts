// Phase E: structural ecosystem relationships (business unit -> activity
// group -> individual activity -> its real resources), so the system CAN
// represent "ทำมา-ชาติ ผจญภัย has a horse-riding activity with two horse
// resources" as a graph shape -- without inventing or hardcoding which
// specific resources exist today. Only the STRUCTURE below (business units,
// activity groups, and the fact that activities have zero or more concrete
// resources) is asserted as stable/doctrine-level and sourced from
// THONGTHAI_BRAIN.md's existing "Production components"/"Ecosystem" sections.
// The actual current resource instances (which horses, which rooms, which
// menu items exist right now) are NOT listed here -- those are mutable
// facts and must come from the live sources via _knowledge-resolver.ts's
// injected adapters (activity_offerings/activity_assets, service_resources,
// restaurant menu tables), never copied into this static module. Doing so
// would recreate exactly the "mirror live inventories into Bible" anti-
// pattern the Phase E brief explicitly forbids.
export type EcosystemNodeType = 'root' | 'business_unit' | 'activity_group' | 'activity' | 'resource_slot';

export type EcosystemNode = {
  id: string;
  type: EcosystemNodeType;
  label: string;
  children?: EcosystemNode[];
};

/** `resource_slot` nodes describe a CATEGORY of resource an activity has
 *  (e.g. "activity-horse has named horse resources"), not specific named
 *  instances -- those come from activity_assets via a real adapter at query
 *  time, never from this static tree. */
export const ECOSYSTEM_ENTITY_GRAPH: EcosystemNode = {
  id: 'thamma-chat-ecosystem', type: 'root', label: 'ทำมา-ชาติ',
  children: [
    {
      id: 'thamma-chat-restaurant', type: 'business_unit', label: 'ตำมา-ชาติ (restaurant)',
    },
    {
      id: 'thamma-chat-adventure', type: 'business_unit', label: 'ทำมา-ชาติ ผจญภัย (adventure/activity)',
      children: [
        { id: 'activity-horse', type: 'activity', label: 'ขี่ม้า (horse riding)', children: [{ id: 'activity-horse-resources', type: 'resource_slot', label: 'named horse resources (from activity_assets, live)' }] },
        { id: 'activity-atv', type: 'activity', label: 'ATV', children: [{ id: 'activity-atv-resources', type: 'resource_slot', label: 'ATV unit resources (from activity_assets, live)' }] },
        { id: 'activity-archery', type: 'activity', label: 'ยิงธนู (archery)', children: [{ id: 'activity-archery-resources', type: 'resource_slot', label: 'archery lane/equipment resources (from activity_assets, live)' }] },
      ],
    },
    { id: 'thamma-chat-stay', type: 'business_unit', label: 'ทำมา-ชาติ เฮือนสเตย์ (stay)' },
    { id: 'inthanin', type: 'business_unit', label: 'Inthanin' },
    { id: 'otop-community', type: 'business_unit', label: 'Community / OTOP' },
  ],
};

export function findEcosystemNode(id: string, root: EcosystemNode = ECOSYSTEM_ENTITY_GRAPH): EcosystemNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findEcosystemNode(id, child);
    if (found) return found;
  }
  return null;
}
