"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  ACTIVE_STATUSES,
  type IngredientCategoryRow,
  type IngredientRow,
  type SupplierRow,
} from "@/types/database";
import type { ActionResult } from "@/server/ingredients";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function IngredientForm({
  action,
  categories,
  suppliers,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  categories: IngredientCategoryRow[];
  suppliers: SupplierRow[];
  initial?: IngredientRow;
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
            ชื่อวัตถุดิบ *
          </label>
          <input id="name" name="name" required defaultValue={initial?.name} className="field-input" />
        </div>

        <div>
          <label className="field-label" htmlFor="category_id">
            หมวดหมู่
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue={initial?.category_id ?? ""}
            className="field-input"
          >
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
          <label className="field-label" htmlFor="base_unit">
            หน่วยฐาน *
          </label>
          <input
            id="base_unit"
            name="base_unit"
            required
            placeholder="เช่น กรัม, มล."
            defaultValue={initial?.base_unit}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="purchase_unit">
            หน่วยซื้อ *
          </label>
          <input
            id="purchase_unit"
            name="purchase_unit"
            required
            placeholder="เช่น กก., ลิตร"
            defaultValue={initial?.purchase_unit}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="conversion_factor">
            1 หน่วยซื้อ = กี่หน่วยฐาน *
          </label>
          <input
            id="conversion_factor"
            name="conversion_factor"
            type="number"
            step="0.000001"
            min="0.000001"
            required
            placeholder="เช่น 1 กก. = 1000 กรัม -> 1000"
            defaultValue={initial?.conversion_factor ?? 1}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="primary_supplier_id">
            supplier หลัก
          </label>
          <select
            id="primary_supplier_id"
            name="primary_supplier_id"
            defaultValue={initial?.primary_supplier_id ?? ""}
            className="field-input"
          >
            <option value="">ไม่ระบุ</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="reorder_point">
            จุดสั่งซื้อขั้นต่ำ (หน่วยฐาน)
          </label>
          <input
            id="reorder_point"
            name="reorder_point"
            type="number"
            step="0.001"
            min="0"
            defaultValue={initial?.reorder_point ?? 0}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="minimum_stock_quantity">
            ปริมาณคงเหลือขั้นต่ำ (หน่วยฐาน)
          </label>
          <input
            id="minimum_stock_quantity"
            name="minimum_stock_quantity"
            type="number"
            step="0.001"
            min="0"
            defaultValue={initial?.minimum_stock_quantity ?? 0}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="shelf_life_days">
            อายุเก็บโดยประมาณ (วัน)
          </label>
          <input
            id="shelf_life_days"
            name="shelf_life_days"
            type="number"
            min="0"
            defaultValue={initial?.shelf_life_days ?? ""}
            className="field-input"
          />
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มวัตถุดิบ"} />
      </div>
    </form>
  );
}
