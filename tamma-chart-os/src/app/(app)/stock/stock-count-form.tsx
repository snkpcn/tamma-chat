"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recordStockCount, type ActionResult } from "@/server/stock";
import type { IngredientRow } from "@/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : "บันทึกผลนับสต๊อก"}
    </button>
  );
}

export function StockCountForm({ ingredients }: { ingredients: IngredientRow[] }) {
  const [state, formAction] = useActionState(recordStockCount, {} as ActionResult);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="field-label" htmlFor="ingredient_id">
          วัตถุดิบ
        </label>
        <select id="ingredient_id" name="ingredient_id" className="field-input" defaultValue="">
          <option value="" disabled>
            เลือกวัตถุดิบ
          </option>
          {ingredients.map((ing) => (
            <option key={ing.id} value={ing.id}>
              {ing.name} ({ing.base_unit})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="counted_quantity">
          จำนวนที่นับได้ (หน่วยฐาน)
        </label>
        <input id="counted_quantity" name="counted_quantity" type="number" step="0.001" min="0" className="field-input" />
      </div>
      <div className="sm:col-span-2 lg:col-span-1">
        <label className="field-label" htmlFor="notes">
          หมายเหตุ
        </label>
        <input id="notes" name="notes" className="field-input" />
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      {state.error && <p className="field-error sm:col-span-2 lg:col-span-4">{state.error}</p>}
    </form>
  );
}
