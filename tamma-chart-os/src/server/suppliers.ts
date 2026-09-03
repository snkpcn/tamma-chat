"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import { ACTIVE_STATUSES, type ActiveStatus, type SupplierRow } from "@/types/database";

export type ActionResult = { error?: string };

const SUPPLIERS_PATH = "/suppliers";

export async function listSuppliers(): Promise<SupplierRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseSupplierForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "ใช้งาน") as ActiveStatus;

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อผู้ขาย");
  if (!ACTIVE_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");

  const opt = (key: string) => String(formData.get(key) ?? "").trim() || null;

  return {
    errors,
    values: {
      name,
      supplier_type: opt("supplier_type"),
      contact_name: opt("contact_name"),
      phone: opt("phone"),
      line_id: opt("line_id"),
      address: opt("address"),
      tax_id: opt("tax_id"),
      payment_terms: opt("payment_terms"),
      delivery_days: opt("delivery_days"),
      minimum_order: opt("minimum_order"),
      notes: opt("notes"),
      status,
    },
  };
}

export async function createSupplier(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseSupplierForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(SUPPLIERS_PATH);
  return {};
}

export async function updateSupplier(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseSupplierForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath(SUPPLIERS_PATH);
  return {};
}

export async function archiveSupplier(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ status: "ไม่ใช้งาน" satisfies ActiveStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบผู้ขายไม่สำเร็จ" };
  revalidatePath(SUPPLIERS_PATH);
  return {};
}
