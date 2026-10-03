import { createClient } from "@/lib/supabase/server";

export class NoRestaurantError extends Error {
  constructor() {
    super(
      "บัญชีนี้ยังไม่ได้ผูกกับร้านอาหาร กรุณาตั้งค่าโปรไฟล์ก่อนใช้งาน",
    );
    this.name = "NoRestaurantError";
  }
}

/**
 * Resolves the signed-in user's restaurant_id via their profile row.
 * Throws NoRestaurantError if the profile/restaurant hasn't been
 * provisioned yet — callers should render that as an explanatory empty
 * state, never a blank page.
 */
export async function getCurrentRestaurantId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new NoRestaurantError();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("restaurant_id")
    .eq("id", user.id)
    .single();

  if (!profile?.restaurant_id) {
    throw new NoRestaurantError();
  }

  return profile.restaurant_id;
}
