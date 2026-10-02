process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE='1';

import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  interpretSemanticTurn,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  classifyRawBusinessIncidentRoute,
  classifySemanticBusinessIncidentRoute,
  type BusinessIncidentLane,
} from '../netlify/functions/_business-incident-router';
import { classifyCommercialBoundarySemantic } from '../netlify/functions/_commercial-intent-boundary';

type Probe = {
  id: string;
  message: string;
  expectedLane: BusinessIncidentLane;
  expectedBusinessUnit: string;
  incidentMustBlockCommit?: boolean;
};

const probes: Probe[] = [
  { id:'business-restaurant', message:'ร้านอาหารมีเมนูอะไรบ้างครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'restaurant' },
  { id:'business-activity', message:'ขี่ม้ามีกี่ตัว ราคาเท่าไหร่ครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'activity' },
  { id:'business-stay', message:'เฮือนสเตย์เช็กอินกี่โมงครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'stay' },
  { id:'business-cafe', message:'คาเฟ่มีเครื่องดื่มอะไรบ้างครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'cafe' },
  { id:'business-otop', message:'OTOP มีสินค้าอะไรบ้างครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'otop' },
  { id:'business-membership', message:'สมาชิกได้สิทธิ์อะไรบ้างครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'membership' },
  { id:'business-promotion', message:'มีโปรโมชั่นอะไรให้ใช้บ้างครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'membership' },

  // "ช่วย" in an ordinary recommendation must NOT be mistaken for operational help.
  { id:'not-incident-polite-help', message:'ช่วยแนะนำม้าที่เหมาะกับมือใหม่หน่อยครับ', expectedLane:'BUSINESS', expectedBusinessUnit:'activity' },

  { id:'incident-restaurant', message:'พนักงานร้านอาหารพูดไม่ดีครับ อยากร้องเรียน', expectedLane:'INCIDENT', expectedBusinessUnit:'restaurant', incidentMustBlockCommit:true },
  { id:'incident-stay', message:'ห้องพักไม่สะอาดมากครับ อยากให้ทีมช่วยดูเรื่องนี้', expectedLane:'INCIDENT', expectedBusinessUnit:'stay', incidentMustBlockCommit:true },
  { id:'incident-cafe', message:'พนักงานคาเฟ่บริการไม่โอเคครับ ช่วยตรวจสอบให้หน่อย', expectedLane:'INCIDENT', expectedBusinessUnit:'cafe', incidentMustBlockCommit:true },
  { id:'incident-otop', message:'สินค้า OTOP ได้ของผิดครับ อยากให้ช่วยตรวจสอบ', expectedLane:'INCIDENT', expectedBusinessUnit:'otop', incidentMustBlockCommit:true },
  { id:'incident-activity', message:'ATV ดับกลางทางครับ ช่วยด้วย', expectedLane:'INCIDENT', expectedBusinessUnit:'activity', incidentMustBlockCommit:true },
  { id:'incident-activity-injury', message:'ผมล้มจาก ATV แล้วเจ็บอยู่ครับ ช่วยทีมหน้างานที', expectedLane:'INCIDENT', expectedBusinessUnit:'activity', incidentMustBlockCommit:true },

  // Deliberately outside the Thai raw phrase tables: the semantic router must
  // still preserve the owning business and turn it into INCIDENT meaning.
  { id:'incident-english-otop', message:'The OTOP seller treated us badly and I need help.', expectedLane:'INCIDENT', expectedBusinessUnit:'otop', incidentMustBlockCommit:true },

  // Mixed commercial language: the incident must win even if the same sentence
  // also contains an order/booking-shaped clause.
  { id:'incident-over-order', message:'ขอสั่งสินค้า OTOP ชิ้นนี้เลยครับ แต่พนักงานพูดไม่ดีมาก ขอให้ช่วยดูเรื่องนี้ก่อน', expectedLane:'INCIDENT', expectedBusinessUnit:'otop', incidentMustBlockCommit:true },
  { id:'incident-over-booking', message:'จองม้าให้ผมเลยครับ แต่ตอนนี้ล้มจาก ATV แล้วเจ็บ ช่วยก่อนครับ', expectedLane:'INCIDENT', expectedBusinessUnit:'activity', incidentMustBlockCommit:true },
];

function isTransientProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|\s)(?:429|5\d\d)(?:\s|$)|OpenAI\s+(?:429|5\d\d)|provider.*(?:429|5\d\d)/iu.test(message);
}

async function interpretWithTransientRetry(message: string, context: SemanticContext) {
  let last: unknown;
  for (let attempt=1; attempt<=3; attempt+=1) {
    try {
      return await interpretSemanticTurn(message, context, { certificationMode:true });
    } catch (error) {
      last=error;
      if (!isTransientProviderError(error) || attempt===3) throw error;
      console.log('PHASE5_LIVE_TRANSIENT_RETRY', JSON.stringify({
        attempt,
        error:error instanceof Error ? error.message : String(error),
      }));
      await new Promise(resolve => setTimeout(resolve, attempt * 1200));
    }
  }
  throw last;
}

async function main() {
  assert.ok(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY required');
  const context = emptySemanticContext();
  const results: Array<Record<string, unknown>> = [];

  for (const probe of probes) {
    const turn = await interpretWithTransientRetry(probe.message, context);
    const meaning = deriveSemanticMeaning(turn);
    // Mirror production precedence exactly: deterministic authority/customer-
    // voice routing wins first; semantic routing is the open-world fallback.
    // This matters when a reviewer/provider transiently degrades semantic
    // domain ownership on a phrase the raw safety router already understands.
    const rawRoute = classifyRawBusinessIncidentRoute(probe.message);
    const route = rawRoute ?? classifySemanticBusinessIncidentRoute(meaning);
    const commercial = classifyCommercialBoundarySemantic(turn);

    const lanePass = route.lane === probe.expectedLane;
    const unitPass = route.businessUnit === probe.expectedBusinessUnit;
    const incidentBoundaryPass = probe.incidentMustBlockCommit
      ? commercial.mode === 'INCIDENT' && commercial.currentTurnCommit === false
      : true;
    const pass = lanePass && unitPass && incidentBoundaryPass;

    const row = {
      id:probe.id,
      message:probe.message,
      semantic:{
        source:turn.semanticSource,
        domain:turn.domain,
        speechAct:turn.speechAct ?? null,
        action:turn.action,
        informationNeed:turn.informationNeed ?? 'none',
        entities:turn.entities,
        confidence:turn.confidence,
        needsClarification:turn.needsClarification,
      },
      meaning:{
        conversationalMode:meaning.conversationalMode,
        commitmentLevel:meaning.commitmentLevel,
      },
      route,
      commercial,
      expectedLane:probe.expectedLane,
      expectedBusinessUnit:probe.expectedBusinessUnit,
      pass,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  const failed = results.filter(row => row.pass !== true);
  const incidentRows = results.filter(row => row.expectedLane === 'INCIDENT');
  const summary = {
    kind:'PHASE5_LIVE_BUSINESS_INCIDENT',
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    incidentCases:incidentRows.length,
    incidentFalseCommits:incidentRows.filter(row => {
      const commercial=row.commercial as {currentTurnCommit?:boolean};
      return commercial.currentTurnCommit === true;
    }).length,
    failures:failed.map(row => ({
      id:row.id,
      expectedLane:row.expectedLane,
      expectedBusinessUnit:row.expectedBusinessUnit,
      route:row.route,
      semantic:row.semantic,
      commercial:row.commercial,
    })),
  };
  console.log(JSON.stringify(summary,null,2));

  assert.equal(summary.incidentFalseCommits,0,'an incident crossed the Phase 4 commercial boundary');
  assert.equal(summary.failed,0,'Phase 5 live business/incident routing matrix failed');
}

main().catch(error => {
  console.error('PHASE5_LIVE_BUSINESS_INCIDENT_FAILED', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
