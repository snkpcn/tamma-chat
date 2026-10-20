"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { StatusBadge } from "@/components/ui/badge";
import { ProjectForm } from "./project-form";
import { archiveProject, createProject, updateProject } from "@/server/projects";
import type { ProjectRow } from "@/types/database";

export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  const [modal, setModal] = useState<"create" | ProjectRow | null>(null);

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">โครงการ</h2>
        <button type="button" className="btn-primary" onClick={() => setModal("create")}>
          + เพิ่มโครงการ
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="ยังไม่มีโครงการ"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal("create")}>
              เพิ่มโครงการแรก
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อโครงการ</th>
                <th className="py-2 pr-4 font-medium">กำหนดเสร็จ</th>
                <th className="py-2 pr-4 font-medium">ความคืบหน้า</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">{p.name}</td>
                  <td className="py-2 pr-4 text-ink-light">{p.due_date ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-light">{p.progress_percent}%</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(p)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ยกเลิกโครงการ "${p.name}"?`}
                        onConfirm={() => archiveProject(p.id)}
                      >
                        ยกเลิก
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
        <Modal title={modal === "create" ? "เพิ่มโครงการ" : "แก้ไขโครงการ"} onClose={() => setModal(null)}>
          <ProjectForm
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createProject : updateProject.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
