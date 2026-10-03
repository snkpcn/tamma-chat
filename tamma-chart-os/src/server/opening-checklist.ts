"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  CHECKLIST_STATUSES,
  type ChecklistStatus,
  type OpeningChecklistCategoryRow,
  type OpeningChecklistItemRow,
} from "@/types/database";

export type ActionResult = { error?: string };

const CHECKLIST_PATH = "/projects";

export async function listOpeningChecklistCategories(): Promise<
  OpeningChecklistCategoryRow[]
> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_checklist_categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createOpeningChecklistCategory(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อหมวด" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_categories")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีหมวดนี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ" };
  }
  revalidatePath(CHECKLIST_PATH);
  return {};
}

export async function renameOpeningChecklistCategory(
  id: string,
  name: string,
): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อหมวด" };
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(CHECKLIST_PATH);
  return {};
}

export async function archiveOpeningChecklistCategory(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบหมวดไม่สำเร็จ (อาจมีรายการใช้งานอยู่)" };
  revalidatePath(CHECKLIST_PATH);
  return {};
}

export async function listOpeningChecklistItems(): Promise<
  OpeningChecklistItemRow[]
> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_checklist_items")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export type OpeningReadiness = {
  totalItems: number;
  completedItems: number;
  percent: number;
};

export async function getOpeningReadiness(): Promise<OpeningReadiness> {
  const items = await listOpeningChecklistItems();
  const totalItems = items.length;
  const completedItems = items.filter((i) => i.status === "เสร็จแล้ว").length;
  return {
    totalItems,
    completedItems,
    percent: totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
  };
}

function parseChecklistItemForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "ยังไม่เริ่ม") as ChecklistStatus;

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อรายการ");
  if (!CHECKLIST_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      category_id: String(formData.get("category_id") ?? "") || null,
      due_date: String(formData.get("due_date") ?? "") || null,
      status,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createChecklistItem(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseChecklistItemForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_items")
    .insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(CHECKLIST_PATH);
  revalidatePath("/dashboard");
  return {};
}

export async function updateChecklistItemStatus(
  id: string,
  status: ChecklistStatus,
): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_items")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(CHECKLIST_PATH);
  revalidatePath("/dashboard");
  return {};
}

export async function deleteChecklistItem(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_checklist_items")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบรายการไม่สำเร็จ" };
  revalidatePath(CHECKLIST_PATH);
  revalidatePath("/dashboard");
  return {};
}
