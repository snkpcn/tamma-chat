"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  ACTIVE_STATUSES,
  type ActiveStatus,
  type MenuCategoryRow,
  type MenuItemRow,
} from "@/types/database";

export type ActionResult = { error?: string };

const MENU_PATH = "/menu";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listMenuCategories(): Promise<MenuCategoryRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createMenuCategory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_categories")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีหมวดหมู่นี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }
  revalidatePath(MENU_PATH);
  return {};
}

export async function renameMenuCategory(id: string, name: string): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อหมวดหมู่" };
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(MENU_PATH);
  return {};
}

export async function archiveMenuCategory(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบหมวดหมู่ไม่สำเร็จ (อาจมีเมนูใช้งานอยู่)" };
  revalidatePath(MENU_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

export async function listMenuItems(): Promise<MenuItemRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseMenuItemForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const sellingPriceRaw = String(formData.get("selling_price") ?? "0");
  const status = String(formData.get("status") ?? "ใช้งาน") as ActiveStatus;
  const selling_price = Number(sellingPriceRaw);

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อเมนู");
  if (Number.isNaN(selling_price) || selling_price < 0)
    errors.push("ราคาขายต้องไม่ติดลบ");
  if (!ACTIVE_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      category_id: String(formData.get("category_id") ?? "") || null,
      recipe_id: String(formData.get("recipe_id") ?? "") || null,
      selling_price,
      description: String(formData.get("description") ?? "").trim() || null,
      is_available: formData.get("is_available") === "on",
      notes: String(formData.get("notes") ?? "").trim() || null,
      status,
    },
  };
}

export async function createMenuItem(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseMenuItemForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_items")
    .insert({ restaurant_id: restaurantId, ...values })
    .select("id")
    .single();

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };

  await supabase.from("menu_price_history").insert({
    restaurant_id: restaurantId,
    menu_item_id: data.id,
    selling_price: values.selling_price,
  });

  revalidatePath(MENU_PATH);
  return {};
}

export async function updateMenuItem(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseMenuItemForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("menu_items")
    .select("selling_price")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  const { error } = await supabase
    .from("menu_items")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };

  if (existing && existing.selling_price !== values.selling_price) {
    await supabase.from("menu_price_history").insert({
      restaurant_id: restaurantId,
      menu_item_id: id,
      selling_price: values.selling_price,
    });
  }

  revalidatePath(MENU_PATH);
  return {};
}

export async function archiveMenuItem(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_items")
    .update({ status: "ไม่ใช้งาน" satisfies ActiveStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ปิดใช้งานเมนูไม่สำเร็จ" };
  revalidatePath(MENU_PATH);
  return {};
}
