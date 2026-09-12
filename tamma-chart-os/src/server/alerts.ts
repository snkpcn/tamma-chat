"use server";

import { listStockLevels } from "@/server/stock";
import { listIngredients } from "@/server/ingredients";
import { listIngredientPriceHistory } from "@/server/ingredient-prices";
import { listMenuItems } from "@/server/menu";
import { computeRecipeCost } from "@/server/recipes";
import { getInvestmentSummary } from "@/server/investments";
import { listTasks } from "@/server/projects";
import { listOpeningChecklistItems } from "@/server/opening-checklist";
import { getSettings } from "@/server/settings";
import { computePriceStats, foodCostPercent } from "@/lib/calc";
import type { AlertSeverity } from "@/types/database";

export type ComputedAlert = {
  type: string;
  severity: AlertSeverity;
  message: string;
};

const COST_SPIKE_THRESHOLD_PERCENT = 10;
const NEAR_BUDGET_PERCENT = 90;

export async function computeAlerts(): Promise<ComputedAlert[]> {
  const alerts: ComputedAlert[] = [];

  const [stockLevels, ingredients, menuItems, investmentSummary, tasks, checklistItems, settings] =
    await Promise.all([
      listStockLevels(),
      listIngredients(),
      listMenuItems(),
      getInvestmentSummary(),
      listTasks(),
      listOpeningChecklistItems(),
      getSettings(),
    ]);

  // Stock
  for (const level of stockLevels) {
    if (level.status === "หมด") {
      alerts.push({
        type: "stock_out",
        severity: "วิกฤต",
        message: `${level.ingredient.name} หมดสต๊อก`,
      });
    } else if (level.status === "ต้องสั่งเพิ่ม") {
      alerts.push({
        type: "stock_low",
        severity: "เตือน",
        message: `${level.ingredient.name} ใกล้หมด ต้องสั่งเพิ่ม (คงเหลือ ${level.quantityBaseUnit.toLocaleString("th-TH", { maximumFractionDigits: 1 })} ${level.ingredient.base_unit})`,
      });
    } else if (level.status === "ใกล้หมด") {
      alerts.push({
        type: "stock_reorder",
        severity: "ปกติ",
        message: `${level.ingredient.name} ถึงจุดสั่งซื้อแล้ว`,
      });
    }
  }

  // Ingredient cost spikes
  const activeIngredients = ingredients.filter((i) => i.status === "ใช้งาน");
  const priceStatsResults = await Promise.all(
    activeIngredients.map(async (ing) => ({
      ing,
      stats: computePriceStats(await listIngredientPriceHistory(ing.id)),
    })),
  );
  for (const { ing, stats } of priceStatsResults) {
    if (
      stats.percentChangeFromAverage7Day !== null &&
      stats.percentChangeFromAverage7Day > COST_SPIKE_THRESHOLD_PERCENT
    ) {
      alerts.push({
        type: "cost_spike",
        severity: "เตือน",
        message: `${ing.name} เพิ่มขึ้น ${stats.percentChangeFromAverage7Day.toFixed(0)}% จากค่าเฉลี่ย 7 วัน`,
      });
    }
  }

  // Menu food cost over threshold
  for (const item of menuItems) {
    if (!item.recipe_id || item.status !== "ใช้งาน") continue;
    const breakdown = await computeRecipeCost(item.recipe_id);
    if (!breakdown) continue;
    const pct = foodCostPercent(breakdown.totalCost, item.selling_price);
    if (pct !== null && pct > settings.food_cost_threshold_percent) {
      alerts.push({
        type: "food_cost_high",
        severity: "เตือน",
        message: `เมนู "${item.name}" Food Cost ${pct.toFixed(0)}% สูงกว่าเกณฑ์ ${settings.food_cost_threshold_percent}%`,
      });
    }
  }

  // Investment budget
  for (const cat of investmentSummary.byCategory) {
    if (cat.isOverBudget) {
      alerts.push({
        type: "investment_over_budget",
        severity: "วิกฤต",
        message: `หมวดลงทุน "${cat.categoryName}" เกินงบแล้ว (${cat.usedPercent.toFixed(0)}%)`,
      });
    } else if (cat.usedPercent >= NEAR_BUDGET_PERCENT) {
      alerts.push({
        type: "investment_near_budget",
        severity: "เตือน",
        message: `หมวดลงทุน "${cat.categoryName}" ใกล้เกินงบ (${cat.usedPercent.toFixed(0)}%)`,
      });
    }
  }

  // Overdue tasks
  const today = new Date(new Date().toDateString());
  for (const task of tasks) {
    if (!task.due_date) continue;
    if (task.status === "เสร็จแล้ว" || task.status === "ยกเลิก") continue;
    if (new Date(task.due_date) < today) {
      alerts.push({
        type: "task_overdue",
        severity: "เตือน",
        message: `งาน "${task.name}" เลยกำหนดแล้ว (${task.due_date})`,
      });
    }
  }

  // Checklist delays
  for (const item of checklistItems) {
    if (!item.due_date) continue;
    if (item.status === "เสร็จแล้ว") continue;
    if (new Date(item.due_date) < today) {
      alerts.push({
        type: "checklist_delayed",
        severity: "เตือน",
        message: `เช็กลิสต์ "${item.name}" ล่าช้ากว่ากำหนด (${item.due_date})`,
      });
    }
  }

  return alerts;
}
