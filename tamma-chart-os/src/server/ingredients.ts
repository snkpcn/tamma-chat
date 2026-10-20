"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  ACTIVE_STATUSES,
  type ActiveStatus,
  type IngredientCategoryRow,
  type IngredientRow,
} from "@/types/database";

export type ActionResult = { error?: string };

const INGREDIENTS_PATH = "/ingredients";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listIngredientCategories(): Promise<
  IngredientCategoryRow[]
> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredient_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createIngredientCategory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredient_categories")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีหมวดหมู่นี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }
  revalidatePath(INGREDIENTS_PATH);
  return {};
}

export async function renameIngredientCategory(
  id: string,
  name: string,
): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredient_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(INGREDIENTS_PATH);
  return {};
}

export async function archiveIngredientCategory(
  id: string,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredient_categories")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบหมวดหมู่ไม่สำเร็จ" };
  revalidatePath(INGREDIENTS_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export async function listIngredients(): Promise<IngredientRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseIngredientForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const baseUnit = String(formData.get("base_unit") ?? "").trim();
  const purchaseUnit = String(formData.get("purchase_unit") ?? "").trim();
  const conversionRaw = String(formData.get("conversion_factor") ?? "1");
  const reorderRaw = String(formData.get("reorder_point") ?? "0");
  const minStockRaw = String(formData.get("minimum_stock_quantity") ?? "0");
  const status = String(formData.get("status") ?? "ใช้งาน") as ActiveStatus;
  const categoryId = String(formData.get("category_id") ?? "") || null;
  const supplierId = String(formData.get("primary_supplier_id") ?? "") || null;
  const shelfLifeRaw = String(formData.get("shelf_life_days") ?? "");

  const conversion_factor = Number(conversionRaw);
  const reorder_point = Number(reorderRaw);
  const minimum_stock_quantity = Number(minStockRaw);
  const shelf_life_days = shelfLifeRaw ? Number(shelfLifeRaw) : null;

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อวัตถุดิบ");
  if (!baseUnit) errors.push("กรุณาระบุหน่วยฐาน");
  if (!purchaseUnit) errors.push("กรุณาระบุหน่วยซื้อ");
  if (Number.isNaN(conversion_factor) || conversion_factor <= 0)
    errors.push("conversion factor ต้องมากกว่า 0");
  if (Number.isNaN(reorder_point) || reorder_point < 0)
    errors.push("จุดสั่งซื้อขั้นต่ำต้องไม่ติดลบ");
  if (Number.isNaN(minimum_stock_quantity) || minimum_stock_quantity < 0)
    errors.push("ปริมาณคงเหลือขั้นต่ำต้องไม่ติดลบ");
  if (shelf_life_days !== null && (Number.isNaN(shelf_life_days) || shelf_life_days < 0))
    errors.push("อายุเก็บต้องไม่ติดลบ");
  if (!ACTIVE_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      category_id: categoryId,
      base_unit: baseUnit,
      purchase_unit: purchaseUnit,
      conversion_factor,
      primary_supplier_id: supplierId,
      reorder_point,
      minimum_stock_quantity,
      shelf_life_days,
      notes: String(formData.get("notes") ?? "").trim() || null,
      status,
    },
  };
}

export async function createIngredient(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseIngredientForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .insert({ restaurant_id: restaurantId, ...values });

  if (error) {
    if (error.code === "23505") return { error: "มีวัตถุดิบชื่อนี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }
  revalidatePath(INGREDIENTS_PATH);
  return {};
}

export async function updateIngredient(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseIngredientForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(INGREDIENTS_PATH);
  return {};
}

export async function archiveIngredient(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update({ status: "ไม่ใช้งาน" satisfies ActiveStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ปิดใช้งานวัตถุดิบไม่สำเร็จ" };
  revalidatePath(INGREDIENTS_PATH);
  return {};
}
