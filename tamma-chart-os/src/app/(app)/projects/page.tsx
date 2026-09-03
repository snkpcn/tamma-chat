import { listProjects, listTasks } from "@/server/projects";
import {
  archiveOpeningChecklistCategory,
  createOpeningChecklistCategory,
  listOpeningChecklistCategories,
  listOpeningChecklistItems,
  renameOpeningChecklistCategory,
} from "@/server/opening-checklist";
import { NoRestaurantError } from "@/server/restaurant";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { SimpleListManager } from "@/components/simple-list-manager";
import { ProjectsTable } from "./projects-table";
import { TasksTable } from "./tasks-table";
import { ChecklistSection } from "./checklist-section";
import type {
  OpeningChecklistCategoryRow,
  OpeningChecklistItemRow,
  ProjectRow,
  TaskRow,
} from "@/types/database";

export default async function ProjectsPage() {
  let projects: ProjectRow[] = [];
  let tasks: TaskRow[] = [];
  let checklistCategories: OpeningChecklistCategoryRow[] = [];
  let checklistItems: OpeningChecklistItemRow[] = [];
  let setupError: string | null = null;

  try {
    [projects, tasks, checklistCategories, checklistItems] = await Promise.all([
      listProjects(),
      listTasks(),
      listOpeningChecklistCategories(),
      listOpeningChecklistItems(),
    ]);
  } catch (err) {
    if (err instanceof NoRestaurantError) setupError = err.message;
    else throw err;
  }

  if (setupError) return <EmptyState title={setupError} />;

  const completed = checklistItems.filter((i) => i.status === "เสร็จแล้ว").length;
  const readinessPercent = checklistItems.length > 0 ? (completed / checklistItems.length) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">งาน/โปรเจกต์</h1>
        <p className="text-sm text-ink-light">จัดการโครงการ งาน และเช็กลิสต์ก่อนเปิดร้าน</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="ความพร้อมก่อนเปิดร้าน" value={`${readinessPercent.toFixed(0)}%`} />
        <StatCard label="เช็กลิสต์เสร็จแล้ว" value={`${completed} / ${checklistItems.length}`} />
        <StatCard
          label="งานที่เลยกำหนด"
          value={String(
            tasks.filter(
              (t) =>
                t.due_date &&
                t.status !== "เสร็จแล้ว" &&
                t.status !== "ยกเลิก" &&
                new Date(t.due_date) < new Date(new Date().toDateString()),
            ).length,
          )}
        />
      </div>

      <ProjectsTable projects={projects} />
      <TasksTable tasks={tasks} projects={projects} />

      <section className="card p-5">
        <h2 className="mb-4 text-base font-semibold text-ink">เช็กลิสต์ก่อนเปิดร้าน</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <ChecklistSection items={checklistItems} categories={checklistCategories} />
          <SimpleListManager
            title="หมวดเช็กลิสต์"
            items={checklistCategories}
            createAction={createOpeningChecklistCategory}
            onRename={renameOpeningChecklistCategory}
            onArchive={archiveOpeningChecklistCategory}
            emptyLabel="ยังไม่มีหมวด"
            placeholder="ชื่อหมวดใหม่"
          />
        </div>
      </section>
    </div>
  );
}
