"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  INVESTMENT_STATUSES,
  type InvestmentCategoryRow,
  type InvestmentRow,
  type InvestmentStatus,
} from "@/types/database";

export type ActionResult = { error?: string };

const INVESTMENT_PATH = "/investment";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listInvestmentCategories(): Promise<
  InvestmentCategoryRow[]
> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_archived", false)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createInvestmentCategory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investment_categories")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีหมวดหมู่นี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }

  revalidatePath(INVESTMENT_PATH);
  return {};
}

export async function renameInvestmentCategory(
  id: string,
  name: string,
): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อหมวดหมู่" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investment_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(INVESTMENT_PATH);
  return {};
}

export async function archiveInvestmentCategory(
  id: string,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investment_categories")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบหมวดหมู่ไม่สำเร็จ" };
  revalidatePath(INVESTMENT_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------

export async function listInvestments(): Promise<InvestmentRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investments")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseInvestmentForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "") || null;
  const budgetRaw = String(formData.get("budget_amount") ?? "0");
  const actualRaw = String(formData.get("actual_amount") ?? "0");
  const quantityRaw = String(formData.get("quantity") ?? "1");
  const status = String(formData.get("status") ?? "วางแผน") as InvestmentStatus;

  const budget_amount = Number(budgetRaw);
  const actual_amount = Number(actualRaw);
  const quantity = Number(quantityRaw);

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อรายการ");
  if (Number.isNaN(budget_amount) || budget_amount < 0)
    errors.push("งบประมาณต้องเป็นตัวเลขไม่ติดลบ");
  if (Number.isNaN(actual_amount) || actual_amount < 0)
    errors.push("ราคาจริงต้องเป็นตัวเลขไม่ติดลบ");
  if (Number.isNaN(quantity) || quantity < 0)
    errors.push("จำนวนต้องเป็นตัวเลขไม่ติดลบ");
  if (!INVESTMENT_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      category_id: categoryId,
      description: String(formData.get("description") ?? "") || null,
      vendor_name: String(formData.get("vendor_name") ?? "") || null,
      budget_amount,
      actual_amount,
      quantity,
      unit: String(formData.get("unit") ?? "") || null,
      order_date: String(formData.get("order_date") ?? "") || null,
      paid_date: String(formData.get("paid_date") ?? "") || null,
      status,
      payment_method: String(formData.get("payment_method") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    },
  };
}

export async function createInvestment(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseInvestmentForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investments")
    .insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(INVESTMENT_PATH);
  return {};
}

export async function updateInvestment(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseInvestmentForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investments")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(INVESTMENT_PATH);
  return {};
}

export async function archiveInvestment(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("investments")
    .update({ is_archived: true, status: "ยกเลิก" satisfies InvestmentStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบรายการไม่สำเร็จ" };
  revalidatePath(INVESTMENT_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

export type InvestmentSummary = {
  totalBudget: number;
  totalActual: number;
  remaining: number;
  usedPercent: number;
  byCategory: Array<{
    categoryId: string | null;
    categoryName: string;
    budget: number;
    actual: number;
    remaining: number;
    usedPercent: number;
    isOverBudget: boolean;
  }>;
};

export async function getInvestmentSummary(): Promise<InvestmentSummary> {
  const [investments, categories] = await Promise.all([
    listInvestments(),
    listInvestmentCategories(),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const byCategoryMap = new Map<
    string,
    { budget: number; actual: number; name: string }
  >();

  let totalBudget = 0;
  let totalActual = 0;

  for (const inv of investments) {
    totalBudget += inv.budget_amount;
    totalActual += inv.actual_amount;

    const key = inv.category_id ?? "__uncategorized__";
    const name = inv.category_id
      ? categoryNameById.get(inv.category_id) ?? "ไม่ระบุหมวดหมู่"
      : "ไม่ระบุหมวดหมู่";
    const entry = byCategoryMap.get(key) ?? { budget: 0, actual: 0, name };
    entry.budget += inv.budget_amount;
    entry.actual += inv.actual_amount;
    byCategoryMap.set(key, entry);
  }

  const byCategory = Array.from(byCategoryMap.entries()).map(
    ([categoryId, v]) => ({
      categoryId: categoryId === "__uncategorized__" ? null : categoryId,
      categoryName: v.name,
      budget: v.budget,
      actual: v.actual,
      remaining: v.budget - v.actual,
      usedPercent: v.budget > 0 ? (v.actual / v.budget) * 100 : 0,
      isOverBudget: v.actual > v.budget && v.budget > 0,
    }),
  );

  return {
    totalBudget,
    totalActual,
    remaining: totalBudget - totalActual,
    usedPercent: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
    byCategory,
  };
}
