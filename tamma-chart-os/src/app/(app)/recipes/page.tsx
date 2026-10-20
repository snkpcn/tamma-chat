import {
  archiveRecipeCategory,
  createRecipeCategory,
  listRecipeCategories,
  listRecipes,
  renameRecipeCategory,
} from "@/server/recipes";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleListManager } from "@/components/simple-list-manager";
import { RecipesTable } from "./recipes-table";
import type { RecipeCategoryRow, RecipeRow } from "@/types/database";

export default async function RecipesPage() {
  let categories: RecipeCategoryRow[] = [];
  let recipes: RecipeRow[] = [];
  let setupError: string | null = null;

  try {
    [categories, recipes] = await Promise.all([listRecipeCategories(), listRecipes()]);
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">สูตรอาหาร</h1>
        <p className="text-sm text-ink-light">สร้างสูตรอาหารและคำนวณต้นทุนต่อจานจากราคาวัตถุดิบจริง</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <RecipesTable recipes={recipes} categories={categories} />
        <SimpleListManager
          title="หมวดเมนู (สูตร)"
          items={categories}
          createAction={createRecipeCategory}
          onRename={renameRecipeCategory}
          onArchive={archiveRecipeCategory}
          emptyLabel="ยังไม่มีหมวดเมนู"
          placeholder="ชื่อหมวดใหม่"
        />
      </div>
    </div>
  );
}
