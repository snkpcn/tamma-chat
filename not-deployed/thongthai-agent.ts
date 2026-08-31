/**
 * not-deployed/thongthai-agent.ts
 *
 * ⚠️ NOT DEPLOYED. Deliberately moved out of netlify/functions/ so it is
 * NOT auto-discovered and published as a live endpoint — Netlify deploys
 * every file placed in that directory regardless of per-function config in
 * netlify.toml, so removing its config block alone would not have stopped
 * it from going live. This project should never expose a publicly
 * reachable AI endpoint whose callLanguageModel() still throws.
 *
 * To connect this for real: move it back into netlify/functions/, add its
 * config block back to netlify.toml (see thongthai-chat's block for the
 * pattern), fix the relative import path back to '../../src/data/experiences'
 * (it changed when this file moved out of netlify/functions/), fill in
 * callLanguageModel() the same way thongthai-chat.ts's is filled in, and
 * wire an actual frontend call to it — none of index.html currently
 * references this endpoint at all (confirmed by direct search).
 *
 * Server-side Journey Agent for ทำมา-ชาติ × ทองไทย AI.
 *
 * STATUS: real, complete implementation of the workflow — request
 * validation, prompt construction, JSON-schema validation, retry-on-
 * malformed-response, structured error handling. The one thing this
 * file does NOT do is call a live LLM, because no API key exists
 * anywhere in this project yet. See callLanguageModel() below: it is
 * written so that adding a real provider is a ~10 line change, but it
 * currently throws a clear, typed error rather than pretending to work.
 *
 * DO NOT deploy this expecting it to generate real journeys until:
 *   1. This site is a git-connected Netlify site (not a Netlify Drop
 *      upload of a single HTML file) with Netlify Functions enabled.
 *   2. A real API key for your chosen provider (Gemini / OpenAI /
 *      Anthropic) is set as a Netlify environment variable.
 *   3. callLanguageModel() below is filled in for that provider.
 *
 * Endpoint once deployed: POST /.netlify/functions/thongthai-agent
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import { EXPERIENCES, annotateForGroup, type Experience } from '../src/data/experiences';

// ---------------------------------------------------------------------------
// Request / response contracts (Step 2 + Step 7 of the brief)
// ---------------------------------------------------------------------------

export interface JourneyRequest {
  tripDuration: '2-3h' | 'half-day' | '1d' | '2d1n' | '3d2n';
  travelerType: 'solo' | 'couple' | 'family' | 'friends';
  group?: { adults?: number; children?: number; elderly?: number };
  interests: string[]; // e.g. ['food','nature','rest','adventure','local culture']
  pace: 'slow' | 'balanced' | 'active';
  budget?: number;
  constraints?: string[]; // free-text, e.g. "elderly cannot walk long distances"
  language: 'th' | 'en' | 'zh' | 'lo' | 'vi';
}

export interface JourneyStop {
  time: string;
  experienceId: string | null;
  name: string;
  category: 'welcome' | 'dining' | 'stay' | 'adventure' | 'nature' | 'local' | 'journal';
  durationMinutes: number;
  reason: string;
}

export interface JourneyDay {
  day: number;
  theme: string;
  stops: JourneyStop[];
}

export interface JourneyResponse {
  journeyTitle: string;
  summary: string;
  guestInsight: {
    travelerType: string;
    pace: string;
    keyNeeds: string[];
    planningReason: string;
  };
  days: JourneyDay[];
  personalizationReasons: string[];
  packageSuggestion: {
    name: string;
    estimatedBudget: number | null;
    includedExperiences: string[];
    note: string;
  };
  backupPlan: { trigger: string; adjustment: string };
  returnFor: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Provider abstraction (Step 3) — swap the implementation, not the callers.
// ---------------------------------------------------------------------------

export interface AgentProvider {
  generateJourney(input: JourneyRequest): Promise<JourneyResponse>;
}

class ProviderNotConfiguredError extends Error {
  constructor() {
    super('No LLM provider is configured. Set an API key as a Netlify environment variable and implement callLanguageModel().');
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * The only function that would need real work to go live. Intentionally
 * NOT implemented against a specific provider here — this project has no
 * API key for one. Wiring a real provider looks like:
 *
 *   const key = process.env.GEMINI_API_KEY; // server-side env var ONLY
 *   const res = await fetch('https://generativelanguage.googleapis.com/...', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ ...systemPrompt, contents: [...] }),
 *   });
 *   const text = (await res.json()).candidates[0].content.parts[0].text;
 *   return text; // then parseAndValidate() below handles the rest
 */
