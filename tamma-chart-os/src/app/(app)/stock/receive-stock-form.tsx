"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { receiveStock, type ActionResult } from "@/server/stock";
import type { IngredientRow, SupplierRow } from "@/types/database";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : "บันทึกรับของ"}
    </button>
  );
}

export function ReceiveStockForm({
  ingredients,
  suppliers,
}: {
  ingredients: IngredientRow[];
  suppliers: SupplierRow[];
}) {
  const [state, formAction] = useActionState(receiveStock, {} as ActionResult);
  const today = new Date().toISOString().slice(0, 10);

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
              {ing.name} ({ing.purchase_unit})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="supplier_id">
          ผู้ขาย
        </label>
        <select id="supplier_id" name="supplier_id" className="field-input" defaultValue="">
          <option value="">ไม่ระบุ</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="received_date">
          วันที่รับ
        </label>
        <input id="received_date" name="received_date" type="date" defaultValue={today} max={today} className="field-input" />
      </div>
      <div>
        <label className="field-label" htmlFor="purchase_quantity">
          จำนวน (หน่วยซื้อ)
        </label>
        <input id="purchase_quantity" name="purchase_quantity" type="number" step="0.001" min="0.001" className="field-input" />
      </div>
      <div>
        <label className="field-label" htmlFor="price">
          ราคารวม (บาท)
        </label>
        <input id="price" name="price" type="number" step="0.01" min="0" className="field-input" />
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      <div className="lg:col-span-3">
        <label className="field-label" htmlFor="reference">
          เลขเอกสาร
        </label>
        <input id="reference" name="reference" className="field-input" />
      </div>
      <div className="lg:col-span-3">
        <label className="field-label" htmlFor="notes">
          หมายเหตุ
        </label>
        <input id="notes" name="notes" className="field-input" />
      </div>
      {state.error && <p className="field-error sm:col-span-2 lg:col-span-6">{state.error}</p>}
    </form>
  );
}
