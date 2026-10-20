import {
  archiveIngredientCategory,
  createIngredientCategory,
  listIngredientCategories,
  listIngredients,
  renameIngredientCategory,
} from "@/server/ingredients";
import { listSuppliers } from "@/server/suppliers";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleListManager } from "@/components/simple-list-manager";
import { IngredientsTable } from "./ingredients-table";
import type {
  IngredientCategoryRow,
  IngredientRow,
  SupplierRow,
} from "@/types/database";

export default async function IngredientsPage() {
  let categories: IngredientCategoryRow[] = [];
  let ingredients: IngredientRow[] = [];
  let suppliers: SupplierRow[] = [];
  let setupError: string | null = null;

  try {
    [categories, ingredients, suppliers] = await Promise.all([
      listIngredientCategories(),
      listIngredients(),
      listSuppliers(),
    ]);
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">ต้นทุนวัตถุดิบ</h1>
        <p className="text-sm text-ink-light">
          จัดการวัตถุดิบและติดตามต้นทุนต่อหน่วยฐานสำหรับใช้คำนวณต้นทุนสูตรอาหาร
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <IngredientsTable ingredients={ingredients} categories={categories} suppliers={suppliers} />
        <SimpleListManager
          title="หมวดหมู่วัตถุดิบ"
          items={categories}
          createAction={createIngredientCategory}
          onRename={renameIngredientCategory}
          onArchive={archiveIngredientCategory}
          emptyLabel="ยังไม่มีหมวดหมู่"
          placeholder="ชื่อหมวดหมู่ใหม่"
        />
      </div>
    </div>
  );
}
