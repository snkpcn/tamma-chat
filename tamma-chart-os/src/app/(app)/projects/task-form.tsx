"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TASK_PRIORITIES, WORK_STATUSES, type ProjectRow, type TaskRow } from "@/types/database";
import type { ActionResult } from "@/server/projects";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function TaskForm({
  action,
  projects,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  projects: ProjectRow[];
  initial?: TaskRow;
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
            ชื่องาน *
          </label>
          <input id="name" name="name" required defaultValue={initial?.name} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="project_id">
            โครงการ
          </label>
          <select id="project_id" name="project_id" defaultValue={initial?.project_id ?? ""} className="field-input">
            <option value="">ไม่ระบุ</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="due_date">
            กำหนดวัน
          </label>
          <input id="due_date" name="due_date" type="date" defaultValue={initial?.due_date ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="priority">
            ระดับความสำคัญ
          </label>
          <select id="priority" name="priority" defaultValue={initial?.priority ?? "ปกติ"} className="field-input">
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มงาน"} />
      </div>
    </form>
  );
}
