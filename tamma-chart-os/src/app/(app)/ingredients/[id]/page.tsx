import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import { listSuppliers } from "@/server/suppliers";
import { listIngredientPriceHistory } from "@/server/ingredient-prices";
import { computePriceStats } from "@/lib/calc";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PriceEntryForm } from "./price-entry-form";
import { PriceSparkline } from "./price-sparkline";

function baht(n: number | null, digits = 4) {
  if (n === null) return "—";
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: digits })} บาท`;
}

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: ingredient } = await supabase
    .from("ingredients")
    .select("*")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!ingredient) notFound();

  const [history, suppliers] = await Promise.all([
    listIngredientPriceHistory(id),
    listSuppliers(),
  ]);
  const stats = computePriceStats(history);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ingredients" className="text-sm text-forest-500 hover:underline">
          ← ต้นทุนวัตถุดิบ
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">{ingredient.name}</h1>
        <p className="text-sm text-ink-light">
          หน่วยฐาน {ingredient.base_unit} · หน่วยซื้อ {ingredient.purchase_unit} (1 {ingredient.purchase_unit} ={" "}
          {ingredient.conversion_factor} {ingredient.base_unit})
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ราคาล่าสุด / หน่วยฐาน" value={baht(stats.latest?.cost_per_base_unit ?? null)} />
        <StatCard label="ราคาเมื่อครั้งก่อน" value={baht(stats.previous?.cost_per_base_unit ?? null)} />
        <StatCard label="ค่าเฉลี่ย 7 วัน" value={baht(stats.average7Day)} />
        <StatCard label="ค่าเฉลี่ย 30 วัน" value={baht(stats.average30Day)} />
        <StatCard label="ราคาต่ำสุด" value={baht(stats.min)} />
        <StatCard label="ราคาสูงสุด" value={baht(stats.max)} />
        <StatCard
          label="% เปลี่ยนแปลงจากค่าเฉลี่ย 7 วัน"
          value={
            stats.percentChangeFromAverage7Day !== null
              ? `${stats.percentChangeFromAverage7Day > 0 ? "+" : ""}${stats.percentChangeFromAverage7Day.toFixed(1)}%`
              : "—"
          }
          tone={
            stats.percentChangeFromAverage7Day !== null && stats.percentChangeFromAverage7Day > 10
              ? "danger"
              : "default"
          }
        />
        <div className="card flex items-center justify-center p-4">
          <PriceSparkline history={history} />
        </div>
      </div>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">บันทึกราคาใหม่</h2>
        <PriceEntryForm ingredient={ingredient} suppliers={suppliers} />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">ประวัติราคา</h2>
        {history.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลราคาวัตถุดิบ" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">วันที่</th>
                  <th className="py-2 pr-4 font-medium">ผู้ขาย</th>
                  <th className="py-2 pr-4 font-medium">ราคารวม</th>
                  <th className="py-2 pr-4 font-medium">ปริมาณ</th>
                  <th className="py-2 pr-4 font-medium">ต้นทุน/หน่วยฐาน</th>
                  <th className="py-2 pr-4 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{h.purchase_date}</td>
                    <td className="py-2 pr-4 text-ink-light">
                      {h.supplier_id ? supplierName.get(h.supplier_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2 pr-4">{baht(h.price, 2)}</td>
                    <td className="py-2 pr-4 text-ink-light">
                      {h.purchase_quantity} {h.purchase_unit}
                    </td>
                    <td className="py-2 pr-4">{baht(h.cost_per_base_unit)}</td>
                    <td className="py-2 pr-4 text-ink-light">{h.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
