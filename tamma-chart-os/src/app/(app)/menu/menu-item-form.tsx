"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ACTIVE_STATUSES, type MenuCategoryRow, type MenuItemRow } from "@/types/database";
import type { RecipeRow } from "@/types/database";
import type { ActionResult } from "@/server/menu";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function MenuItemForm({
  action,
  categories,
  recipes,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  categories: MenuCategoryRow[];
  recipes: RecipeRow[];
  initial?: MenuItemRow;
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
            หมวดหมู่
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
          <label className="field-label" htmlFor="recipe_id">
            สูตร
          </label>
          <select id="recipe_id" name="recipe_id" defaultValue={initial?.recipe_id ?? ""} className="field-input">
            <option value="">ไม่ผูกสูตร</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="selling_price">
            ราคาขาย (บาท) *
          </label>
          <input
            id="selling_price"
            name="selling_price"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={initial?.selling_price ?? 0}
            className="field-input"
          />
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
        <div className="flex items-center gap-2 pt-6">
          <input
            id="is_available"
            name="is_available"
            type="checkbox"
            defaultChecked={initial?.is_available ?? true}
            className="h-4 w-4 rounded border-line"
          />
          <label htmlFor="is_available" className="text-sm text-ink">
            พร้อมขาย
          </label>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="description">
            คำอธิบาย
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มเมนู"} />
      </div>
    </form>
  );
}
