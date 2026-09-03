import { listInvestmentCategories, listInvestments } from "@/server/investments";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoryManager } from "./category-manager";
import { InvestmentsTable } from "./investments-table";
import type { InvestmentCategoryRow, InvestmentRow } from "@/types/database";

export default async function InvestmentPage() {
  let categories: InvestmentCategoryRow[] = [];
  let investments: InvestmentRow[] = [];
  let setupError: string | null = null;

  try {
    [categories, investments] = await Promise.all([
      listInvestmentCategories(),
      listInvestments(),
    ]);
  } catch (err) {
    if (err instanceof NoRestaurantError) {
      setupError = err.message;
    } else {
      throw err;
    }
  }

  if (setupError) {
    return <EmptyState title={setupError} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">การลงทุน</h1>
        <p className="text-sm text-ink-light">
          บันทึกและติดตามรายการลงทุนก่อนเปิดร้านและระหว่างดำเนินกิจการ
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <InvestmentsTable investments={investments} categories={categories} />
        <CategoryManager categories={categories} />
      </div>
    </div>
  );
}

