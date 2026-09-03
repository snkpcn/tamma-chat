"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  INVESTMENT_STATUSES,
  type InvestmentCategoryRow,
  type InvestmentRow,
} from "@/types/database";
import type { ActionResult } from "@/server/investments";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function InvestmentForm({
  action,
  categories,
  initial,
  onDone,
  onCancel,
}: {
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  categories: InvestmentCategoryRow[];
  initial?: InvestmentRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const wrappedAction = async (prev: ActionResult, formData: FormData) => {
    const result = await action(prev, formData);
    if (!result.error) onDone();
    return result;
  };
  const [state, formAction] = useActionState(wrappedAction, {} as ActionResult);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="name">
            ชื่อรายการ *
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={initial?.name}
            className="field-input"
          />
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
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "วางแผน"}
            className="field-input"
          >
            {INVESTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="vendor_name">
            ผู้ขาย / ผู้รับเหมา
          </label>
          <input
            id="vendor_name"
            name="vendor_name"
            defaultValue={initial?.vendor_name ?? ""}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="payment_method">
            วิธีชำระเงิน
          </label>
          <input
            id="payment_method"
            name="payment_method"
            defaultValue={initial?.payment_method ?? ""}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="budget_amount">
            งบประมาณ (บาท)
          </label>
          <input
            id="budget_amount"
            name="budget_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.budget_amount ?? 0}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="actual_amount">
            ราคาจริง (บาท)
          </label>
          <input
            id="actual_amount"
            name="actual_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.actual_amount ?? 0}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="quantity">
            จำนวน
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.quantity ?? 1}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="unit">
            หน่วย
          </label>
          <input id="unit" name="unit" defaultValue={initial?.unit ?? ""} className="field-input" />
        </div>

        <div>
          <label className="field-label" htmlFor="order_date">
            วันที่สั่งซื้อ
          </label>
          <input
            id="order_date"
            name="order_date"
            type="date"
            defaultValue={initial?.order_date ?? ""}
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="paid_date">
            วันที่ชำระ
          </label>
          <input
            id="paid_date"
            name="paid_date"
            type="date"
            defaultValue={initial?.paid_date ?? ""}
            className="field-input"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="description">
            รายละเอียด
          </label>
          <textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={initial?.description ?? ""}
            className="field-input"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="notes">
            หมายเหตุ
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={initial?.notes ?? ""}
            className="field-input"
          />
        </div>
      </div>

      {state.error && <p className="field-error">{state.error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          ยกเลิก
        </button>
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มรายการ"} />
      </div>
    </form>
  );
}
