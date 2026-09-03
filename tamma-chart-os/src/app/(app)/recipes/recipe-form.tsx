"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ACTIVE_STATUSES, type RecipeCategoryRow, type RecipeRow } from "@/types/database";
import type { ActionResult } from "@/server/recipes";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function RecipeForm({
  action,
  categories,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  categories: RecipeCategoryRow[];
  initial?: RecipeRow;
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
            ชื่อเมนู *
          </label>
          <input id="name" name="name" required defaultValue={initial?.name} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="category_id">
            หมวดเมนู
          </label>
          <select id="category_id" name="category_id" defaultValue={initial?.category_id ?? ""} className="field-input">
            <option value="">ไม่ระบุ</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            สถานะ
          </label>
          <select id="status" name="status" defaultValue={initial?.status ?? "ใช้งาน"} className="field-input">
            {ACTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="standard_serving_size">
            จำนวนเสิร์ฟมาตรฐาน
          </label>
          <input
            id="standard_serving_size"
            name="standard_serving_size"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={initial?.standard_serving_size ?? 1}
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="packaging_cost">
            ต้นทุนบรรจุภัณฑ์ (บาท)
          </label>
          <input
            id="packaging_cost"
            name="packaging_cost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.packaging_cost ?? 0}
            className="field-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="description">
            คำอธิบาย
          </label>
          <textarea id="description" name="description" rows={2} defaultValue={initial?.description ?? ""} className="field-input" />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="method">
            ขั้นตอนการทำ
          </label>
          <textarea id="method" name="method" rows={4} defaultValue={initial?.method ?? ""} className="field-input" />
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มสูตรอาหาร"} />
      </div>
    </form>
  );
}
