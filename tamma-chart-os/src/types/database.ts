// Hand-written types matching supabase/migrations/0001_init.sql.
//
// Each table's Insert type is a plain object literal (not built through a
// generic helper) and Update is `Partial<Database[...]["Insert"]>` — that
// specific shape is required: @supabase/postgrest-js's `.insert()`/`.update()`
// overloads resolve `Row extends Relation["Insert"] ? ... : never` structurally,
// and when Insert is instead produced by a generic alias like
// `Omit<Row, K> & Partial<Pick<Row, K>>` (even simplified via a mapped type),
// that resolution silently collapses to `never`, breaking every insert/update
// call with no useful error at the call site. Keep new tables in this same
// literal-object style.
//
// Once a live Supabase project exists, regenerate with
// `supabase gen types typescript` and re-add the hand-written aliases below
// on top of the generated Database type.

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

export type ActiveStatus = "ใช้งาน" | "ไม่ใช้งาน";
export const ACTIVE_STATUSES: ActiveStatus[] = ["ใช้งาน", "ไม่ใช้งาน"];

export type EmployeeStatus = "ทำงานอยู่" | "พ้นสภาพ";
export const EMPLOYEE_STATUSES: EmployeeStatus[] = ["ทำงานอยู่", "พ้นสภาพ"];

export type WorkStatus = "ยังไม่เริ่ม" | "กำลังทำ" | "รอ" | "เสร็จแล้ว" | "ยกเลิก";
export const WORK_STATUSES: WorkStatus[] = [
  "ยังไม่เริ่ม",
  "กำลังทำ",
  "รอ",
  "เสร็จแล้ว",
  "ยกเลิก",
];

export type ChecklistStatus = "ยังไม่เริ่ม" | "กำลังทำ" | "เสร็จแล้ว";
export const CHECKLIST_STATUSES: ChecklistStatus[] = [
  "ยังไม่เริ่ม",
  "กำลังทำ",
  "เสร็จแล้ว",
];

export type TaskPriority = "ต่ำ" | "ปกติ" | "สูง" | "เร่งด่วน";
export const TASK_PRIORITIES: TaskPriority[] = ["ต่ำ", "ปกติ", "สูง", "เร่งด่วน"];

export type AlertSeverity = "ปกติ" | "เตือน" | "วิกฤต";

export type MovementType =
  | "รับเข้า"
  | "เบิกใช้"
  | "ขาย"
  | "ของเสีย"
  | "นับสต๊อก"
  | "ปรับยอด"
  | "โอน"
  | "คืนผู้ขาย";
export const MOVEMENT_TYPES: MovementType[] = [
  "รับเข้า",
  "เบิกใช้",
  "ของเสีย",
  "นับสต๊อก",
  "ปรับยอด",
  "โอน",
  "คืนผู้ขาย",
];

// ---------------------------------------------------------------------------
// Row shapes (one per table, matching the SQL migration column-for-column)
// ---------------------------------------------------------------------------

export type RestaurantRow = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ProfileRow = {
  id: string;
  restaurant_id: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
  updated_at: string;
};

export type InvestmentCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type InvestmentRow = {
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

export type SupplierRow = {
  id: string;
  restaurant_id: string;
  name: string;
  supplier_type: string | null;
  contact_name: string | null;
  phone: string | null;
  line_id: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: string | null;
  delivery_days: string | null;
  minimum_order: string | null;
  notes: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
};

export type IngredientCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
};

export type IngredientRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  base_unit: string;
  purchase_unit: string;
  conversion_factor: number;
  primary_supplier_id: string | null;
  latest_cost_per_base_unit: number | null;
  reorder_point: number;
  minimum_stock_quantity: number;
  shelf_life_days: number | null;
  notes: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
};

export type IngredientPriceHistoryRow = {
  id: string;
  restaurant_id: string;
  ingredient_id: string;
  supplier_id: string | null;
  purchase_date: string;
  price: number;
  purchase_unit: string;
  purchase_quantity: number;
  cost_per_base_unit: number;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type RecipeCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
};

export type RecipeRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  image_path: string | null;
  description: string | null;
  standard_serving_size: number;
  method: string | null;
  notes: string | null;
  packaging_cost: number;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
};

export type RecipeIngredientRow = {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  sort_order: number;
  notes: string | null;
};

export type RecipeCostSnapshotRow = {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  ingredient_cost: number;
  packaging_cost: number;
  total_cost: number;
  snapshot_reason: string | null;
  created_at: string;
};

export type MenuCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
};

export type MenuItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  recipe_id: string | null;
  name: string;
  selling_price: number;
  image_path: string | null;
  description: string | null;
  is_available: boolean;
  notes: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
};

