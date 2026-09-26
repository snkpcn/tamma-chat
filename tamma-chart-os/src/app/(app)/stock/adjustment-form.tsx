"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordStockMovement, type ActionResult } from "@/server/stock";
import type { IngredientRow } from "@/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : "บันทึกการเคลื่อนไหว"}
    </button>
  );
}

export function AdjustmentForm({ ingredients }: { ingredients: IngredientRow[] }) {
  const [state, formAction] = useActionState(recordStockMovement, {} as ActionResult);
  const [movementType, setMovementType] = useState("เบิกใช้");

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
        <label className="field-label" htmlFor="movement_type">
          ประเภท
        </label>
        <select
          id="movement_type"
          name="movement_type"
          className="field-input"
          value={movementType}
          onChange={(e) => setMovementType(e.target.value)}
        >
          <option value="เบิกใช้">เบิกใช้</option>
          <option value="ปรับยอด">ปรับยอด</option>
          <option value="โอน">โอน</option>
          <option value="คืนผู้ขาย">คืนผู้ขาย</option>
        </select>
      </div>
      {movementType === "ปรับยอด" && (
        <div>
          <label className="field-label" htmlFor="adjustment_direction">
            ทิศทาง
          </label>
          <select id="adjustment_direction" name="adjustment_direction" className="field-input" defaultValue="1">
            <option value="1">เพิ่ม (+)</option>
            <option value="-1">ลด (-)</option>
          </select>
        </div>
      )}
      <div>
        <label className="field-label" htmlFor="quantity_base_unit">
          จำนวน (หน่วยฐาน)
        </label>
        <input id="quantity_base_unit" name="quantity_base_unit" type="number" step="0.001" min="0.001" className="field-input" />
      </div>
      <div>
        <label className="field-label" htmlFor="reason">
          เหตุผล
        </label>
        <input id="reason" name="reason" className="field-input" />
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      <div className="lg:col-span-6">
        <label className="field-label" htmlFor="notes">
          หมายเหตุ
        </label>
        <input id="notes" name="notes" className="field-input" />
      </div>
      {state.error && <p className="field-error sm:col-span-2 lg:col-span-6">{state.error}</p>}
    </form>
  );
}
