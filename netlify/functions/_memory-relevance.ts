import type { SemanticTurn } from './_semantic-interpreter';

export type DurableMemorySnapshot = {
  travelerType?: string | null;
  pace?: string | null;
  interests?: string[];
  constraints?: string[];
  group?: { adults?: number | null; children?: number | null; elderly?: number | null } | null;
  favorites?: string[];
  visitedExperiences?: string[];
};

export type MemoryRelevancePlan = {
  relevantConstraints: string[];
  travelerType: string | null;
  pace: string | null;
  interests: string[];
  favorites: string[];
  visitedExperiences: string[];
  appliedKeys: string[];
  ignoredKeys: string[];
};

export function planMemoryRelevance(
  _turn: SemanticTurn,
  memory: DurableMemorySnapshot | null | undefined,
): MemoryRelevancePlan {
  const keys = memory ? Object.keys(memory) : [];
  return {
    relevantConstraints: [],
    travelerType: null,
    pace: null,
    interests: [],
    favorites: [],
    visitedExperiences: [],
    appliedKeys: [],
    ignoredKeys: keys,
  };
}
