"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recordWaste, type ActionResult } from "@/server/stock";
import type { IngredientRow, WasteReasonRow } from "@/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : "บันทึกของเสีย"}
    </button>
  );
}

export function WasteForm({
  ingredients,
  reasons,
}: {
  ingredients: IngredientRow[];
  reasons: WasteReasonRow[];
}) {
  const [state, formAction] = useActionState(recordWaste, {} as ActionResult);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="lg:col-span-2">
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
        <label className="field-label" htmlFor="quantity_base_unit">
          จำนวน (หน่วยฐาน)
        </label>
        <input id="quantity_base_unit" name="quantity_base_unit" type="number" step="0.001" min="0.001" className="field-input" />
      </div>
      <div>
        <label className="field-label" htmlFor="reason_id">
          สาเหตุ
        </label>
        <select id="reason_id" name="reason_id" className="field-input" defaultValue="">
          <option value="">ไม่ระบุ</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      <div className="sm:col-span-2 lg:col-span-5">
        <label className="field-label" htmlFor="notes">
          หมายเหตุ
        </label>
        <input id="notes" name="notes" className="field-input" />
      </div>
      {state.error && <p className="field-error sm:col-span-2 lg:col-span-5">{state.error}</p>}
    </form>
  );
}
