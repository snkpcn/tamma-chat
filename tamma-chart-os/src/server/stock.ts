"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import { recalculateRecipesUsingIngredient } from "@/server/recipes";
import type { IngredientRow, MovementType, StockMovementRow } from "@/types/database";

export type ActionResult = { error?: string };

const STOCK_PATH = "/stock";

export type StockLevel = {
  ingredient: IngredientRow;
  quantityBaseUnit: number;
  valuationAmount: number;
  status: "พร้อมใช้" | "ใกล้หมด" | "ต้องสั่งเพิ่ม" | "หมด";
};

function statusFor(
  quantity: number,
  reorderPoint: number,
  minimumStock: number,
): StockLevel["status"] {
  if (quantity <= 0) return "หมด";
  if (quantity <= minimumStock) return "ต้องสั่งเพิ่ม";
  if (quantity <= reorderPoint) return "ใกล้หมด";
  return "พร้อมใช้";
}

export async function listStockLevels(): Promise<StockLevel[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const [{ data: ingredients, error: ingredientsError }, { data: movements, error: movementsError }] =
    await Promise.all([
      supabase
        .from("ingredients")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "ใช้งาน")
        .order("name", { ascending: true }),
      supabase
        .from("stock_movements")
        .select("ingredient_id, quantity_base_unit")
        .eq("restaurant_id", restaurantId),
    ]);

  if (ingredientsError) throw new Error(ingredientsError.message);
  if (movementsError) throw new Error(movementsError.message);

  const quantityByIngredient = new Map<string, number>();
  for (const m of movements ?? []) {
    quantityByIngredient.set(
      m.ingredient_id,
      (quantityByIngredient.get(m.ingredient_id) ?? 0) + m.quantity_base_unit,
    );
  }

  return (ingredients ?? []).map((ingredient) => {
    const quantityBaseUnit = quantityByIngredient.get(ingredient.id) ?? 0;
    const costPerBaseUnit = ingredient.latest_cost_per_base_unit ?? 0;
    return {
      ingredient,
      quantityBaseUnit,
      valuationAmount: quantityBaseUnit * costPerBaseUnit,
      status: statusFor(quantityBaseUnit, ingredient.reorder_point, ingredient.minimum_stock_quantity),
    };
  });
}

export async function listStockMovements(
  ingredientId: string,
): Promise<StockMovementRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("*")
    .eq("ingredient_id", ingredientId)
    .eq("restaurant_id", restaurantId)
    .order("occurred_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function currentQuantity(
  ingredientId: string,
  restaurantId: string,
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_movements")
    .select("quantity_base_unit")
    .eq("ingredient_id", ingredientId)
    .eq("restaurant_id", restaurantId);

  return (data ?? []).reduce((sum, m) => sum + m.quantity_base_unit, 0);
}

// ---------------------------------------------------------------------------
// Receiving — creates a stock-in movement AND records the purchase price
// ---------------------------------------------------------------------------

