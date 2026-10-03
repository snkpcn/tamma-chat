import { getInvestmentSummary, listInvestments } from "@/server/investments";
import { listStockLevels } from "@/server/stock";
import {
  getIngredientPriceReport,
  getMenuProfitabilityReport,
  getOpeningReadinessByCategory,
  getSupplierPriceComparison,
  getWasteReport,
} from "@/server/reports";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { toCsv } from "@/lib/csv";

function baht(n: number) {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;

  let sections: {
    investments: Awaited<ReturnType<typeof listInvestments>>;
    investmentSummary: Awaited<ReturnType<typeof getInvestmentSummary>>;
    priceHistory: Awaited<ReturnType<typeof getIngredientPriceReport>>;
    stockLevels: Awaited<ReturnType<typeof listStockLevels>>;
    waste: Awaited<ReturnType<typeof getWasteReport>>;
    menuProfitability: Awaited<ReturnType<typeof getMenuProfitabilityReport>>;
    supplierComparison: Awaited<ReturnType<typeof getSupplierPriceComparison>>;
    readinessByCategory: Awaited<ReturnType<typeof getOpeningReadinessByCategory>>;
  } | null = null;
  let setupError: string | null = null;

  try {
    const [
      investments,
      investmentSummary,
      priceHistory,
      stockLevels,
      waste,
      menuProfitability,
      supplierComparison,
      readinessByCategory,
    ] = await Promise.all([
      listInvestments(),
      getInvestmentSummary(),
      getIngredientPriceReport(from, to),
      listStockLevels(),
      getWasteReport(from, to),
      getMenuProfitabilityReport(),
      getSupplierPriceComparison(),
      getOpeningReadinessByCategory(),
    ]);
    sections = {
      investments,
      investmentSummary,
      priceHistory,
      stockLevels,
      waste,
      menuProfitability,
      supplierComparison,
      readinessByCategory,
    };
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError || !sections) return <EmptyState title={setupError ?? "เกิดข้อผิดพลาด"} />;

  const {
    investments,
    investmentSummary,
    priceHistory,
    stockLevels,
    waste,
    menuProfitability,
    supplierComparison,
    readinessByCategory,
  } = sections;

  const investmentCsv = toCsv(
    ["ชื่อรายการ", "งบประมาณ", "ราคาจริง", "สถานะ"],
    investments.map((i) => [i.name, i.budget_amount, i.actual_amount, i.status]),
  );
  const priceCsv = toCsv(
    ["วันที่", "วัตถุดิบ", "ผู้ขาย", "ราคา", "ปริมาณ", "หน่วย", "ต้นทุน/หน่วยฐาน"],
    priceHistory.map((r) => [
      r.purchaseDate,
      r.ingredientName,
      r.supplierName,
      r.price,
      r.purchaseQuantity,
      r.purchaseUnit,
      r.costPerBaseUnit,
    ]),
  );
  const stockCsv = toCsv(
    ["วัตถุดิบ", "คงเหลือ", "หน่วย", "มูลค่า", "สถานะ"],
    stockLevels.map((l) => [
      l.ingredient.name,
      l.quantityBaseUnit,
      l.ingredient.base_unit,
      l.valuationAmount,
      l.status,
    ]),
  );
  const wasteCsv = toCsv(
    ["วันที่", "วัตถุดิบ", "สาเหตุ", "จำนวน", "หน่วย", "มูลค่าประมาณ"],
    waste.map((w) => [
      w.occurredAt.slice(0, 10),
      w.ingredientName,
      w.reasonName,
      w.quantityBaseUnit,
      w.baseUnit,
      w.estimatedValue,
    ]),
  );
  const menuCsv = toCsv(
    ["เมนู", "ราคาขาย", "ต้นทุน", "Food Cost %", "Gross Margin %"],
    menuProfitability.map((m) => [
      m.menuName,
      m.sellingPrice,
      m.totalCost ?? "",
      m.foodCostPercentValue?.toFixed(1) ?? "",
      m.marginPercentValue?.toFixed(1) ?? "",
    ]),
  );
  const supplierCsv = toCsv(
    ["วัตถุดิบ", "ผู้ขาย", "ราคาล่าสุด", "ซื้อครั้งล่าสุด"],
    supplierComparison.map((s) => [
      s.ingredientName,
      s.supplierName,
      s.latestPrice ?? "",
      s.lastPurchaseDate ?? "",
    ]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">รายงาน</h1>
        <p className="text-sm text-ink-light">สรุปข้อมูลสำหรับตรวจสอบและวางแผน</p>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label className="field-label" htmlFor="from">
            ตั้งแต่วันที่ (ราคาวัตถุดิบ/ของเสีย)
          </label>
          <input id="from" name="from" type="date" defaultValue={from ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            ถึงวันที่
          </label>
          <input id="to" name="to" type="date" defaultValue={to ?? ""} className="field-input" />
        </div>
        <button type="submit" className="btn-primary">
          กรอง
        </button>
      </form>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">การลงทุน / งบประมาณเทียบใช้จริง</h2>
          <ExportCsvButton filename="investment-report.csv" csv={investmentCsv} />
        </div>
        <p className="mb-3 text-sm text-ink-light">
          งบรวม {baht(investmentSummary.totalBudget)} · ใช้จริง {baht(investmentSummary.totalActual)} · คงเหลือ{" "}
          {baht(investmentSummary.remaining)}
        </p>
        {investments.length === 0 ? (
          <EmptyState title="ยังไม่มีรายการลงทุน" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">ชื่อรายการ</th>
                  <th className="py-2 pr-4 font-medium">งบประมาณ</th>
                  <th className="py-2 pr-4 font-medium">ราคาจริง</th>
                  <th className="py-2 pr-4 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {investments.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{i.name}</td>
                    <td className="py-2 pr-4">{baht(i.budget_amount)}</td>
                    <td className="py-2 pr-4">{baht(i.actual_amount)}</td>
                    <td className="py-2 pr-4">{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">ประวัติราคาวัตถุดิบ</h2>
          <ExportCsvButton filename="ingredient-price-history.csv" csv={priceCsv} />
        </div>
        {priceHistory.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลราคาวัตถุดิบในช่วงที่เลือก" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">วันที่</th>
                  <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
                  <th className="py-2 pr-4 font-medium">ผู้ขาย</th>
                  <th className="py-2 pr-4 font-medium">ราคา</th>
                  <th className="py-2 pr-4 font-medium">ต้นทุน/หน่วยฐาน</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{r.purchaseDate}</td>
                    <td className="py-2 pr-4">{r.ingredientName}</td>
                    <td className="py-2 pr-4 text-ink-light">{r.supplierName}</td>
                    <td className="py-2 pr-4">{baht(r.price)}</td>
                    <td className="py-2 pr-4">{baht(r.costPerBaseUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">สต๊อกคงเหลือ / มูลค่าสต๊อก</h2>
          <ExportCsvButton filename="stock-report.csv" csv={stockCsv} />
        </div>
        {stockLevels.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลสต๊อก" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
                  <th className="py-2 pr-4 font-medium">คงเหลือ</th>
                  <th className="py-2 pr-4 font-medium">มูลค่า</th>
                  <th className="py-2 pr-4 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {stockLevels.map((l) => (
                  <tr key={l.ingredient.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{l.ingredient.name}</td>
                    <td className="py-2 pr-4">
                      {l.quantityBaseUnit.toLocaleString("th-TH", { maximumFractionDigits: 2 })} {l.ingredient.base_unit}
                    </td>
                    <td className="py-2 pr-4">{baht(l.valuationAmount)}</td>
                    <td className="py-2 pr-4">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">ของเสีย</h2>
          <ExportCsvButton filename="waste-report.csv" csv={wasteCsv} />
        </div>
        {waste.length === 0 ? (
          <EmptyState title="ไม่มีของเสียในช่วงที่เลือก" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">วันที่</th>
                  <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
                  <th className="py-2 pr-4 font-medium">สาเหตุ</th>
                  <th className="py-2 pr-4 font-medium">จำนวน</th>
                  <th className="py-2 pr-4 font-medium">มูลค่าประมาณ</th>
                </tr>
              </thead>
              <tbody>
                {waste.map((w, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{w.occurredAt.slice(0, 10)}</td>
                    <td className="py-2 pr-4">{w.ingredientName}</td>
                    <td className="py-2 pr-4 text-ink-light">{w.reasonName}</td>
                    <td className="py-2 pr-4">
                      {w.quantityBaseUnit.toLocaleString("th-TH", { maximumFractionDigits: 2 })} {w.baseUnit}
                    </td>
                    <td className="py-2 pr-4">{baht(w.estimatedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">ต้นทุนสูตร / Food Cost / กำไรขั้นต้นตามเมนู</h2>
          <ExportCsvButton filename="menu-profitability.csv" csv={menuCsv} />
        </div>
        {menuProfitability.length === 0 ? (
          <EmptyState title="ยังไม่มีเมนู" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">เมนู</th>
                  <th className="py-2 pr-4 font-medium">ราคาขาย</th>
                  <th className="py-2 pr-4 font-medium">ต้นทุน</th>
                  <th className="py-2 pr-4 font-medium">Food Cost %</th>
                  <th className="py-2 pr-4 font-medium">Gross Margin %</th>
                </tr>
              </thead>
              <tbody>
                {menuProfitability.map((m, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{m.menuName}</td>
                    <td className="py-2 pr-4">{baht(m.sellingPrice)}</td>
                    <td className="py-2 pr-4">{m.totalCost !== null ? baht(m.totalCost) : "ไม่มีสูตร"}</td>
                    <td className="py-2 pr-4">
                      {m.foodCostPercentValue !== null ? `${m.foodCostPercentValue.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {m.marginPercentValue !== null ? `${m.marginPercentValue.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">เปรียบเทียบราคาผู้ขาย</h2>
          <ExportCsvButton filename="supplier-comparison.csv" csv={supplierCsv} />
        </div>
        {supplierComparison.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลราคาต่อผู้ขาย (บันทึกราคาพร้อมระบุผู้ขายเพื่อเริ่มเก็บข้อมูล)" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
                  <th className="py-2 pr-4 font-medium">ผู้ขาย</th>
                  <th className="py-2 pr-4 font-medium">ราคาล่าสุด</th>
                  <th className="py-2 pr-4 font-medium">ซื้อครั้งล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {supplierComparison.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{s.ingredientName}</td>
                    <td className="py-2 pr-4 text-ink-light">{s.supplierName}</td>
                    <td className="py-2 pr-4">{s.latestPrice !== null ? baht(s.latestPrice) : "—"}</td>
                    <td className="py-2 pr-4 text-ink-light">{s.lastPurchaseDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">ความพร้อมก่อนเปิดร้าน (แยกตามหมวด)</h2>
        {readinessByCategory.length === 0 ? (
          <EmptyState title="ยังไม่มีเช็กลิสต์ก่อนเปิดร้าน" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">หมวด</th>
                  <th className="py-2 pr-4 font-medium">เสร็จแล้ว / ทั้งหมด</th>
                  <th className="py-2 pr-4 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {readinessByCategory.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{r.categoryName}</td>
                    <td className="py-2 pr-4">
                      {r.completed} / {r.total}
                    </td>
                    <td className="py-2 pr-4">{r.percent.toFixed(0)}%</td>
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
