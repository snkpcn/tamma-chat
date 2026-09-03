"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { MenuItemForm } from "./menu-item-form";
import { archiveMenuItem, createMenuItem, updateMenuItem } from "@/server/menu";
import type { MenuCategoryRow, MenuItemRow, RecipeRow } from "@/types/database";

export type MenuItemWithCost = MenuItemRow & {
  totalCost: number | null;
  foodCostPercentValue: number | null;
  marginPercentValue: number | null;
};

function baht(n: number) {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export function MenuTable({
  items,
  categories,
  recipes,
  foodCostThreshold,
}: {
  items: MenuItemWithCost[];
  categories: MenuCategoryRow[];
  recipes: RecipeRow[];
  foodCostThreshold: number;
}) {
  const [modal, setModal] = useState<"create" | MenuItemRow | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">เมนูอาหาร</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มเมนู
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="ยังไม่มีเมนู"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มเมนูแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อเมนู</th>
                <th className="py-2 pr-4 font-medium">หมวดหมู่</th>
                <th className="py-2 pr-4 font-medium">ราคาขาย</th>
                <th className="py-2 pr-4 font-medium">ต้นทุน</th>
                <th className="py-2 pr-4 font-medium">Food Cost %</th>
                <th className="py-2 pr-4 font-medium">Gross Margin %</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const overThreshold =
                  item.foodCostPercentValue !== null &&
                  item.foodCostPercentValue > foodCostThreshold;
                return (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{item.name}</td>
                    <td className="py-2 pr-4 text-ink-light">
                      {item.category_id ? categoryName.get(item.category_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2 pr-4">{baht(item.selling_price)}</td>
                    <td className="py-2 pr-4">{item.totalCost !== null ? baht(item.totalCost) : "ไม่มีสูตร"}</td>
                    <td className={`py-2 pr-4 ${overThreshold ? "font-medium text-red-600" : ""}`}>
                      {item.foodCostPercentValue !== null ? `${item.foodCostPercentValue.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {item.marginPercentValue !== null ? `${item.marginPercentValue.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-3">
                        <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(item)}>
                          แก้ไข
                        </button>
                        <ConfirmButton
                          className="text-red-600 hover:underline"
                          confirmMessage={`ปิดใช้งานเมนู "${item.name}"?`}
                          onConfirm={() => archiveMenuItem(item.id)}
                        >
                          ปิดใช้งาน
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === "create" ? "เพิ่มเมนู" : "แก้ไขเมนู"} onClose={() => setModal(null)}>
          <MenuItemForm
            categories={categories}
            recipes={recipes}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createMenuItem : updateMenuItem.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
