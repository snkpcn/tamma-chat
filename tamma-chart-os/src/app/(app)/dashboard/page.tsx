import Link from "next/link";
import { getInvestmentSummary } from "@/server/investments";
import { NoRestaurantError } from "@/server/restaurant";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";

function formatBaht(amount: number) {
  return `${amount.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`;
}

export default async function DashboardPage() {
  let summary: Awaited<ReturnType<typeof getInvestmentSummary>> | null = null;
  let setupNeeded = false;

  try {
    summary = await getInvestmentSummary();
  } catch (err) {
    if (err instanceof NoRestaurantError) {
      setupNeeded = true;
    } else {
      throw err;
    }
  }

  if (setupNeeded) {
    return (
      <EmptyState title="บัญชีนี้ยังไม่ได้ผูกกับร้านอาหาร กรุณาสร้างข้อมูลร้านในฐานข้อมูลก่อนใช้งาน (ดู PROJECT_STATE.md หัวข้อการตั้งค่าเริ่มต้น)" />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">แดชบอร์ด</h1>
        <p className="text-sm text-ink-light">ภาพรวมร้านวันนี้</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="เงินลงทุนทั้งหมด" value={formatBaht(summary!.totalBudget)} />
        <StatCard label="ใช้ไปแล้ว" value={formatBaht(summary!.totalActual)} />
        <StatCard
          label="งบคงเหลือ"
          value={formatBaht(summary!.remaining)}
          tone={summary!.remaining < 0 ? "danger" : "default"}
        />
        <StatCard
          label="ความพร้อมก่อนเปิดร้าน"
          value="—"
          hint="ยังไม่เปิดใช้งานเช็กลิสต์เปิดร้าน"
        />
        <StatCard
          label="ต้นทุนวัตถุดิบวันนี้"
          value="—"
          hint="ยังไม่เปิดใช้งานโมดูลวัตถุดิบ"
        />
        <StatCard
          label="มูลค่าสต๊อกปัจจุบัน"
          value="—"
          hint="ยังไม่เปิดใช้งานโมดูลสต๊อก"
        />
      </div>

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">การลงทุนแยกตามหมวดหมู่</h2>
          <Link href="/investment" className="text-sm font-medium text-forest-500 hover:underline">
            ดูทั้งหมด
          </Link>
        </div>
        {summary!.byCategory.length === 0 ? (
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
                {summary!.byCategory.map((c) => (
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
          <h2 className="mb-3 text-base font-semibold text-ink">งานวันนี้ / เช็กลิสต์ก่อนเปิดร้าน</h2>
          <EmptyState title="ยังไม่เปิดใช้งานโมดูลงาน/เช็กลิสต์เปิดร้าน" />
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">แจ้งเตือน</h2>
          <EmptyState title="ไม่มีรายการที่ต้องดำเนินการ" />
        </section>
      </div>
    </div>
  );
}
