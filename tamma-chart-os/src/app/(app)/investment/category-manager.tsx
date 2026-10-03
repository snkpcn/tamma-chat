"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  archiveInvestmentCategory,
  createInvestmentCategory,
  renameInvestmentCategory,
  type ActionResult,
} from "@/server/investments";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { InvestmentCategoryRow } from "@/types/database";

function AddCategoryButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary shrink-0" disabled={pending}>
      {pending ? "กำลังเพิ่ม..." : "+ เพิ่มหมวดหมู่"}
    </button>
  );
}

function CategoryRow({ category }: { category: InvestmentCategoryRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-1.5">
        <input
          className="field-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const result = await renameInvestmentCategory(category.id, name);
            setSaving(false);
            if (result.error) setError(result.error);
            else setEditing(false);
          }}
        >
          บันทึก
        </button>
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
          ยกเลิก
        </button>
        {error && <span className="field-error">{error}</span>}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-ink">{category.name}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="text-sm text-forest-500 hover:underline"
          onClick={() => setEditing(true)}
        >
          แก้ไข
        </button>
        <ConfirmButton
          className="text-sm text-red-600 hover:underline"
          confirmMessage={`ลบหมวดหมู่ "${category.name}"?`}
          onConfirm={() => archiveInvestmentCategory(category.id)}
        >
          ลบ
        </ConfirmButton>
      </div>
    </li>
  );
}

export function CategoryManager({
  categories,
}: {
  categories: InvestmentCategoryRow[];
}) {
  const [state, formAction] = useActionState(
    createInvestmentCategory,
    {} as ActionResult,
  );

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-base font-semibold text-ink">หมวดหมู่การลงทุน</h2>
      {categories.length === 0 ? (
        <p className="mb-3 text-sm text-ink-light">ยังไม่มีหมวดหมู่</p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </ul>
      )}
      <form action={formAction} className="flex items-start gap-2">
        <div className="flex-1">
          <input
            name="name"
            placeholder="ชื่อหมวดหมู่ใหม่"
            className="field-input"
          />
          {state.error && <p className="field-error">{state.error}</p>}
        </div>
        <AddCategoryButton />
      </form>
    </div>
  );
}
