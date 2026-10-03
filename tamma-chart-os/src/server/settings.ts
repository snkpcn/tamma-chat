"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentRestaurantId } from "@/server/restaurant";
import type { SettingsRow } from "@/types/database";

const DEFAULT_SETTINGS: Omit<SettingsRow, "restaurant_id"> = {
  food_cost_threshold_percent: 35,
  data: {},
  updated_at: new Date(0).toISOString(),
};

export async function getSettings(): Promise<SettingsRow> {
  const restaurantId = await getCurrentRestaurantId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  return data ?? { restaurant_id: restaurantId, ...DEFAULT_SETTINGS };
}