export async function receiveStock(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const ingredientId = String(formData.get("ingredient_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const receivedDate =
    String(formData.get("received_date") ?? "") || new Date().toISOString().slice(0, 10);
  const purchaseQuantity = Number(formData.get("purchase_quantity") ?? "0");
  const price = Number(formData.get("price") ?? "0");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const errors: string[] = [];
  if (!ingredientId) errors.push("กรุณาเลือกวัตถุดิบ");
  if (Number.isNaN(purchaseQuantity) || purchaseQuantity <= 0)
    errors.push("จำนวนต้องมากกว่า 0");
  if (Number.isNaN(price) || price < 0) errors.push("ราคาต้องไม่ติดลบ");
  if (errors.length) return { error: errors.join(" / ") };

  const { data: ingredient, error: ingredientError } = await supabase
    .from("ingredients")
    .select("*")
    .eq("id", ingredientId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (ingredientError || !ingredient) return { error: "ไม่พบวัตถุดิบ" };

  const quantityBaseUnit = purchaseQuantity * ingredient.conversion_factor;
  const costPerBaseUnit = price / quantityBaseUnit;

  const { error: movementError } = await supabase.from("stock_movements").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    movement_type: "รับเข้า" satisfies MovementType,
    quantity_base_unit: quantityBaseUnit,
    cost_per_base_unit: costPerBaseUnit,
    supplier_id: supplierId,
    reference,
    notes,
    occurred_at: new Date(receivedDate).toISOString(),
  });

  if (movementError) return { error: "บันทึกการรับของไม่สำเร็จ" };

  const { error: priceError } = await supabase.from("ingredient_price_history").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    supplier_id: supplierId,
    purchase_date: receivedDate,
    price,
    purchase_unit: ingredient.purchase_unit,
    purchase_quantity: purchaseQuantity,
    cost_per_base_unit: costPerBaseUnit,
    notes,
  });

  if (!priceError) {
    const { data: latestHistory } = await supabase
      .from("ingredient_price_history")
      .select("purchase_date")
      .eq("ingredient_id", ingredientId)
      .eq("restaurant_id", restaurantId)
      .order("purchase_date", { ascending: false })
      .limit(1);

    if (latestHistory?.[0]?.purchase_date === receivedDate) {
      await supabase
        .from("ingredients")
        .update({ latest_cost_per_base_unit: costPerBaseUnit })
        .eq("id", ingredientId)
        .eq("restaurant_id", restaurantId);

      await recalculateRecipesUsingIngredient(ingredientId, `รับวัตถุดิบเข้าใหม่ ${ingredient.name}`);
    }
  }

  revalidatePath(STOCK_PATH);
  revalidatePath("/ingredients");
  revalidatePath(`/ingredients/${ingredientId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Generic movement: เบิกใช้ / ปรับยอด / โอน / คืนผู้ขาย
// ---------------------------------------------------------------------------

const OUTBOUND_TYPES: MovementType[] = ["เบิกใช้", "โอน", "คืนผู้ขาย"];

export async function recordStockMovement(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const ingredientId = String(formData.get("ingredient_id") ?? "");
  const movementType = String(formData.get("movement_type") ?? "") as MovementType;
  const quantityRaw = Number(formData.get("quantity_base_unit") ?? "0");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const errors: string[] = [];
  if (!ingredientId) errors.push("กรุณาเลือกวัตถุดิบ");
  if (!["เบิกใช้", "ปรับยอด", "โอน", "คืนผู้ขาย"].includes(movementType))
    errors.push("ประเภทการเคลื่อนไหวไม่ถูกต้อง");
  if (Number.isNaN(quantityRaw) || quantityRaw <= 0) errors.push("จำนวนต้องมากกว่า 0");
  if (errors.length) return { error: errors.join(" / ") };

  const signedQuantity =
    movementType === "ปรับยอด"
      ? Number(formData.get("adjustment_direction") ?? "1") * quantityRaw
      : OUTBOUND_TYPES.includes(movementType)
        ? -quantityRaw
        : quantityRaw;

  const { error } = await supabase.from("stock_movements").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    movement_type: movementType,
    quantity_base_unit: signedQuantity,
    reason,
    notes,
  });

  if (error) return { error: "บันทึกการเคลื่อนไหวสต๊อกไม่สำเร็จ" };
  revalidatePath(STOCK_PATH);
  return {};
}

export async function recordStockCount(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const ingredientId = String(formData.get("ingredient_id") ?? "");
  const countedQuantity = Number(formData.get("counted_quantity") ?? "0");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!ingredientId) return { error: "กรุณาเลือกวัตถุดิบ" };
  if (Number.isNaN(countedQuantity) || countedQuantity < 0)
    return { error: "จำนวนที่นับต้องไม่ติดลบ" };

  const systemQuantity = await currentQuantity(ingredientId, restaurantId);
  const variance = countedQuantity - systemQuantity;

  await supabase.from("stock_counts").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    counted_quantity_base_unit: countedQuantity,
    system_quantity_base_unit: systemQuantity,
    notes,
  });

  if (variance !== 0) {
    const { error } = await supabase.from("stock_movements").insert({
      restaurant_id: restaurantId,
      ingredient_id: ingredientId,
      movement_type: "นับสต๊อก" satisfies MovementType,
      quantity_base_unit: variance,
      reason: "ปรับยอดตามการนับสต๊อก",
      notes,
    });
    if (error) return { error: "บันทึกผลนับสต๊อกไม่สำเร็จ" };
  }

  revalidatePath(STOCK_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Waste
// ---------------------------------------------------------------------------

export async function recordWaste(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const ingredientId = String(formData.get("ingredient_id") ?? "");
  const quantity = Number(formData.get("quantity_base_unit") ?? "0");
  const reasonId = String(formData.get("reason_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const errors: string[] = [];
  if (!ingredientId) errors.push("กรุณาเลือกวัตถุดิบ");
  if (Number.isNaN(quantity) || quantity <= 0) errors.push("จำนวนต้องมากกว่า 0");
  if (errors.length) return { error: errors.join(" / ") };

  const { error: wasteError } = await supabase.from("waste_records").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    quantity_base_unit: quantity,
    reason_id: reasonId,
    notes,
  });

  if (wasteError) return { error: "บันทึกของเสียไม่สำเร็จ" };

  const { error: movementError } = await supabase.from("stock_movements").insert({
    restaurant_id: restaurantId,
    ingredient_id: ingredientId,
    movement_type: "ของเสีย" satisfies MovementType,
    quantity_base_unit: -quantity,
    notes,
  });

  if (movementError) return { error: "บันทึกการตัดสต๊อกของเสียไม่สำเร็จ" };

  revalidatePath(STOCK_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Waste reasons (simple list)
// ---------------------------------------------------------------------------

export async function listWasteReasons() {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waste_reasons")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createWasteReason(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อสาเหตุ" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase.from("waste_reasons").insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีสาเหตุนี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ" };
  }
  revalidatePath(STOCK_PATH);
  return {};
}

export async function renameWasteReason(id: string, name: string): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อสาเหตุ" };
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("waste_reasons")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(STOCK_PATH);
  return {};
}

export async function archiveWasteReason(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("waste_reasons")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบสาเหตุไม่สำเร็จ (อาจมีการใช้งานอยู่)" };
  revalidatePath(STOCK_PATH);
  return {};
}

export async function listWasteRecords() {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waste_records")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return data ?? [];
}
