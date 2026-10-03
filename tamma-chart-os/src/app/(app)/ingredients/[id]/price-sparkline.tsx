import type { IngredientPriceHistoryRow } from "@/types/database";

export function PriceSparkline({
  history,
}: {
  history: IngredientPriceHistoryRow[];
}) {
  if (history.length < 2) return null;

  // history is newest-first; chart reads left (oldest) to right (newest).
  const points = [...history].reverse();
  const costs = points.map((p) => p.cost_per_base_unit);
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  const range = max - min || 1;
  const width = 320;
  const height = 64;
  const step = width / (points.length - 1);

  const coords = costs.map((cost, i) => {
    const x = i * step;
    const y = height - ((cost - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full max-w-xs text-forest-500">
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
