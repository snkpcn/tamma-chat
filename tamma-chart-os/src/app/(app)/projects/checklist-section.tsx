"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { CHECKLIST_STATUSES, type ChecklistStatus, type OpeningChecklistCategoryRow, type OpeningChecklistItemRow } from "@/types/database";
import {
  createChecklistItem,
  deleteChecklistItem,
  updateChecklistItemStatus,
  type ActionResult,
} from "@/server/opening-checklist";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังเพิ่ม..." : "+ เพิ่มรายการ"}
    </button>
  );
}

export function ChecklistSection({
  items,
  categories,
}: {
  items: OpeningChecklistItemRow[];
  categories: OpeningChecklistCategoryRow[];
}) {
  const [state, formAction] = useActionState(createChecklistItem, {} as ActionResult);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState title="ยังไม่มีเช็กลิสต์ก่อนเปิดร้าน" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">รายการ</th>
                <th className="py-2 pr-4 font-medium">หมวด</th>
                <th className="py-2 pr-4 font-medium">กำหนดวัน</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 text-ink">{item.name}</td>
                  <td className="py-2 pr-4 text-ink-light">
                    {item.category_id ? categoryName.get(item.category_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">{item.due_date ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <select
                      className="field-input w-32"
                      value={item.status}
                      onChange={(e) =>
                        updateChecklistItemStatus(item.id, e.target.value as ChecklistStatus)
                      }
                    >
                      {CHECKLIST_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <ConfirmButton
                      className="text-red-600 hover:underline"
                      confirmMessage={`ลบรายการ "${item.name}"?`}
                      onConfirm={() => deleteChecklistItem(item.id)}
                    >
                      ลบ
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <div>
          <label className="field-label" htmlFor="name">
            ชื่อรายการ
          </label>
          <input id="name" name="name" className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="category_id">
            หมวด
          </label>
          <select id="category_id" name="category_id" className="field-input" defaultValue="">
            <option value="">ไม่ระบุ</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="due_date">
            กำหนดวัน
          </label>
          <input id="due_date" name="due_date" type="date" className="field-input" />
        </div>
        <AddButton />
      </form>
      {state.error && <p className="field-error">{state.error}</p>}
    </div>
  );
}
