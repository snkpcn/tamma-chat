"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { WORK_STATUSES, type ProjectRow, type TaskRow, type WorkStatus } from "@/types/database";
import { TaskForm } from "./task-form";
import { createTask, deleteTask, setTaskStatus, updateTask } from "@/server/projects";

const PRIORITY_TONE: Record<string, string> = {
  ต่ำ: "text-ink-light",
  ปกติ: "text-ink",
  สูง: "text-gold-600 font-medium",
  เร่งด่วน: "text-red-600 font-medium",
};

function isOverdue(task: TaskRow) {
  if (!task.due_date) return false;
  if (task.status === "เสร็จแล้ว" || task.status === "ยกเลิก") return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

export function TasksTable({
  tasks,
  projects,
}: {
  tasks: TaskRow[];
  projects: ProjectRow[];
}) {
  const [modal, setModal] = useState<"create" | TaskRow | null>(null);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">งาน</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มงาน
        </button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="ยังไม่มีงาน"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มงานแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่องาน</th>
                <th className="py-2 pr-4 font-medium">โครงการ</th>
                <th className="py-2 pr-4 font-medium">กำหนดวัน</th>
                <th className="py-2 pr-4 font-medium">ความสำคัญ</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">{t.name}</td>
                  <td className="py-2 pr-4 text-ink-light">
                    {t.project_id ? projectName.get(t.project_id) ?? "—" : "—"}
                  </td>
                  <td className={`py-2 pr-4 ${isOverdue(t) ? "font-medium text-red-600" : "text-ink-light"}`}>
                    {t.due_date ?? "—"}
                    {isOverdue(t) && " (เลยกำหนด)"}
                  </td>
                  <td className={`py-2 pr-4 ${PRIORITY_TONE[t.priority] ?? ""}`}>{t.priority}</td>
                  <td className="py-2 pr-4">
                    <select
                      className="field-input w-32"
                      value={t.status}
                      onChange={(e) => setTaskStatus(t.id, e.target.value as WorkStatus)}
                    >
                      {WORK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(t)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ลบงาน "${t.name}"?`}
                        onConfirm={() => deleteTask(t.id)}
                      >
                        ลบ
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === "create" ? "เพิ่มงาน" : "แก้ไขงาน"} onClose={() => setModal(null)}>
          <TaskForm
            projects={projects}
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createTask : updateTask.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
