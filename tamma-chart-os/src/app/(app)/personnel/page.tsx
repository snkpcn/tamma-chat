import {
  archiveEmployeePosition,
  createEmployeePosition,
  listEmployeePositions,
  listEmployees,
  renameEmployeePosition,
} from "@/server/employees";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleListManager } from "@/components/simple-list-manager";
import { EmployeesTable } from "./employees-table";
import type { EmployeePositionRow, EmployeeRow } from "@/types/database";

export default async function PersonnelPage() {
  let positions: EmployeePositionRow[] = [];
  let employees: EmployeeRow[] = [];
  let setupError: string | null = null;

  try {
    [positions, employees] = await Promise.all([listEmployeePositions(), listEmployees()]);
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">บุคลากร</h1>
        <p className="text-sm text-ink-light">ข้อมูลพนักงานพื้นฐานสำหรับการบริหารร้าน</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <EmployeesTable employees={employees} positions={positions} />
        <SimpleListManager
          title="ตำแหน่งงาน"
          items={positions}
          createAction={createEmployeePosition}
          onRename={renameEmployeePosition}
          onArchive={archiveEmployeePosition}
          emptyLabel="ยังไม่มีตำแหน่งงาน"
          placeholder="ชื่อตำแหน่งใหม่"
        />
      </div>
    </div>
  );
}
