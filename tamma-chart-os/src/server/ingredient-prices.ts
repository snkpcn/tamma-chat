"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import { recalculateRecipesUsingIngredient } from "@/server/recipes";
import type { IngredientPriceHistoryRow } from "@/types/database";

export type ActionResult = { error?: string };

export async function listIngredientPriceHistory(
  ingredientId: string,
): Promise<IngredientPriceHistoryRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredient_price_history")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .eq("restaurant_id", restaurantId)
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Total baht spent on ingredient purchases recorded today (by purchase_date). */
export async function getTodayIngredientSpend(): Promise<number> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("ingredient_price_history")
    .select("price")
    .eq("restaurant_id", restaurantId)
    .eq("purchase_date", today);

  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => sum + row.price, 0);
}

export async function recordIngredientPrice(
  ingredientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: ingredient, error: ingredientError } = await supabase
    .from("ingredients")
    .select("*")
    .eq("id", ingredientId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (ingredientError || !ingredient) return { error: "ไม่พบวัตถุดิบ" };

  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const purchaseDate =
    String(formData.get("purchase_date") ?? "") ||
    new Date().toISOString().slice(0, 10);
  const purchaseUnit =
    String(formData.get("purchase_unit") ?? "").trim() || ingredient.purchase_unit;
  const price = Number(formData.get("price") ?? "0");
  const purchaseQuantity = Number(formData.get("purchase_quantity") ?? "0");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const errors: string[] = [];
  if (Number.isNaN(price) || price < 0) errors.push("ราคาต้องไม่ติดลบ");
  if (Number.isNaN(purchaseQuantity) || purchaseQuantity <= 0)
    errors.push("ปริมาณที่ซื้อต้องมากกว่า 0");
  if (!purchaseUnit) errors.push("กรุณาระบุหน่วยซื้อ");
  if (errors.length) return { error: errors.join(" / ") };

  const costPerBaseUnit = price / (purchaseQuantity * ingredient.conversion_factor);

  const { error: insertError } = await supabase
    .from("ingredient_price_history")
    .insert({
      restaurant_id: restaurantId,
      ingredient_id: ingredientId,
      supplier_id: supplierId,
      purchase_date: purchaseDate,
      price,
      purchase_unit: purchaseUnit,
      purchase_quantity: purchaseQuantity,
      cost_per_base_unit: costPerBaseUnit,
      notes,
    });

  if (insertError) return { error: "บันทึกราคาไม่สำเร็จ" };

  // Only promote to "latest" if this entry isn't an older backfilled record.
  const { data: history } = await supabase
    .from("ingredient_price_history")
    .select("purchase_date")
    .eq("ingredient_id", ingredientId)
    .eq("restaurant_id", restaurantId)
    .order("purchase_date", { ascending: false })
    .limit(1);

  const isNewestEntry = history?.[0]?.purchase_date === purchaseDate;

  if (isNewestEntry) {
    await supabase
      .from("ingredients")
      .update({ latest_cost_per_base_unit: costPerBaseUnit })
      .eq("id", ingredientId)
      .eq("restaurant_id", restaurantId);

    if (supplierId) {
      await supabase.from("supplier_ingredients").upsert(
        {
          restaurant_id: restaurantId,
          supplier_id: supplierId,
          ingredient_id: ingredientId,
          latest_price: price,
          last_purchase_date: purchaseDate,
        },
        { onConflict: "supplier_id,ingredient_id" },
      );
    }

    await recalculateRecipesUsingIngredient(
      ingredientId,
      `อัปเดตราคาวัตถุดิบ ${ingredient.name}`,
    );
  }

  revalidatePath("/ingredients");
  revalidatePath(`/ingredients/${ingredientId}`);
  return {};
}
