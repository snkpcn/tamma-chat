"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recordIngredientPrice, type ActionResult } from "@/server/ingredient-prices";
import type { IngredientRow, SupplierRow } from "@/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : "บันทึกราคา"}
    </button>
  );
}

export function PriceEntryForm({
  ingredient,
  suppliers,
}: {
  ingredient: IngredientRow;
  suppliers: SupplierRow[];
}) {
  const action = recordIngredientPrice.bind(null, ingredient.id);
  const [state, formAction] = useActionState(action, {} as ActionResult);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div>
        <label className="field-label" htmlFor="purchase_date">
          วันที่
        </label>
        <input
          id="purchase_date"
          name="purchase_date"
          type="date"
          defaultValue={today}
          max={today}
          className="field-input"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="supplier_id">
          ผู้ขาย
        </label>
        <select id="supplier_id" name="supplier_id" defaultValue="" className="field-input">
          <option value="">ไม่ระบุ</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="purchase_unit">
          หน่วยซื้อ
        </label>
        <input
          id="purchase_unit"
          name="purchase_unit"
          defaultValue={ingredient.purchase_unit}
          className="field-input"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="purchase_quantity">
          ปริมาณที่ซื้อ
        </label>
        <input
          id="purchase_quantity"
          name="purchase_quantity"
          type="number"
          step="0.001"
          min="0.001"
          defaultValue={1}
          className="field-input"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="price">
          ราคารวม (บาท)
        </label>
        <input
          id="price"
          name="price"
          type="number"
          step="0.01"
          min="0"
          required
          className="field-input"
        />
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      <div className="sm:col-span-2 lg:col-span-6">
        <label className="field-label" htmlFor="notes">
          หมายเหตุ
        </label>
        <input id="notes" name="notes" className="field-input" />
      </div>
      {state.error && (
        <p className="field-error sm:col-span-2 lg:col-span-6">{state.error}</p>
      )}
    </form>
  );
}
