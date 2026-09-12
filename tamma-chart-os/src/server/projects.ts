"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import {
  TASK_PRIORITIES,
  WORK_STATUSES,
  type ProjectRow,
  type TaskPriority,
  type TaskRow,
  type WorkStatus,
} from "@/types/database";

export type ActionResult = { error?: string };

const PROJECTS_PATH = "/projects";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseProjectForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "ยังไม่เริ่ม") as WorkStatus;
  const progressRaw = String(formData.get("progress_percent") ?? "0");
  const budgetRaw = String(formData.get("budget") ?? "");

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่อโครงการ");
  if (!WORK_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");
  const progress_percent = Number(progressRaw);
  if (Number.isNaN(progress_percent) || progress_percent < 0 || progress_percent > 100)
    errors.push("ความคืบหน้าต้องอยู่ระหว่าง 0-100");
  const budget = budgetRaw ? Number(budgetRaw) : null;
  if (budget !== null && (Number.isNaN(budget) || budget < 0)) errors.push("งบต้องไม่ติดลบ");

  return {
    errors,
    values: {
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      status,
      start_date: String(formData.get("start_date") ?? "") || null,
      due_date: String(formData.get("due_date") ?? "") || null,
      budget,
      progress_percent,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createProject(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseProjectForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase.from("projects").insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

export async function updateProject(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseProjectForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

export async function archiveProject(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status: "ยกเลิก" satisfies WorkStatus })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ยกเลิกโครงการไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function listTasks(): Promise<TaskRow[]> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function parseTaskForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "ยังไม่เริ่ม") as WorkStatus;
  const priority = String(formData.get("priority") ?? "ปกติ") as TaskPriority;

  const errors: string[] = [];
  if (!name) errors.push("กรุณาระบุชื่องาน");
  if (!WORK_STATUSES.includes(status)) errors.push("สถานะไม่ถูกต้อง");
  if (!TASK_PRIORITIES.includes(priority)) errors.push("ระดับความสำคัญไม่ถูกต้อง");

  return {
    errors,
    values: {
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      project_id: String(formData.get("project_id") ?? "") || null,
      due_date: String(formData.get("due_date") ?? "") || null,
      priority,
      status,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createTask(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseTaskForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({ restaurant_id: restaurantId, ...values });

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

export async function updateTask(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { errors, values } = parseTaskForm(formData);
  if (errors.length) return { error: errors.join(" / ") };

  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update(values)
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

export async function setTaskStatus(id: string, status: WorkStatus): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "บันทึกไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);

  if (error) return { error: "ลบงานไม่สำเร็จ" };
  revalidatePath(PROJECTS_PATH);
  return {};
}
