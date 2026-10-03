import { listIngredients } from "@/server/ingredients";
import { listSuppliers } from "@/server/suppliers";
import {
  archiveWasteReason,
  createWasteReason,
  listStockLevels,
  listWasteReasons,
  renameWasteReason,
} from "@/server/stock";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleListManager } from "@/components/simple-list-manager";
import { StockLevelsTable } from "./stock-levels-table";
import { ReceiveStockForm } from "./receive-stock-form";
import { AdjustmentForm } from "./adjustment-form";
import { StockCountForm } from "./stock-count-form";
import { WasteForm } from "./waste-form";
import type { IngredientRow, SupplierRow, WasteReasonRow } from "@/types/database";
import type { StockLevel } from "@/server/stock";

export default async function StockPage() {
  let levels: StockLevel[] = [];
  let ingredients: IngredientRow[] = [];
  let suppliers: SupplierRow[] = [];
  let reasons: WasteReasonRow[] = [];
  let setupError: string | null = null;

  try {
    [levels, ingredients, suppliers, reasons] = await Promise.all([
      listStockLevels(),
      listIngredients(),
      listSuppliers(),
      listWasteReasons(),
    ]);
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  const activeIngredients = ingredients.filter((i) => i.status === "ใช้งาน");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">สต๊อก</h1>
        <p className="text-sm text-ink-light">
          สต๊อกคำนวณจากประวัติการเคลื่อนไหวทั้งหมด ไม่ใช่ตัวเลขที่แก้ไขตรง ๆ
        </p>
      </div>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">คงเหลือปัจจุบัน</h2>
        <StockLevelsTable levels={levels} />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">รับวัตถุดิบเข้า</h2>
        <ReceiveStockForm ingredients={activeIngredients} suppliers={suppliers} />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">เบิกใช้ / ปรับยอด / โอน / คืนผู้ขาย</h2>
        <AdjustmentForm ingredients={activeIngredients} />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">นับสต๊อก</h2>
        <StockCountForm ingredients={activeIngredients} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">บันทึกของเสีย</h2>
          <WasteForm ingredients={activeIngredients} reasons={reasons} />
        </section>
        <SimpleListManager
          title="ประเภทของเสีย"
          items={reasons}
          createAction={createWasteReason}
          onRename={renameWasteReason}
          onArchive={archiveWasteReason}
          emptyLabel="ยังไม่มีประเภทของเสีย"
          placeholder="ชื่อสาเหตุใหม่"
        />
      </div>
    </div>
  );
}
