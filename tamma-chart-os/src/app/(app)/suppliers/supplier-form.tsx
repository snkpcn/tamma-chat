"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ACTIVE_STATUSES, type SupplierRow } from "@/types/database";
import type { ActionResult } from "@/server/suppliers";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </button>
  );
}

export function SupplierForm({
  action,
  initial,
  onDone,
  onCancel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: SupplierRow;
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
            ชื่อผู้ขาย *
          </label>
          <input id="name" name="name" required defaultValue={initial?.name} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="supplier_type">
            ประเภท
          </label>
          <input id="supplier_type" name="supplier_type" defaultValue={initial?.supplier_type ?? ""} className="field-input" />
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
          <label className="field-label" htmlFor="contact_name">
            ผู้ติดต่อ
          </label>
          <input id="contact_name" name="contact_name" defaultValue={initial?.contact_name ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">
            เบอร์โทร
          </label>
          <input id="phone" name="phone" defaultValue={initial?.phone ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="line_id">
            LINE / ช่องทางติดต่อ
          </label>
          <input id="line_id" name="line_id" defaultValue={initial?.line_id ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="tax_id">
            เลขผู้เสียภาษี
          </label>
          <input id="tax_id" name="tax_id" defaultValue={initial?.tax_id ?? ""} className="field-input" />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="address">
            ที่อยู่
          </label>
          <input id="address" name="address" defaultValue={initial?.address ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="payment_terms">
            เงื่อนไขชำระเงิน
          </label>
          <input id="payment_terms" name="payment_terms" defaultValue={initial?.payment_terms ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="delivery_days">
            วันส่งของ
          </label>
          <input id="delivery_days" name="delivery_days" defaultValue={initial?.delivery_days ?? ""} className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="minimum_order">
            ขั้นต่ำในการสั่ง
          </label>
          <input id="minimum_order" name="minimum_order" defaultValue={initial?.minimum_order ?? ""} className="field-input" />
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
        <SubmitButton label={initial ? "บันทึกการแก้ไข" : "เพิ่มผู้ขาย"} />
      </div>
    </form>
  );
}
