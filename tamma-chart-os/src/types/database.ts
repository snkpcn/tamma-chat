// Hand-written types matching supabase/migrations/0001_init.sql.
//
// Only the tables wired up so far (profiles/restaurants for tenancy,
// investment_categories/investments for Phase 2) are typed here. As later
// phases add ingredients, recipes, stock, etc. extend this file — or once a
// live Supabase project exists, replace it with
// `supabase gen types typescript` output and re-add the hand-written pieces
// (like helper aliases) on top.

export type InvestmentStatus =
  | "วางแผน"
  | "ขอราคา"
  | "อนุมัติแล้ว"
  | "สั่งซื้อแล้ว"
  | "ชำระบางส่วน"
  | "ชำระแล้ว"
  | "ได้รับของแล้ว"
  | "ยกเลิก";

export const INVESTMENT_STATUSES: InvestmentStatus[] = [
  "วางแผน",
  "ขอราคา",
  "อนุมัติแล้ว",
  "สั่งซื้อแล้ว",
  "ชำระบางส่วน",
  "ชำระแล้ว",
  "ได้รับของแล้ว",
  "ยกเลิก",
];

export interface Database {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["restaurants"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          restaurant_id: string | null;
          full_name: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          restaurant_id?: string | null;
          full_name?: string | null;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      investment_categories: {
        Row: {
          id: string;
          restaurant_id: string;
          name: string;
          sort_order: number;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["investment_categories"]["Insert"]
        >;
        Relationships: [];
      };
      investments: {
        Row: {
          id: string;
          restaurant_id: string;
          category_id: string | null;
          project_id: string | null;
          name: string;
          description: string | null;
          vendor_name: string | null;
          budget_amount: number;
          actual_amount: number;
          quantity: number;
          unit: string | null;
          order_date: string | null;
          paid_date: string | null;
          status: InvestmentStatus;
          payment_method: string | null;
          notes: string | null;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id?: string | null;
          project_id?: string | null;
          name: string;
          description?: string | null;
          vendor_name?: string | null;
          budget_amount?: number;
          actual_amount?: number;
          quantity?: number;
          unit?: string | null;
          order_date?: string | null;
          paid_date?: string | null;
          status?: InvestmentStatus;
          payment_method?: string | null;
          notes?: string | null;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["investments"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_restaurant_defaults: {
        Args: { p_restaurant_id: string };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
  };
}

export type InvestmentCategoryRow =
  Database["public"]["Tables"]["investment_categories"]["Row"];
export type InvestmentRow = Database["public"]["Tables"]["investments"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type RestaurantRow = Database["public"]["Tables"]["restaurants"]["Row"];
