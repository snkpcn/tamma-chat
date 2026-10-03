"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { WORK_STATUSES, type ProjectRow } from "@/types/database";
import type { ActionResult } from "@/server/projects";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function ProjectForm({
  action,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: ProjectRow;
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
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="name">
            ชื่อโครงการ *
          </label>
          <input id="name" name="name" required defaultValue={initial?.name} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="category">
            หมวด
          </label>
          <input id="category" name="category" defaultValue={initial?.category ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            สถานะ
          </label>
          <select id="status" name="status" defaultValue={initial?.status ?? "ยังไม่เริ่ม"} className="field-input">
            {WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="start_date">
            วันเริ่ม
          </label>
          <input id="start_date" name="start_date" type="date" defaultValue={initial?.start_date ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="due_date">
            กำหนดเสร็จ
          </label>
          <input id="due_date" name="due_date" type="date" defaultValue={initial?.due_date ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="budget">
            งบ (บาท)
          </label>
          <input id="budget" name="budget" type="number" step="0.01" min="0" defaultValue={initial?.budget ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="progress_percent">
            ความคืบหน้า (%)
          </label>
          <input
            id="progress_percent"
            name="progress_percent"
            type="number"
            min="0"
            max="100"
            defaultValue={initial?.progress_percent ?? 0}
            className="field-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="description">
            รายละเอียด
          </label>
          <textarea id="description" name="description" rows={2} defaultValue={initial?.description ?? ""} className="field-input" />
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มโครงการ"} />
      </div>
    </form>
  );
}
