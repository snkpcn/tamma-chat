import { listSuppliers } from "@/server/suppliers";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SuppliersTable } from "./suppliers-table";
import type { SupplierRow } from "@/types/database";

export default async function SuppliersPage() {
  let suppliers: SupplierRow[] = [];
  let setupError: string | null = null;

  try {
    suppliers = await listSuppliers();
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">ผู้ขาย / ซัพพลายเออร์</h1>
        <p className="text-sm text-ink-light">จัดการข้อมูลผู้ขายและเงื่อนไขการสั่งซื้อ</p>
      </div>
      <SuppliersTable suppliers={suppliers} />
    </div>
  );
}
