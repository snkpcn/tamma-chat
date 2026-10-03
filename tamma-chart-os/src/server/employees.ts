"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  EMPLOYEE_STATUSES,
  type EmployeePositionRow,
  type EmployeeRow,
  type EmployeeStatus,
} from "@/types/database";

export type ActionResult = { error?: string };

const PERSONNEL_PATH = "/personnel";

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export async function listEmployeePositions(): Promise<EmployeePositionRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_positions")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createEmployeePosition(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาระบุชื่อตำแหน่ง" };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_positions")
    .insert({ restaurant_id: restaurantId, name });

  if (error) {
    if (error.code === "23505") return { error: "มีตำแหน่งนี้อยู่แล้ว" };
    return { error: "บันทึกไม่สำเร็จ" };
  }
  revalidatePath(PERSONNEL_PATH);
  return {};
}

export async function renameEmployeePosition(id: string, name: string): Promise<ActionResult> {
  if (!name.trim()) return { error: "กรุณาระบุชื่อตำแหน่ง" };
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_positions")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PERSONNEL_PATH);
  return {};
}

export async function archiveEmployeePosition(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_positions")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบตำแหน่งไม่สำเร็จ (อาจมีพนักงานใช้งานอยู่)" };
  revalidatePath(PERSONNEL_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function listEmployees(): Promise<EmployeeRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseEmployeeForm(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const status = String(formData.get("status") ?? "ทำงานอยู่") as EmployeeStatus;
  const wageRaw = String(formData.get("wage_amount") ?? "");

  const errors: string[] = [];
  if (!fullName) errors.push("กรุณาระบุชื่อ");
  if (!EMPLOYEE_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");
  const wage_amount = wageRaw ? Number(wageRaw) : null;
  if (wage_amount !== null && (Number.isNaN(wage_amount) || wage_amount < 0))
    errors.push("เงินเดือน/ค่าแรงต้องไม่ติดลบ");

  return {
    errors,
    values: {
      full_name: fullName,
      nickname: String(formData.get("nickname") ?? "").trim() || null,
      position_id: String(formData.get("position_id") ?? "") || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      start_date: String(formData.get("start_date") ?? "") || null,
      employment_type: String(formData.get("employment_type") ?? "").trim() || null,
      wage_amount,
      status,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createEmployee(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseEmployeeForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PERSONNEL_PATH);
  return {};
}

export async function updateEmployee(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseEmployeeForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PERSONNEL_PATH);
  return {};
}

export async function archiveEmployee(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({ status: "พ้นสภาพ" satisfies EmployeeStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ปรับสถานะไม่สำเร็จ" };
  revalidatePath(PERSONNEL_PATH);
  return {};
}
