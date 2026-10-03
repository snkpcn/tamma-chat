// Pure calculation helpers shared by server actions and components. Kept out
// of any "use server" file since those may only export async functions.

import type { IngredientPriceHistoryRow } from "@/types/database";

export type PriceStats = {
  latest: IngredientPriceHistoryRow | null;
  previous: IngredientPriceHistoryRow | null;
  average7Day: number | null;
  average30Day: number | null;
  min: number | null;
  max: number | null;
  percentChangeFromAverage7Day: number | null;
};

export function computePriceStats(
  history: IngredientPriceHistoryRow[],
): PriceStats {
  if (history.length === 0) {
    return {
      latest: null,
      previous: null,
      average7Day: null,
      average30Day: null,
      min: null,
      max: null,
      percentChangeFromAverage7Day: null,
    };
  }

  // history is sorted newest-first by the caller's query.
  const latest = history[0]!;
  const previous = history[1] ?? null;

  const now = new Date(latest.purchase_date).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const within = (days: number) =>
    history.filter(
      (h) => now - new Date(h.purchase_date).getTime() <= days * DAY_MS,
    );

  const avg = (rows: IngredientPriceHistoryRow[]) =>
    rows.length
      ? rows.reduce((sum, r) => sum + r.cost_per_base_unit, 0) / rows.length
      : null;

  const average7Day = avg(within(7));
  const average30Day = avg(within(30));
  const costs = history.map((h) => h.cost_per_base_unit);

  return {
    latest,
    previous,
    average7Day,
    average30Day,
    min: Math.min(...costs),
    max: Math.max(...costs),
    percentChangeFromAverage7Day:
      average7Day && average7Day > 0
        ? ((latest.cost_per_base_unit - average7Day) / average7Day) * 100
        : null,
  };
}

export function foodCostPercent(totalCost: number, sellingPrice: number): number | null {
  if (!sellingPrice || sellingPrice <= 0) return null;
  return (totalCost / sellingPrice) * 100;
}

export function grossMarginPercent(totalCost: number, sellingPrice: number): number | null {
  if (!sellingPrice || sellingPrice <= 0) return null;
  return ((sellingPrice - totalCost) / sellingPrice) * 100;
}
