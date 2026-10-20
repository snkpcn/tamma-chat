import { EmptyState } from "@/components/ui/empty-state";
import type { StockLevel } from "@/server/stock";

const STATUS_TONE: Record<StockLevel["status"], string> = {
  พร้อมใช้: "bg-forest-100 text-forest-500",
  ใกล้หมด: "bg-gold-100 text-gold-600",
  ต้องสั่งเพิ่ม: "bg-gold-100 text-gold-600",
  หมด: "bg-red-100 text-red-600",
};

export function StockLevelsTable({ levels }: { levels: StockLevel[] }) {
  if (levels.length === 0) {
    return <EmptyState title="ยังไม่มีข้อมูลวัตถุดิบสำหรับติดตามสต๊อก" />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-light">
            <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
            <th className="py-2 pr-4 font-medium">คงเหลือ</th>
            <th className="py-2 pr-4 font-medium">หน่วย</th>
            <th className="py-2 pr-4 font-medium">มูลค่าสต๊อก</th>
            <th className="py-2 pr-4 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {levels.map(({ ingredient, quantityBaseUnit, valuationAmount, status }) => (
            <tr key={ingredient.id} className="border-b border-line last:border-0">
              <td className="py-2 pr-4 font-medium text-ink">{ingredient.name}</td>
              <td className="py-2 pr-4">{quantityBaseUnit.toLocaleString("th-TH", { maximumFractionDigits: 2 })}</td>
              <td className="py-2 pr-4 text-ink-light">{ingredient.base_unit}</td>
              <td className="py-2 pr-4">
                {valuationAmount.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท
              </td>
              <td className="py-2 pr-4">
                <span className={`badge ${STATUS_TONE[status]}`}>{status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