export type StockMovementRow = {
  id: string;
  restaurant_id: string;
  ingredient_id: string;
  movement_type: MovementType;
  quantity_base_unit: number;
  cost_per_base_unit: number | null;
  supplier_id: string | null;
  lot_id: string | null;
  reference: string | null;
  reason: string | null;
  notes: string | null;
  recorded_by: string | null;
  occurred_at: string;
  created_at: string;
};

export type WasteReasonRow = {
  id: string;
  restaurant_id: string;
  name: string;
};

export type WasteRecordRow = {
  id: string;
  restaurant_id: string;
  ingredient_id: string;
  quantity_base_unit: number;
  reason_id: string | null;
  occurred_at: string;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
};

export type EmployeePositionRow = {
  id: string;
  restaurant_id: string;
  name: string;
};

export type EmployeeRow = {
  id: string;
  restaurant_id: string;
  full_name: string;
  nickname: string | null;
  position_id: string | null;
  phone: string | null;
  start_date: string | null;
  employment_type: string | null;
  wage_amount: number | null;
  status: EmployeeStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: WorkStatus;
  start_date: string | null;
  due_date: string | null;
  budget: number | null;
  owner_employee_id: string | null;
  progress_percent: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRow = {
  id: string;
  restaurant_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  owner_employee_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: WorkStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OpeningChecklistCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
};

export type OpeningChecklistItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  owner_employee_id: string | null;
  due_date: string | null;
  status: ChecklistStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertRow = {
  id: string;
  restaurant_id: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  related_table: string | null;
  related_id: string | null;
  is_resolved: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type ActivityLogRow = {
  id: string;
  restaurant_id: string;
  actor_id: string | null;
  action: string;
  entity_table: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};

export type SettingsRow = {
  restaurant_id: string;
  food_cost_threshold_percent: number;
  data: Record<string, unknown>;
  updated_at: string;
};

export type StockCountRow = {
  id: string;
  restaurant_id: string;
  ingredient_id: string;
  counted_quantity_base_unit: number;
  system_quantity_base_unit: number;
  variance_base_unit: number;
  counted_by: string | null;
  counted_at: string;
  notes: string | null;
};

export type SupplierIngredientRow = {
  id: string;
  restaurant_id: string;
  supplier_id: string;
  ingredient_id: string;
  latest_price: number | null;
  last_purchase_date: string | null;
  notes: string | null;
};

export type MenuPriceHistoryRow = {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  selling_price: number;
  effective_from: string;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Database generic schema
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      restaurants: {
        Row: RestaurantRow;
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
        Row: ProfileRow;
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
        Row: InvestmentCategoryRow;
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
        Row: InvestmentRow;
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
      suppliers: {
        Row: SupplierRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          supplier_type?: string | null;
          contact_name?: string | null;
          phone?: string | null;
          line_id?: string | null;
          address?: string | null;
          tax_id?: string | null;
          payment_terms?: string | null;
          delivery_days?: string | null;
          minimum_order?: string | null;
          notes?: string | null;
          status?: ActiveStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Insert"]>;
        Relationships: [];
      };
      ingredient_categories: {
        Row: IngredientCategoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
          is_archived?: boolean;
        };
        Update: Partial<
          Database["public"]["Tables"]["ingredient_categories"]["Insert"]
        >;
        Relationships: [];
      };
      ingredients: {
        Row: IngredientRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id?: string | null;
          name: string;
          base_unit: string;
          purchase_unit: string;
          conversion_factor?: number;
          primary_supplier_id?: string | null;
          latest_cost_per_base_unit?: number | null;
          reorder_point?: number;
          minimum_stock_quantity?: number;
          shelf_life_days?: number | null;
          notes?: string | null;
          status?: ActiveStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ingredients"]["Insert"]>;
        Relationships: [];
      };
      ingredient_price_history: {
        Row: IngredientPriceHistoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          ingredient_id: string;
          supplier_id?: string | null;
          purchase_date?: string;
          price: number;
          purchase_unit: string;
          purchase_quantity: number;
          cost_per_base_unit: number;
          notes?: string | null;
          recorded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["ingredient_price_history"]["Insert"]
        >;
        Relationships: [];
      };
      recipe_categories: {
        Row: RecipeCategoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["recipe_categories"]["Insert"]
        >;
        Relationships: [];
      };
      recipes: {
        Row: RecipeRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id?: string | null;
          name: string;
          image_path?: string | null;
          description?: string | null;
          standard_serving_size?: number;
          method?: string | null;
          notes?: string | null;
          packaging_cost?: number;
          status?: ActiveStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recipes"]["Insert"]>;
        Relationships: [];
      };
      recipe_ingredients: {
        Row: RecipeIngredientRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          recipe_id: string;
          ingredient_id: string;
          quantity: number;
          unit: string;
          sort_order?: number;
          notes?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["recipe_ingredients"]["Insert"]
        >;
        Relationships: [];
      };
      recipe_cost_snapshots: {
        Row: RecipeCostSnapshotRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          recipe_id: string;
          ingredient_cost: number;
          packaging_cost?: number;
          total_cost: number;
          snapshot_reason?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["recipe_cost_snapshots"]["Insert"]
        >;
        Relationships: [];
      };
      menu_categories: {
        Row: MenuCategoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["menu_categories"]["Insert"]
        >;
        Relationships: [];
      };
      menu_items: {
        Row: MenuItemRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id?: string | null;
          recipe_id?: string | null;
          name: string;
          selling_price?: number;
          image_path?: string | null;
          description?: string | null;
          is_available?: boolean;
          notes?: string | null;
          status?: ActiveStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["menu_items"]["Insert"]>;
        Relationships: [];
      };
      stock_movements: {
        Row: StockMovementRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          ingredient_id: string;
          movement_type: MovementType;
          quantity_base_unit: number;
          cost_per_base_unit?: number | null;
          supplier_id?: string | null;
          lot_id?: string | null;
          reference?: string | null;
          reason?: string | null;
          notes?: string | null;
          recorded_by?: string | null;
          occurred_at?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["stock_movements"]["Insert"]
        >;
        Relationships: [];
      };
      waste_reasons: {
        Row: WasteReasonRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["waste_reasons"]["Insert"]
        >;
        Relationships: [];
      };
      waste_records: {
        Row: WasteRecordRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          ingredient_id: string;
          quantity_base_unit: number;
          reason_id?: string | null;
          occurred_at?: string;
          recorded_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["waste_records"]["Insert"]
        >;
        Relationships: [];
      };
      employee_positions: {
        Row: EmployeePositionRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["employee_positions"]["Insert"]
        >;
        Relationships: [];
      };
      employees: {
        Row: EmployeeRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          full_name: string;
          nickname?: string | null;
          position_id?: string | null;
          phone?: string | null;
          start_date?: string | null;
          employment_type?: string | null;
          wage_amount?: number | null;
          status?: EmployeeStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["employees"]["Insert"]>;
        Relationships: [];
      };
      projects: {
        Row: ProjectRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          description?: string | null;
          category?: string | null;
          status?: WorkStatus;
          start_date?: string | null;
          due_date?: string | null;
          budget?: number | null;
          owner_employee_id?: string | null;
          progress_percent?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      tasks: {
        Row: TaskRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          project_id?: string | null;
          name: string;
          description?: string | null;
          owner_employee_id?: string | null;
          due_date?: string | null;
          priority?: TaskPriority;
          status?: WorkStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [];
      };
      opening_checklist_categories: {
        Row: OpeningChecklistCategoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          name: string;
          sort_order?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["opening_checklist_categories"]["Insert"]
        >;
        Relationships: [];
      };
      opening_checklist_items: {
        Row: OpeningChecklistItemRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          category_id?: string | null;
          name: string;
          owner_employee_id?: string | null;
          due_date?: string | null;
          status?: ChecklistStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["opening_checklist_items"]["Insert"]
        >;
        Relationships: [];
      };
      alerts: {
        Row: AlertRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          alert_type: string;
          severity?: AlertSeverity;
          message: string;
          related_table?: string | null;
          related_id?: string | null;
          is_resolved?: boolean;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
        Relationships: [];
      };
      activity_logs: {
        Row: ActivityLogRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          actor_id?: string | null;
          action: string;
          entity_table: string;
          entity_id?: string | null;
          summary: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["activity_logs"]["Insert"]
        >;
        Relationships: [];
      };
      settings: {
        Row: SettingsRow;
        Insert: {
          restaurant_id: string;
          food_cost_threshold_percent?: number;
          data?: Record<string, unknown>;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["settings"]["Insert"]>;
        Relationships: [];
      };
      stock_counts: {
        Row: StockCountRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          ingredient_id: string;
          counted_quantity_base_unit: number;
          system_quantity_base_unit: number;
          counted_by?: string | null;
          counted_at?: string;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["stock_counts"]["Insert"]>;
        Relationships: [];
      };
      supplier_ingredients: {
        Row: SupplierIngredientRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          supplier_id: string;
          ingredient_id: string;
          latest_price?: number | null;
          last_purchase_date?: string | null;
          notes?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["supplier_ingredients"]["Insert"]
        >;
        Relationships: [];
      };
      menu_price_history: {
        Row: MenuPriceHistoryRow;
        Insert: {
          id?: string;
          restaurant_id: string;
          menu_item_id: string;
          selling_price: number;
          effective_from?: string;
          notes?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["menu_price_history"]["Insert"]
        >;
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
