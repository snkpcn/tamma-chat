import Link from "next/link";
import { getInvestmentSummary } from "@/server/investments";
import { getTodayIngredientSpend } from "@/server/ingredient-prices";
import { listStockLevels } from "@/server/stock";
import { getOpeningReadiness } from "@/server/opening-checklist";
import { computeAlerts, type ComputedAlert } from "@/server/alerts";
import { listTasks } from "@/server/projects";
import { NoRestaurantError } from "@/server/restaurant";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";

function formatBaht(amount: number) {
  return `${amount.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`;
}

const SEVERITY_ORDER: Record<ComputedAlert["severity"], number> = {
  วิกฤต: 0,
  เตือน: 1,
  ปกติ: 2,
};

const SEVERITY_TONE: Record<ComputedAlert["severity"], string> = {
  วิกฤต: "bg-red-100 text-red-600",
  เตือน: "bg-gold-100 text-gold-600",
  ปกติ: "bg-cream-200 text-ink-light",
};

export default async function DashboardPage() {
  let data: {
    investmentSummary: Awaited<ReturnType<typeof getInvestmentSummary>>;
    todaySpend: number;
    stockValue: number;
    readiness: Awaited<ReturnType<typeof getOpeningReadiness>>;
    alerts: ComputedAlert[];
    dueTasks: Awaited<ReturnType<typeof listTasks>>;
  } | null = null;
  let setupError: string | null = null;

  try {
    const [investmentSummary, todaySpend, stockLevels, readiness, alerts, tasks] =
      await Promise.all([
        getInvestmentSummary(),
        getTodayIngredientSpend(),
        listStockLevels(),
        getOpeningReadiness(),
        computeAlerts(),
        listTasks(),
      ]);

    data = {
      investmentSummary,
      todaySpend,
      stockValue: stockLevels.reduce((sum, l) => sum + l.valuationAmount, 0),
      readiness,
      alerts: [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
      dueTasks: tasks.filter(
        (t) =>
          t.status !== "เสร็จแล้ว" &&
          t.status !== "ยกเลิก" &&
          t.due_date &&
          new Date(t.due_date) <= new Date(new Date().toDateString()),
      ),
    };
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError || !data) {
    return (
      <EmptyState
        title={
          setupError ??
          "บัญชีนี้ยังไม่ได้ผูกกับร้านอาหาร กรุณาสร้างข้อมูลร้านในฐานข้อมูลก่อนใช้งาน (ดู PROJECT_STATE.md หัวข้อการตั้งค่าเริ่มต้น)"
        }
      />
    );
  }

  const { investmentSummary, todaySpend, stockValue, readiness, alerts, dueTasks } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">แดชบอร์ด</h1>
        <p className="text-sm text-ink-light">ภาพรวมร้านวันนี้</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="เงินลงทุนทั้งหมด" value={formatBaht(investmentSummary.totalBudget)} />
        <StatCard label="ใช้ไปแล้ว" value={formatBaht(investmentSummary.totalActual)} />
        <StatCard
          label="งบคงเหลือ"
          value={formatBaht(investmentSummary.remaining)}
          tone={investmentSummary.remaining < 0 ? "danger" : "default"}
        />
        <StatCard label="ความพร้อมก่อนเปิดร้าน" value={`${readiness.percent.toFixed(0)}%`} />
        <StatCard label="ต้นทุนวัตถุดิบวันนี้" value={formatBaht(todaySpend)} />
        <StatCard label="มูลค่าสต๊อกปัจจุบัน" value={formatBaht(stockValue)} />
      </div>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">การลงทุนแยกตามหมวดหมู่</h2>
          <Link href="/investment" className="text-sm font-medium text-forest-500 hover:underline">
            ดูทั้งหมด
          </Link>
        </div>
        {investmentSummary.byCategory.length === 0 ? (
          <EmptyState
            title="ยังไม่มีรายการลงทุน"
            action={
              <Link href="/investment" className="btn-primary">
                เพิ่มรายการลงทุน
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-light">
                  <th className="py-2 pr-4 font-medium">หมวดหมู่</th>
                  <th className="py-2 pr-4 font-medium">งบ</th>
                  <th className="py-2 pr-4 font-medium">ใช้จริง</th>
                  <th className="py-2 pr-4 font-medium">คงเหลือ</th>
                  <th className="py-2 pr-4 font-medium">% ใช้งบ</th>
                </tr>
              </thead>
              <tbody>
                {investmentSummary.byCategory.map((c) => (
                  <tr key={c.categoryId ?? "none"} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{c.categoryName}</td>
                    <td className="py-2 pr-4">{formatBaht(c.budget)}</td>
                    <td className="py-2 pr-4">{formatBaht(c.actual)}</td>
                    <td className={`py-2 pr-4 ${c.remaining < 0 ? "text-red-600" : ""}`}>
                      {formatBaht(c.remaining)}
                    </td>
                    <td className={`py-2 pr-4 ${c.isOverBudget ? "text-red-600 font-medium" : ""}`}>
                      {c.usedPercent.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">งานวันนี้ / เลยกำหนด</h2>
            <Link href="/projects" className="text-sm font-medium text-forest-500 hover:underline">
              ดูทั้งหมด
            </Link>
          </div>
          {dueTasks.length === 0 ? (
            <EmptyState title="ไม่มีงานที่ต้องทำวันนี้" />
          ) : (
            <ul className="divide-y divide-line">
              {dueTasks.map((t) => (
                <li key={t.id} className="py-2 text-sm">
                  <span className="text-ink">{t.name}</span>{" "}
                  <span className="text-ink-light">({t.due_date})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">แจ้งเตือน</h2>
          {alerts.length === 0 ? (
            <EmptyState title="ไม่มีรายการที่ต้องดำเนินการ" />
          ) : (
            <ul className="space-y-2">
              {alerts.slice(0, 12).map((alert, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`badge shrink-0 ${SEVERITY_TONE[alert.severity]}`}>{alert.severity}</span>
                  <span className="text-ink">{alert.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
