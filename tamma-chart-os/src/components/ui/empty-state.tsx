export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-cream-50 px-6 py-12 text-center">
      <p className="text-sm text-ink-light">{title}</p>
      {action}
    </div>
  );
}
