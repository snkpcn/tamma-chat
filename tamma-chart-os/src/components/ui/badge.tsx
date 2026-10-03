const STATUS_TONE: Record<string, string> = {
  วางแผน: "bg-cream-200 text-ink-light",
  ขอราคา: "bg-gold-100 text-gold-600",
  อนุมัติแล้ว: "bg-forest-100 text-forest-500",
  สั่งซื้อแล้ว: "bg-forest-100 text-forest-500",
  ชำระบางส่วน: "bg-gold-100 text-gold-600",
  ชำระแล้ว: "bg-forest-500 text-white",
  ได้รับของแล้ว: "bg-forest-500 text-white",
  ยกเลิก: "bg-red-100 text-red-600",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "bg-cream-200 text-ink-light";
  return <span className={`badge ${tone}`}>{status}</span>;
}
