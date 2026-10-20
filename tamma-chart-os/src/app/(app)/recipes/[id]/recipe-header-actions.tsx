"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { RecipeForm } from "../recipe-form";
import { updateRecipe } from "@/server/recipes";
import type { RecipeCategoryRow, RecipeRow } from "@/types/database";

export function RecipeHeaderActions({
  recipe,
  categories,
}: {
  recipe: RecipeRow;
  categories: RecipeCategoryRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        แก้ไขข้อมูลสูตร
      </button>
      {open && (
        <Modal title="แก้ไขสูตรอาหาร" onClose={() => setOpen(false)}>
          <RecipeForm
            categories={categories}
            initial={recipe}
            action={updateRecipe.bind(null, recipe.id)}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}
