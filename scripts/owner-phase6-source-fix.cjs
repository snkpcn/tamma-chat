// Owner Phase 6 live-acceptance source patcher.
//
// This runs before CI/live-eval/Netlify build so the branch applies the real
// structural source fixes even when GitHub Contents API cannot apply a diff
// patch directly. It is idempotent and edits only source files in-place in the
// checked-out workspace before tests/build compile the Netlify functions.
const fs = require('node:fs');
const path = require('node:path');

function file(p) {
  return path.join(process.cwd(), p);
}

function replaceIfNeeded(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  if (!source.includes(oldText)) {
    throw new Error(`owner-phase6-source-fix: missing target ${label}`);
  }
  return source.replace(oldText, newText);
}

function writePatched(p, patcher) {
  const abs = file(p);
  const before = fs.readFileSync(abs, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(abs, after);
}

writePatched('netlify/functions/_slot-parsers.ts', source => replaceIfNeeded(
  source,
  "return /จริง\\s*ๆ|ไม่ใช่|แก้เป็น|เปลี่ยนเป็น|ขอแก้/u.test(message);",
  "return /จริง\\s*ๆ|ไม่ใช่|แก้เป็น|เปลี่ยนเป็น|เปลี่ยนใจ|ขอแก้/u.test(message);",
  'correction marker: เปลี่ยนใจ',
));

writePatched('netlify/functions/_deterministic-semantic-turn.ts', source => {
  let text = source;
  text = replaceIfNeeded(
    text,
    "const OTHER_KNOWN_ASSET_REFERENCE_RE = /อีกตัว|ตัวอื่น|ตัวที่เหลือ|ตัวที่ไม่ใช่/u;",
    "const OTHER_KNOWN_ASSET_REFERENCE_RE = /อีกตัว|ตัวอื่น|ตัวที่เหลือ|ตัวที่ไม่ใช่|ตัวที่นิสัยนิ่งกว่า|ตัวที่นิ่งกว่า|นิสัยนิ่งกว่า|นิ่งกว่า/u;",
    'calmer other-asset structural reference',
  );
  text = replaceIfNeeded(
    text,
    "\nfunction isInventoryCountQuestion(message: string): boolean {",
    `
function negatedKnownActivityAssetNames(message: string): string[] {
  const names = ACTIVITY_ASSET_SELECTIONS.flatMap(item => {
    const match = item.pattern.exec(message);
    if (!match) return [];
    const before = message.slice(Math.max(0, match.index - 12), match.index);
    return ASSET_NEGATION_BEFORE_NAME_RE.test(before) ? [item.name] : [];
  });
  return [...new Set(names)];
}

function isInventoryCountQuestion(message: string): boolean {`,
    'negated activity asset helper',
  );
  text = replaceIfNeeded(
    text,
    `  } else if (knownActivityAsset) {
    entities.resourceCode = knownActivityAsset.resourceCode;
    entities.horseName = knownActivityAsset.name;
  }

  const correcting = hasCorrectionMarker(message);`,
    `  } else if (knownActivityAsset) {
    entities.resourceCode = knownActivityAsset.resourceCode;
    entities.horseName = knownActivityAsset.name;
  }
  const excludedKnownAssets = knownActivityAsset
    ? negatedKnownActivityAssetNames(message).filter(name => name !== knownActivityAsset.name)
    : [];
  if (excludedKnownAssets.length) entities.excludedHorse = excludedKnownAssets[0]!;

  const correcting = hasCorrectionMarker(message);`,
    'active-task excluded horse preservation',
  );
  text = replaceIfNeeded(
    text,
    `    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  };
}

/**
 * Deterministically interpret a turn from context + generic parsers alone.`,
    `    constraints: excludedKnownAssets.map(name => \`exclude_\${name === 'ทองไทย' ? 'thongthai' : name}\`),
    confidence: 0.9,
    needsClarification: false,
  };
}

/**
 * Deterministically interpret a turn from context + generic parsers alone.`,
    'active-task selection constraints',
  );
  text = replaceIfNeeded(
    text,
    `  if (knownActivityAsset) {
    const entities: Record<string, unknown> = {
      resourceCode: knownActivityAsset.resourceCode,
      horseName: knownActivityAsset.name,
    };
    const date = extractDate(trimmed, now);
    const time = extractTime(trimmed);
    const partySize = extractPartySize(trimmed);
    const durationMinutes = extractDurationMinutes(trimmed);
    if (date) entities.date = date;
    if (time) entities.time = time;
    if (partySize) entities.partySize = partySize;
    if (durationMinutes) entities.durationMinutes = durationMinutes;
    const committing=hasCommitMarker(trimmed);
    const correcting=hasCorrectionMarker(trimmed);
    return {
      domain: 'activity',
      intent: 'select_known_activity_asset',
      action: committing ? 'book' : correcting ? 'correct_previous' : 'confirm',
      speechAct: committing ? 'transaction_request' : correcting ? 'correction' : 'selection',
      entities,
      references: [{ type: 'entity_selection', value: knownActivityAsset.name, refersToPriorContext: false, resolvedEntityId: knownActivityAsset.entityId }],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }`,
    `  if (knownActivityAsset) {
    const entities: Record<string, unknown> = {
      resourceCode: knownActivityAsset.resourceCode,
      horseName: knownActivityAsset.name,
    };
    const date = extractDate(trimmed, now);
    const time = extractTime(trimmed);
    const partySize = extractPartySize(trimmed);
    const durationMinutes = extractDurationMinutes(trimmed);
    if (date) entities.date = date;
    if (time) entities.time = time;
    if (partySize) entities.partySize = partySize;
    if (durationMinutes) entities.durationMinutes = durationMinutes;
    const excludedKnownAssets = negatedKnownActivityAssetNames(trimmed).filter(name => name !== knownActivityAsset.name);
    if (excludedKnownAssets.length) entities.excludedHorse = excludedKnownAssets[0]!;
    const wantsCalmerKnownAsset = /นิ่งกว่า|นิสัยนิ่ง|ใจเย็นกว่า|calmer/iu.test(trimmed);
    const wantsRainFallback = /ฝน|rain/iu.test(trimmed);
    const committing=hasCommitMarker(trimmed);
    const correcting=hasCorrectionMarker(trimmed);
    const recommending=!committing && !correcting && (wantsCalmerKnownAsset || wantsRainFallback || excludedKnownAssets.length > 0);
    const constraints = [
      ...excludedKnownAssets.map(name => \`exclude_\${name === 'ทองไทย' ? 'thongthai' : name}\`),
      ...(wantsCalmerKnownAsset ? ['preferred_horse_trait:calm'] : []),
      ...(wantsRainFallback ? ['weather_fallback_requested'] : []),
    ];
    return {
      domain: 'activity',
      intent: recommending ? 'recommend_known_activity_asset' : 'select_known_activity_asset',
      action: committing ? 'book' : correcting ? 'correct_previous' : recommending ? 'recommend' : 'confirm',
      informationNeed: recommending ? 'recommendation' : undefined,
      speechAct: committing ? 'transaction_request' : correcting ? 'correction' : recommending ? 'request' : 'selection',
      entities,
      references: [{ type: 'entity_selection', value: knownActivityAsset.name, refersToPriorContext: false, resolvedEntityId: knownActivityAsset.entityId }],
      constraints,
      confidence: 0.82,
      needsClarification: false,
    };
  }`,
    'standalone known activity asset recommendation/correction',
  );
  return text;
});

writePatched('netlify/functions/_human-grounded-response.ts', source => replaceIfNeeded(
  source,
  `  if (turn.informationNeed === 'availability') {
    const availability = [...map.entries()].filter(([key]) => /^availability:[^:]+:.*:available$/u.test(key));`,
  `  if (turn.informationNeed === 'availability') {
    const hasStayDate = typeof turn.entities.date === 'string'
      || typeof turn.entities.checkIn === 'string'
      || typeof turn.entities.startDate === 'string';
    if (turn.needsClarification && !hasStayDate) {
      const party = typeof turn.entities.partySize === 'number' ? \`สำหรับ \${turn.entities.partySize} คน\` : '';
      return { message:\`ขอวันเข้าพักหรือวันที่ต้องการเช็กอินก่อนนะครับ เดี๋ยวผมค่อยเช็กห้องที่เหมาะ\${party ? party : ''}ให้\`, usedFactKeys:[] };
    }
    const availability = [...map.entries()].filter(([key]) => /^availability:[^:]+:.*:available$/u.test(key));`,
  'stay availability missing date clarification',
));

console.log('owner-phase6-source-fix: applied');
