"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmployeeForm } from "./employee-form";
import { archiveEmployee, createEmployee, updateEmployee } from "@/server/employees";
import type { EmployeePositionRow, EmployeeRow } from "@/types/database";

export function EmployeesTable({
  employees,
  positions,
}: {
  employees: EmployeeRow[];
  positions: EmployeePositionRow[];
}) {
  const [modal, setModal] = useState<"create" | EmployeeRow | null>(null);
  const positionName = new Map(positions.map((p) => [p.id, p.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">พนักงาน</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มพนักงาน
        </button>
      </div>

      {employees.length === 0 ? (
        <EmptyState
          title="ยังไม่มีข้อมูลพนักงาน"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มพนักงานคนแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อ</th>
                <th className="py-2 pr-4 font-medium">ตำแหน่ง</th>
                <th className="py-2 pr-4 font-medium">เบอร์โทร</th>
                <th className="py-2 pr-4 font-medium">ประเภทการจ้าง</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">
                    {emp.full_name}
                    {emp.nickname && <span className="text-ink-light"> ({emp.nickname})</span>}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">
                    {emp.position_id ? positionName.get(emp.position_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">{emp.phone ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-light">{emp.employment_type ?? "—"}</td>
                  <td className="py-2 pr-4">{emp.status}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(emp)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ปรับสถานะ "${emp.full_name}" เป็นพ้นสภาพ?`}
                        onConfirm={() => archiveEmployee(emp.id)}
                      >
                        พ้นสภาพ
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === "create" ? "เพิ่มพนักงาน" : "แก้ไขพนักงาน"} onClose={() => setModal(null)}>
          <EmployeeForm
            positions={positions}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createEmployee : updateEmployee.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
