export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const toneClass = {
    default: "text-ink",
    warning: "text-gold-600",
    danger: "text-red-600",
    success: "text-forest-500",
  }[tone];

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-light">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-light">{hint}</p>}
    </div>
  );
}
