"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { IngredientForm } from "./ingredient-form";
import {
  archiveIngredient,
  createIngredient,
  updateIngredient,
} from "@/server/ingredients";
import type {
  IngredientCategoryRow,
  IngredientRow,
  SupplierRow,
} from "@/types/database";

export function IngredientsTable({
  ingredients,
  categories,
  suppliers,
}: {
  ingredients: IngredientRow[];
  categories: IngredientCategoryRow[];
  suppliers: SupplierRow[];
}) {
  const [modal, setModal] = useState<"create" | IngredientRow | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">วัตถุดิบ</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มวัตถุดิบ
        </button>
      </div>

      {ingredients.length === 0 ? (
        <EmptyState
          title="ยังไม่มีข้อมูลวัตถุดิบ"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มวัตถุดิบแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อวัตถุดิบ</th>
                <th className="py-2 pr-4 font-medium">หมวดหมู่</th>
                <th className="py-2 pr-4 font-medium">หน่วย</th>
                <th className="py-2 pr-4 font-medium">ราคาล่าสุด/หน่วยฐาน</th>
                <th className="py-2 pr-4 font-medium">supplier หลัก</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ing) => (
                <tr key={ing.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/ingredients/${ing.id}`} className="font-medium text-forest-500 hover:underline">
                      {ing.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-ink-light">
                    {ing.category_id ? categoryName.get(ing.category_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">
                    {ing.purchase_unit} / {ing.base_unit}
                  </td>
                  <td className="py-2 pr-4">
                    {ing.latest_cost_per_base_unit != null
                      ? `${ing.latest_cost_per_base_unit.toLocaleString("th-TH", { maximumFractionDigits: 4 })} บาท`
                      : "ยังไม่มีข้อมูลราคา"}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">
                    {ing.primary_supplier_id ? supplierName.get(ing.primary_supplier_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4">{ing.status}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(ing)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ปิดใช้งานวัตถุดิบ "${ing.name}"?`}
                        onConfirm={() => archiveIngredient(ing.id)}
                      >
                        ปิดใช้งาน
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
        <Modal title={modal === "create" ? "เพิ่มวัตถุดิบ" : "แก้ไขวัตถุดิบ"} onClose={() => setModal(null)}>
          <IngredientForm
            categories={categories}
            suppliers={suppliers}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createIngredient : updateIngredient.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
