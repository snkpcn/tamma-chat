"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { EMPLOYEE_STATUSES, type EmployeePositionRow, type EmployeeRow } from "@/types/database";
import type { ActionResult } from "@/server/employees";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function EmployeeForm({
  action,
  positions,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  positions: EmployeePositionRow[];
  initial?: EmployeeRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const wrapped = async (prev: ActionResult, formData: FormData) => {
    const result = await action(prev, formData);
    if (!result.error) onDone();
    return result;
  };
  const [state, formAction] = useActionState(wrapped, {} as ActionResult);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="full_name">
            ชื่อ *
          </label>
          <input id="full_name" name="full_name" required defaultValue={initial?.full_name} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="nickname">
            ชื่อเล่น
          </label>
          <input id="nickname" name="nickname" defaultValue={initial?.nickname ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="position_id">
            ตำแหน่ง
          </label>
          <select id="position_id" name="position_id" defaultValue={initial?.position_id ?? ""} className="field-input">
            <option value="">ไม่ระบุ</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="phone">
            เบอร์โทร
          </label>
          <input id="phone" name="phone" defaultValue={initial?.phone ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="start_date">
            วันที่เริ่มงาน
          </label>
          <input id="start_date" name="start_date" type="date" defaultValue={initial?.start_date ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="employment_type">
            ประเภทการจ้าง
          </label>
          <input
            id="employment_type"
            name="employment_type"
            placeholder="เช่น รายเดือน, รายวัน, พาร์ทไทม์"
            defaultValue={initial?.employment_type ?? ""}
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="wage_amount">
            เงินเดือน/ค่าแรง (บาท)
          </label>
          <input
            id="wage_amount"
            name="wage_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.wage_amount ?? ""}
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            สถานะ
          </label>
          <select id="status" name="status" defaultValue={initial?.status ?? "ทำงานอยู่"} className="field-input">
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="notes">
            หมายเหตุ
          </label>
          <textarea id="notes" name="notes" rows={2} defaultValue={initial?.notes ?? ""} className="field-input" />
        </div>
      </div>

      {state.error && <p className="field-error">{state.error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          ยกเลิก
        </button>
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มพนักงาน"} />
      </div>
    </form>
  );
}
