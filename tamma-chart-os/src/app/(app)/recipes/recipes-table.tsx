"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { RecipeForm } from "./recipe-form";
import { archiveRecipe, createRecipe, updateRecipe } from "@/server/recipes";
import type { RecipeCategoryRow, RecipeRow } from "@/types/database";

export function RecipesTable({
  recipes,
  categories,
}: {
  recipes: RecipeRow[];
  categories: RecipeCategoryRow[];
}) {
  const [modal, setModal] = useState<"create" | RecipeRow | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">สูตรอาหาร</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มสูตรอาหาร
        </button>
      </div>

      {recipes.length === 0 ? (
        <EmptyState
          title="ยังไม่มีสูตรอาหาร"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มสูตรแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อเมนู</th>
                <th className="py-2 pr-4 font-medium">หมวด</th>
                <th className="py-2 pr-4 font-medium">จำนวนเสิร์ฟ</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/recipes/${r.id}`} className="font-medium text-forest-500 hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-ink-light">
                    {r.category_id ? categoryName.get(r.category_id) ?? "—" : "—"}
                  </td>
                  <td className="py-2 pr-4 text-ink-light">{r.standard_serving_size}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(r)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ปิดใช้งานสูตร "${r.name}"?`}
                        onConfirm={() => archiveRecipe(r.id)}
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
        <Modal title={modal === "create" ? "เพิ่มสูตรอาหาร" : "แก้ไขสูตรอาหาร"} onClose={() => setModal(null)}>
          <RecipeForm
            categories={categories}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createRecipe : updateRecipe.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
