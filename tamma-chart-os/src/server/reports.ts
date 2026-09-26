"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import { listMenuItems } from "@/server/menu";
import { computeRecipeCost } from "@/server/recipes";
import { foodCostPercent, grossMarginPercent } from "@/lib/calc";
import { listOpeningChecklistCategories, listOpeningChecklistItems } from "@/server/opening-checklist";

export type IngredientPriceReportRow = {
  ingredientName: string;
  supplierName: string;
  purchaseDate: string;
  price: number;
  purchaseUnit: string;
  purchaseQuantity: number;
  costPerBaseUnit: number;
};

export async function getIngredientPriceReport(
  dateFrom?: string,
  dateTo?: string,
): Promise<IngredientPriceReportRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  let query = supabase
    .from("ingredient_price_history")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("purchase_date", { ascending: false });

  if (dateFrom) query = query.gte("purchase_date", dateFrom);
  if (dateTo) query = query.lte("purchase_date", dateTo);

  const { data: history, error } = await query;
  if (error) throw new Error(error.message);

  const [{ data: ingredients }, { data: suppliers }] = await Promise.all([
    supabase.from("ingredients").select("id, name").eq("restaurant_id", restaurantId),
    supabase.from("suppliers").select("id, name").eq("restaurant_id", restaurantId),
  ]);

  const ingredientName = new Map((ingredients ?? []).map((i) => [i.id, i.name]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  return (history ?? []).map((h) => ({
    ingredientName: ingredientName.get(h.ingredient_id) ?? "ไม่ทราบชื่อ",
    supplierName: h.supplier_id ? supplierName.get(h.supplier_id) ?? "—" : "—",
    purchaseDate: h.purchase_date,
    price: h.price,
    purchaseUnit: h.purchase_unit,
    purchaseQuantity: h.purchase_quantity,
    costPerBaseUnit: h.cost_per_base_unit,
  }));
}

export type WasteReportRow = {
  ingredientName: string;
  reasonName: string;
  quantityBaseUnit: number;
  baseUnit: string;
  estimatedValue: number;
  occurredAt: string;
};

export async function getWasteReport(
  dateFrom?: string,
  dateTo?: string,
): Promise<WasteReportRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  let query = supabase
    .from("waste_records")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("occurred_at", { ascending: false });

  if (dateFrom) query = query.gte("occurred_at", dateFrom);
  if (dateTo) query = query.lte("occurred_at", dateTo);

  const { data: records, error } = await query;
  if (error) throw new Error(error.message);

  const [{ data: ingredients }, { data: reasons }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, base_unit, latest_cost_per_base_unit")
      .eq("restaurant_id", restaurantId),
    supabase.from("waste_reasons").select("id, name").eq("restaurant_id", restaurantId),
  ]);

  const ingredientById = new Map((ingredients ?? []).map((i) => [i.id, i]));
  const reasonName = new Map((reasons ?? []).map((r) => [r.id, r.name]));

  return (records ?? []).map((r) => {
    const ingredient = ingredientById.get(r.ingredient_id);
    const cost = ingredient?.latest_cost_per_base_unit ?? 0;
    return {
      ingredientName: ingredient?.name ?? "ไม่ทราบชื่อ",
      reasonName: r.reason_id ? reasonName.get(r.reason_id) ?? "—" : "—",
      quantityBaseUnit: r.quantity_base_unit,
      baseUnit: ingredient?.base_unit ?? "",
      estimatedValue: r.quantity_base_unit * cost,
      occurredAt: r.occurred_at,
    };
  });
}

export type SupplierComparisonRow = {
  ingredientName: string;
  supplierName: string;
  latestPrice: number | null;
  lastPurchaseDate: string | null;
};

export async function getSupplierPriceComparison(): Promise<SupplierComparisonRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();

  const { data: links, error } = await supabase
    .from("supplier_ingredients")
    .select("*")
    .eq("restaurant_id", restaurantId);

  if (error) throw new Error(error.message);

  const [{ data: ingredients }, { data: suppliers }] = await Promise.all([
    supabase.from("ingredients").select("id, name").eq("restaurant_id", restaurantId),
    supabase.from("suppliers").select("id, name").eq("restaurant_id", restaurantId),
  ]);

  const ingredientName = new Map((ingredients ?? []).map((i) => [i.id, i.name]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  return (links ?? [])
    .map((l) => ({
      ingredientName: ingredientName.get(l.ingredient_id) ?? "ไม่ทราบชื่อ",
      supplierName: supplierName.get(l.supplier_id) ?? "ไม่ทราบผู้ขาย",
      latestPrice: l.latest_price,
      lastPurchaseDate: l.last_purchase_date,
    }))
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, "th"));
}

export type MenuProfitabilityRow = {
  menuName: string;
  sellingPrice: number;
  totalCost: number | null;
  foodCostPercentValue: number | null;
  marginPercentValue: number | null;
};

export async function getMenuProfitabilityReport(): Promise<MenuProfitabilityRow[]> {
  const items = await listMenuItems();
  return Promise.all(
    items.map(async (item) => {
      if (!item.recipe_id) {
        return {
          menuName: item.name,
          sellingPrice: item.selling_price,
          totalCost: null,
          foodCostPercentValue: null,
          marginPercentValue: null,
        };
      }
      const breakdown = await computeRecipeCost(item.recipe_id);
      const totalCost = breakdown?.totalCost ?? null;
      return {
        menuName: item.name,
        sellingPrice: item.selling_price,
        totalCost,
        foodCostPercentValue:
          totalCost !== null ? foodCostPercent(totalCost, item.selling_price) : null,
        marginPercentValue:
          totalCost !== null ? grossMarginPercent(totalCost, item.selling_price) : null,
      };
    }),
  );
}

export type OpeningReadinessCategoryRow = {
  categoryName: string;
  total: number;
  completed: number;
  percent: number;
};

export async function getOpeningReadinessByCategory(): Promise<
  OpeningReadinessCategoryRow[]
> {
  const [categories, items] = await Promise.all([
    listOpeningChecklistCategories(),
    listOpeningChecklistItems(),
  ]);

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, { total: number; completed: number }>();

  for (const item of items) {
    const key = item.category_id ?? "__none__";
    const entry = groups.get(key) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (item.status === "เสร็จแล้ว") entry.completed += 1;
    groups.set(key, entry);
  }

  return Array.from(groups.entries()).map(([key, v]) => ({
    categoryName: key === "__none__" ? "ไม่ระบุหมวด" : nameById.get(key) ?? "ไม่ระบุหมวด",
    total: v.total,
    completed: v.completed,
    percent: v.total > 0 ? (v.completed / v.total) * 100 : 0,
  }));
}
