import Link from "next/link";
import { notFound } from "next/navigation";
import { computeRecipeCost, getRecipe, listRecipeCategories } from "@/server/recipes";
import { listIngredients } from "@/server/ingredients";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/badge";
import { IngredientLineEditor } from "./ingredient-line-editor";
import { RecipeHeaderActions } from "./recipe-header-actions";

function baht(n: number) {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) notFound();

  const [breakdown, categories, ingredients] = await Promise.all([
    computeRecipeCost(id),
    listRecipeCategories(),
    listIngredients(),
  ]);

  if (!breakdown) notFound();

  const costPerServing = breakdown.totalCost / recipe.standard_serving_size;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/recipes" className="text-sm text-forest-500 hover:underline">
            ← สูตรอาหาร
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-ink">{recipe.name}</h1>
          <p className="text-sm text-ink-light">
            จำนวนเสิร์ฟมาตรฐาน {recipe.standard_serving_size} · <StatusBadge status={recipe.status} />
          </p>
        </div>
        <RecipeHeaderActions recipe={recipe} categories={categories} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ต้นทุนวัตถุดิบรวม" value={baht(breakdown.ingredientCost)} />
        <StatCard label="ต้นทุนบรรจุภัณฑ์" value={baht(breakdown.packagingCost)} />
        <StatCard label="ต้นทุนรวมต่อสูตร" value={baht(breakdown.totalCost)} />
        <StatCard label="ต้นทุนต่อจาน" value={baht(costPerServing)} />
      </div>

      <section className="card p-5">
        <h2 className="mb-4 text-base font-semibold text-ink">วัตถุดิบในสูตร</h2>
        <IngredientLineEditor recipeId={id} breakdown={breakdown} ingredients={ingredients} />
      </section>

      {(recipe.description || recipe.method || recipe.notes) && (
        <section className="card space-y-3 p-5">
          {recipe.description && (
            <div>
              <h3 className="text-sm font-medium text-ink">คำอธิบาย</h3>
              <p className="text-sm text-ink-light">{recipe.description}</p>
            </div>
          )}
          {recipe.method && (
            <div>
              <h3 className="text-sm font-medium text-ink">ขั้นตอนการทำ</h3>
              <p className="whitespace-pre-line text-sm text-ink-light">{recipe.method}</p>
            </div>
          )}
          {recipe.notes && (
            <div>
              <h3 className="text-sm font-medium text-ink">หมายเหตุ</h3>
              <p className="text-sm text-ink-light">{recipe.notes}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
