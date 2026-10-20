import { EmptyState } from "@/components/ui/empty-state";

export function PlaceholderPage({
  title,
  phaseNote,
}: {
  title: string;
  phaseNote: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
      </div>
      <EmptyState title={`ยังไม่เปิดใช้งานโมดูลนี้ — ${phaseNote}`} />
    </div>
  );
}
