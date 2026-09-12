"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  ACTIVE_STATUSES,
  type ActiveStatus,
  type RecipeCategoryRow,
  type RecipeIngredientRow,
  type RecipeRow,
} from "@/types/database";

export type ActionResult = { error?: string };

const RECIPES_PATH = "/recipes";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listRecipeCategories(): Promise<RecipeCategoryRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipe_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createRecipeCategory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_categories")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีหมวดหมู่นี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }
  revalidatePath(RECIPES_PATH);
  return {};
}

export async function renameRecipeCategory(
  id: string,
  name: string,
): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อหมวดหมู่" };
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(RECIPES_PATH);
  return {};
}

export async function archiveRecipeCategory(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบหมวดหมู่ไม่สำเร็จ (อาจมีสูตรอาหารใช้งานอยู่)" };
  revalidatePath(RECIPES_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export async function listRecipes(): Promise<RecipeRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRecipe(id: string): Promise<RecipeRow | null> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

function parseRecipeForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const servingRaw = String(formData.get("standard_serving_size") ?? "1");
  const packagingRaw = String(formData.get("packaging_cost") ?? "0");
  const status = String(formData.get("status") ?? "ใช้งาน") as ActiveStatus;

  const standard_serving_size = Number(servingRaw);
  const packaging_cost = Number(packagingRaw);

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อเมนู");
  if (Number.isNaN(standard_serving_size) || standard_serving_size <= 0)
    errors.push("จำนวนเสิร์ฟต้องมากกว่า 0");
  if (Number.isNaN(packaging_cost) || packaging_cost < 0)
    errors.push("ต้นทุนบรรจุภัณฑ์ต้องไม่ติดลบ");
  if (!ACTIVE_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      category_id: String(formData.get("category_id") ?? "") || null,
      description: String(formData.get("description") ?? "").trim() || null,
      standard_serving_size,
      method: String(formData.get("method") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      packaging_cost,
      status,
    },
  };
}

export async function createRecipe(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseRecipeForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipes")
    .insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(RECIPES_PATH);
  return {};
}

export async function updateRecipe(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseRecipeForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipes")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(RECIPES_PATH);
  revalidatePath(`/recipes/${id}`);
  return {};
}

export async function archiveRecipe(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipes")
    .update({ status: "ไม่ใช้งาน" satisfies ActiveStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ปิดใช้งานสูตรไม่สำเร็จ" };
  revalidatePath(RECIPES_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Recipe ingredient lines
// ---------------------------------------------------------------------------

export async function listRecipeIngredients(
  recipeId: string,
): Promise<RecipeIngredientRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipe_ingredients")
    .select("*")
    .eq("recipe_id", recipeId)
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addRecipeIngredient(
  recipeId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ingredientId = String(formData.get("ingredient_id") ?? "");
  const unit = String(formData.get("unit") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? "0");

  const errors: string[] = [];
  if (!ingredientId) errors.push("กรุณาเลือกวัตถุดิบ");
  if (!unit) errors.push("กรุณาระบุหน่วย");
  if (Number.isNaN(quantity) || quantity <= 0) errors.push("ปริมาณต้องมากกว่า 0");
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { count } = await supabase
    .from("recipe_ingredients")
    .select("id", { count: "exact", head: true })
    .eq("recipe_id", recipeId);

  const { error } = await supabase.from("recipe_ingredients").insert({
    restaurant_id: restaurantId,
    recipe_id: recipeId,
    ingredient_id: ingredientId,
    quantity,
    unit,
    sort_order: count ?? 0,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  if (error) return { error: "เพิ่มวัตถุดิบไม่สำเร็จ" };
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}

export async function updateRecipeIngredientQuantity(
  id: string,
  recipeId: string,
  quantity: number,
  unit: string,
): Promise<ActionResult> {
  if (Number.isNaN(quantity) || quantity <= 0) {
    return { error: "ปริมาณต้องมากกว่า 0" };
  }
  if (!unit.trim()) return { error: "กรุณาระบุหน่วย" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_ingredients")
    .update({ quantity, unit: unit.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}

export async function removeRecipeIngredient(
  id: string,
  recipeId: string,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("recipe_ingredients")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบวัตถุดิบไม่สำเร็จ" };
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}

export async function reorderRecipeIngredient(
  id: string,
  recipeId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const lines = await listRecipeIngredients(recipeId);
  const index = lines.findIndex((l) => l.id === id);
  if (index === -1) return { error: "ไม่พบรายการ" };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= lines.length) return {};

  const a = lines[index]!;
  const b = lines[swapIndex]!;

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase
      .from("recipe_ingredients")
      .update({ sort_order: b.sort_order })
      .eq("id", a.id)
      .eq("restaurant_id", restaurantId),
    supabase
      .from("recipe_ingredients")
      .update({ sort_order: a.sort_order })
      .eq("id", b.id)
      .eq("restaurant_id", restaurantId),
  ]);

  if (e1 || e2) return { error: "จัดลำดับไม่สำเร็จ" };
  revalidatePath(`/recipes/${recipeId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

export type RecipeCostBreakdown = {
  recipeId: string;
  lines: Array<{
    id: string;
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    costPerBaseUnit: number | null;
    lineCost: number;
    missingPrice: boolean;
  }>;
  ingredientCost: number;
  packagingCost: number;
  totalCost: number;
};

export async function computeRecipeCost(
  recipeId: string,
): Promise<RecipeCostBreakdown | null> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .select("*")
    .eq("id", recipeId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (recipeError) throw new Error(recipeError.message);
  if (!recipe) return null;

  const { data: lines, error: linesError } = await supabase
    .from("recipe_ingredients")
    .select("*")
    .eq("recipe_id", recipeId)
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true });

  if (linesError) throw new Error(linesError.message);

  const ingredientIds = Array.from(
    new Set((lines ?? []).map((l) => l.ingredient_id)),
  );

  const ingredientById = new Map<
    string,
    { name: string; latest_cost_per_base_unit: number | null }
  >();

  if (ingredientIds.length) {
    const { data: ingredientRows, error: ingredientsError } = await supabase
      .from("ingredients")
      .select("id, name, latest_cost_per_base_unit")
      .in("id", ingredientIds);

    if (ingredientsError) throw new Error(ingredientsError.message);
    for (const row of ingredientRows ?? []) {
      ingredientById.set(row.id, {
        name: row.name,
        latest_cost_per_base_unit: row.latest_cost_per_base_unit,
      });
    }
  }

  const breakdownLines = (lines ?? []).map((line) => {
    const ingredient = ingredientById.get(line.ingredient_id) ?? null;
    const costPerBaseUnit = ingredient?.latest_cost_per_base_unit ?? null;
    const lineCost = costPerBaseUnit !== null ? line.quantity * costPerBaseUnit : 0;
    return {
      id: line.id,
      ingredientId: line.ingredient_id,
      ingredientName: ingredient?.name ?? "ไม่ทราบชื่อ",
      quantity: line.quantity,
      unit: line.unit,
      costPerBaseUnit,
      lineCost,
      missingPrice: costPerBaseUnit === null,
    };
  });

  const ingredientCost = breakdownLines.reduce((sum, l) => sum + l.lineCost, 0);

  return {
    recipeId,
    lines: breakdownLines,
    ingredientCost,
    packagingCost: recipe.packaging_cost,
    totalCost: ingredientCost + recipe.packaging_cost,
  };
}


/**
 * Called after an ingredient's price changes. Recomputes cost for every
 * recipe using that ingredient and appends a recipe_cost_snapshots row —
 * snapshots are append-only, so old costs stay visible in history.
 */
export async function recalculateRecipesUsingIngredient(
  ingredientId: string,
  reason: string,
): Promise<void> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: affected, error } = await supabase
    .from("recipe_ingredients")
    .select("recipe_id")
    .eq("ingredient_id", ingredientId)
    .eq("restaurant_id", restaurantId);

  if (error || !affected?.length) return;

  const uniqueRecipeIds = Array.from(new Set(affected.map((r) => r.recipe_id)));

  for (const recipeId of uniqueRecipeIds) {
    const breakdown = await computeRecipeCost(recipeId);
    if (!breakdown) continue;
    await supabase.from("recipe_cost_snapshots").insert({
      restaurant_id: restaurantId,
      recipe_id: recipeId,
      ingredient_cost: breakdown.ingredientCost,
      packaging_cost: breakdown.packagingCost,
      total_cost: breakdown.totalCost,
      snapshot_reason: reason,
    });
    revalidatePath(`/recipes/${recipeId}`);
  }
  revalidatePath("/menu");
  revalidatePath("/dashboard");
}
