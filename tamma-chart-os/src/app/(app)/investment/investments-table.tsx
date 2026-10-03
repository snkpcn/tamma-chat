"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { InvestmentForm } from "./investment-form";
import {
  archiveInvestment,
  createInvestment,
  updateInvestment,
} from "@/server/investments";
import type { InvestmentCategoryRow, InvestmentRow } from "@/types/database";

function formatBaht(amount: number) {
  return amount.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

export function InvestmentsTable({
  investments,
  categories,
}: {
  investments: InvestmentRow[];
  categories: InvestmentCategoryRow[];
}) {
  const [modal, setModal] = useState<"create" | InvestmentRow | null>(null);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">รายการลงทุน</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มรายการลงทุน
        </button>
      </div>

      {investments.length === 0 ? (
        <EmptyState
          title="ยังไม่มีรายการลงทุน"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มรายการแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อรายการ</th>
                <th className="py-2 pr-4 font-medium">หมวดหมู่</th>
                <th className="py-2 pr-4 font-medium">งบ</th>
                <th className="py-2 pr-4 font-medium">ใช้จริง</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {investments.map((inv) => (
                <tr key={inv.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 text-ink">{inv.name}</td>
                  <td className="py-2 pr-4 text-ink-light">
                    {inv.category_id ? categoryNameById.get(inv.category_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4">{formatBaht(inv.budget_amount)}</td>
                  <td
                    className={`py-2 pr-4 ${
                      inv.actual_amount > inv.budget_amount && inv.budget_amount > 0
                        ? "font-medium text-red-600"
                        : ""
                    }`}
                  >
                    {formatBaht(inv.actual_amount)}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-forest-500 hover:underline"
                        onClick={() => setModal(inv)}
                      >
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ลบรายการ "${inv.name}"?`}
                        onConfirm={() => archiveInvestment(inv.id)}
                      >
                        ลบ
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal
          title={modal === "create" ? "เพิ่มรายการลงทุน" : "แก้ไขรายการลงทุน"}
          onClose={() => setModal(null)}
        >
          <InvestmentForm
            categories={categories}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createInvestment : updateInvestment.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
