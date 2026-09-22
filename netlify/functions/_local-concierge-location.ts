// Canonical location for ทำมา-ชาติ. STATIC LOCAL KNOWLEDGE (category A) --
// the owner-provided Google Maps link is the one canonical source; nothing
// here is invented. See THONGTHAI_HANDOFF.md's Local Concierge Intelligence
// Framework section for the resolution attempt and its result.
//
// TODO(owner/next session): this session's sandboxed environment could not
// resolve the Maps short link (maps.app.goo.gl) to coordinates/address --
// outbound network access to maps.app.goo.gl is blocked by this
// environment's own egress policy (confirmed via both a direct curl and
// the WebFetch tool, both returning an explicit EGRESS_BLOCKED/403 policy
// denial, not a timeout or DNS failure). Per the owner's own explicit
// instruction for this case: the Maps link is stored as canonical, NO
// address/coordinates are invented, and this TODO stands until a future
// session (with a network path to maps.app.goo.gl, or an owner-supplied
// lat/lon) resolves it. Once resolved, set `latitude`/`longitude`/
// `address` below and update `resolutionStatus`.
export type TammaLocation = {
  mapsLink: string;
  source: 'owner_provided_maps_link';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  resolutionStatus: 'unresolved' | 'resolved';
};

export const TAMMA_CHART_LOCATION: TammaLocation = {
  mapsLink: 'https://maps.app.goo.gl/1Zm9D9uxyezX373J6?g_st=ic',
  source: 'owner_provided_maps_link',
  latitude: null,
  longitude: null,
  address: null,
  resolutionStatus: 'unresolved',
};