async function callLanguageModel(_systemPrompt: string, _userPrompt: string): Promise<string> {
  throw new ProviderNotConfiguredError();
}

// ---------------------------------------------------------------------------
// Step 4 — agent principles, baked into the system prompt every call sends.
// ---------------------------------------------------------------------------

const SYSTEM_PRINCIPLES = `You are ทองไทย (Thongthai), the Local Host and Journey Planner for
ทำมา-ชาติ — Experiences of Isan. You are not a generic chatbot.

Principles, in priority order:
1. Guest needs come before maximizing sales.
2. Avoid overpacking the itinerary — a good Journey has rhythm and rest.
3. Respect children, elderly, mobility, and pace constraints absolutely: never
   assign an activity flagged "flaggedFor" in the catalog to the traveler(s)
   it's unsuitable for. Do not remove it for the whole group, though — for a
   mixed group, split it: e.g. children get Adventure while an elderly member
   has a parallel lower-intensity option at the same time. Only drop an
   activity entirely if every present traveler is affected by its flag.
4. Preserve an authentic Isan experience — no generic resort filler.
5. Balance food, rest, nature, and activity across the trip.
6. Avoid repeating the same experience unnecessarily across days.
7. NEVER invent live facts: no prices, hours, availability, or weather
   you were not given. If unknown, omit it rather than guess.
8. Choose experiences ONLY from the provided catalog. Never invent a
   business, activity, or place that is not in that list.
9. Every recommended stop must include a short, concrete, customer-facing
   reason — not generic marketing language.
10. Respond with ONLY the JSON object described in the schema you are
    given. No prose outside the JSON.`;

function buildUserPrompt(input: JourneyRequest, catalog: Experience[]): string {
  return JSON.stringify({
    guestRequest: input,
    availableExperiences: catalog,
    instructions: [
      'Generate 3 candidate day-by-day journeys internally.',
      'Score each candidate: Guest Fit 30%, Feasibility 25%, Wellness Balance 20%, Isan Authenticity 15%, Ecosystem Discovery 10%.',
      'Select the best-scoring candidate.',
      'Self-check the selection against every constraint in guestRequest before finalizing.',
      'If the self-check fails, repair the plan and re-check before returning.',
      'Do not expose the scores or your reasoning process — only the final structured result.',
    ],
  });
}

