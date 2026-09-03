import {
  archiveMenuCategory,
  createMenuCategory,
  listMenuCategories,
  listMenuItems,
  renameMenuCategory,
} from "@/server/menu";
import { computeRecipeCost, listRecipes } from "@/server/recipes";
import { getSettings } from "@/server/settings";
import { foodCostPercent, grossMarginPercent } from "@/lib/calc";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleListManager } from "@/components/simple-list-manager";
import { MenuTable, type MenuItemWithCost } from "./menu-table";
import type { MenuCategoryRow, MenuItemRow, RecipeRow } from "@/types/database";

export default async function MenuPage() {
  let categories: MenuCategoryRow[] = [];
  let items: MenuItemRow[] = [];
  let recipes: RecipeRow[] = [];
  let foodCostThreshold = 35;
  let setupError: string | null = null;

  try {
    const [cats, menuItems, recipeList, settings] = await Promise.all([
      listMenuCategories(),
      listMenuItems(),
      listRecipes(),
      getSettings(),
    ]);
    categories = cats;
    items = menuItems;
    recipes = recipeList;
    foodCostThreshold = settings.food_cost_threshold_percent;
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  const itemsWithCost: MenuItemWithCost[] = await Promise.all(
    items.map(async (item) => {
      if (!item.recipe_id) {
        return { ...item, totalCost: null, foodCostPercentValue: null, marginPercentValue: null };
      }
      const breakdown = await computeRecipeCost(item.recipe_id);
      const totalCost = breakdown?.totalCost ?? null;
      return {
        ...item,
        totalCost,
        foodCostPercentValue:
          totalCost !== null ? foodCostPercent(totalCost, item.selling_price) : null,
        marginPercentValue:
          totalCost !== null ? grossMarginPercent(totalCost, item.selling_price) : null,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">เมนูอาหาร</h1>
        <p className="text-sm text-ink-light">ผูกเมนูกับสูตรอาหารเพื่อคำนวณ Food Cost และกำไรขั้นต้นอัตโนมัติ</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <MenuTable
          items={itemsWithCost}
          categories={categories}
          recipes={recipes}
          foodCostThreshold={foodCostThreshold}
        />
        <SimpleListManager
          title="หมวดหมู่เมนู"
          items={categories}
          createAction={createMenuCategory}
          onRename={renameMenuCategory}
          onArchive={archiveMenuCategory}
          emptyLabel="ยังไม่มีหมวดหมู่"
          placeholder="ชื่อหมวดหมู่ใหม่"
        />
      </div>
    </div>
  );
}
