"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SupplierForm } from "./supplier-form";
import { archiveSupplier, createSupplier, updateSupplier } from "@/server/suppliers";
import type { SupplierRow } from "@/types/database";

export function SuppliersTable({ suppliers }: { suppliers: SupplierRow[] }) {
  const [modal, setModal] = useState<"create" | SupplierRow | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contact_name ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q),
    );
  }, [suppliers, query]);

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">ผู้ขาย / ซัพพลายเออร์</h2>
        <div className="flex items-center gap-2">
          <input
            className="field-input w-48"
            placeholder="ค้นหาผู้ขาย..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => setModal("create")}>
            + เพิ่มผู้ขาย
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={suppliers.length === 0 ? "ยังไม่มีผู้ขาย" : "ไม่พบผู้ขายที่ค้นหา"}
          action={
            suppliers.length === 0 ? (
              <button type="button" className="btn-primary" onClick={() => setModal("create")}>
                เพิ่มผู้ขายแรก
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">ชื่อผู้ขาย</th>
                <th className="py-2 pr-4 font-medium">ประเภท</th>
                <th className="py-2 pr-4 font-medium">ผู้ติดต่อ</th>
                <th className="py-2 pr-4 font-medium">เบอร์โทร</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">{s.name}</td>
                  <td className="py-2 pr-4 text-ink-light">{s.supplier_type ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-light">{s.contact_name ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-light">{s.phone ?? "—"}</td>
                  <td className="py-2 pr-4">{s.status}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-forest-500 hover:underline" onClick={() => setModal(s)}>
                        แก้ไข
                      </button>
                      <ConfirmButton
                        className="text-red-600 hover:underline"
                        confirmMessage={`ปิดใช้งานผู้ขาย "${s.name}"?`}
                        onConfirm={() => archiveSupplier(s.id)}
                      >
                        ปิดใช้งาน
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
        <Modal title={modal === "create" ? "เพิ่มผู้ขาย" : "แก้ไขผู้ขาย"} onClose={() => setModal(null)}>
          <SupplierForm
            initial={modal === "create" ? undefined : modal}
            action={modal === "create" ? createSupplier : updateSupplier.bind(null, modal.id)}
            onDone={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}