// ---------------------------------------------------------------------------
// Step 7 — strict response validation. Never trust model JSON blindly.
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateJourneyResponse(data: unknown): JourneyResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }
  const d = data as Record<string, unknown>;

  if (!isNonEmptyString(d.journeyTitle)) throw new Error('Missing journeyTitle');
  if (!isNonEmptyString(d.summary)) throw new Error('Missing summary');
  if (!Array.isArray(d.days) || d.days.length === 0) throw new Error('Missing or empty days[]');

  const validExperienceIds = new Set(EXPERIENCES.map(e => e.id));

  const days: JourneyDay[] = (d.days as unknown[]).map((rawDay, i) => {
    if (typeof rawDay !== 'object' || rawDay === null) throw new Error(`days[${i}] is not an object`);
    const day = rawDay as Record<string, unknown>;
    if (!Array.isArray(day.stops)) throw new Error(`days[${i}].stops is not an array`);
    if (day.stops.length > 6) throw new Error(`days[${i}] has too many stops (${day.stops.length}) — itinerary is overpacked`);

    const stops: JourneyStop[] = (day.stops as unknown[]).map((rawStop, j) => {
      const stop = rawStop as Record<string, unknown>;
      if (!isNonEmptyString(stop.name)) throw new Error(`days[${i}].stops[${j}] missing name`);
      if (!isNonEmptyString(stop.reason)) throw new Error(`days[${i}].stops[${j}] missing reason`);
      // Never let the model reference a business that isn't in our real catalog.
      if (stop.experienceId != null && !validExperienceIds.has(String(stop.experienceId))) {
        throw new Error(`days[${i}].stops[${j}] references unknown experienceId "${stop.experienceId}"`);
      }
      return {
        time: isNonEmptyString(stop.time) ? stop.time : '',
        experienceId: stop.experienceId == null ? null : String(stop.experienceId),
        name: stop.name,
        category: (stop.category as JourneyStop['category']) ?? 'local',
        durationMinutes: typeof stop.durationMinutes === 'number' ? stop.durationMinutes : 30,
        reason: stop.reason,
      };
    });

    return {
      day: typeof day.day === 'number' ? day.day : i + 1,
      theme: isNonEmptyString(day.theme) ? day.theme : '',
      stops,
    };
  });

  return {
    journeyTitle: d.journeyTitle as string,
    summary: d.summary as string,
    guestInsight: (d.guestInsight as JourneyResponse['guestInsight']) ?? {
      travelerType: '', pace: '', keyNeeds: [], planningReason: '',
    },
    days,
    personalizationReasons: Array.isArray(d.personalizationReasons) ? d.personalizationReasons as string[] : [],
    packageSuggestion: (d.packageSuggestion as JourneyResponse['packageSuggestion']) ?? {
      name: '', estimatedBudget: null, includedExperiences: [], note: '',
    },
    backupPlan: (d.backupPlan as JourneyResponse['backupPlan']) ?? { trigger: '', adjustment: '' },
    returnFor: Array.isArray(d.returnFor) ? d.returnFor as string[] : [],
    warnings: Array.isArray(d.warnings) ? d.warnings as string[] : [],
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

// ---------------------------------------------------------------------------
// The provider implementation
// ---------------------------------------------------------------------------

class LLMAgentProvider implements AgentProvider {
  async generateJourney(input: JourneyRequest): Promise<JourneyResponse> {
    const hasElderly = (input.group?.elderly ?? 0) > 0
      || (input.constraints ?? []).some(c => /elderly|mobility|walk/i.test(c));
    const hasYoungChildren = (input.group?.children ?? 0) > 0;
    const catalog = annotateForGroup(hasElderly, hasYoungChildren);

    const userPrompt = buildUserPrompt(input, catalog);

    let raw: string;
    try {
      raw = await callLanguageModel(SYSTEM_PRINCIPLES, userPrompt);
    } catch (err) {
      throw err; // surfaced as 503 by the handler below
    }

    try {
      return validateJourneyResponse(JSON.parse(stripCodeFences(raw)));
    } catch (firstError) {
      // Step 7 — retry once with an explicit repair instruction before giving up.
      const repairPrompt = userPrompt + '\n\nYour previous response was invalid JSON or failed validation: '
        + (firstError as Error).message + '. Return ONLY a corrected JSON object matching the schema.';
      const repaired = await callLanguageModel(SYSTEM_PRINCIPLES, repairPrompt);
      return validateJourneyResponse(JSON.parse(stripCodeFences(repaired)));
    }
  }
}

const provider: AgentProvider = new LLMAgentProvider();

// ---------------------------------------------------------------------------
// Netlify handler
// ---------------------------------------------------------------------------

function isValidRequest(body: unknown): body is JourneyRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return isNonEmptyString(b.tripDuration) && isNonEmptyString(b.travelerType)
    && Array.isArray(b.interests) && isNonEmptyString(b.pace) && isNonEmptyString(b.language);
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Malformed JSON body' }) };
  }

  if (!isValidRequest(body)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: tripDuration, travelerType, interests, pace, language' }) };
  }

  try {
    const journey = await provider.generateJourney(body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(journey),
    };
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      // Honest 503, not a fake 200 with placeholder content.
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: 'AI provider not configured',
          message: 'This deployment has no LLM API key set. See callLanguageModel() in thongthai-agent.ts.',
        }),
      };
    }
    // Never leak stack traces or internals to the client (Step 12/13).
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Journey generation failed. Please try again.' }),
    };
  }
};
