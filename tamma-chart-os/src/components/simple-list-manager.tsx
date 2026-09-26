"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmButton } from "@/components/ui/confirm-button";

export type SimpleActionResult = { error?: string };

function AddButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary shrink-0" disabled={pending}>
      {pending ? "กำลังเพิ่ม..." : label}
    </button>
  );
}

function Row({
  item,
  onRename,
  onArchive,
  confirmMessage,
}: {
  item: { id: string; name: string };
  onRename: (id: string, name: string) => Promise<SimpleActionResult>;
  onArchive: (id: string) => Promise<SimpleActionResult>;
  confirmMessage: (name: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
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
            const result = await onRename(item.id, name);
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
      <span className="text-sm text-ink">{item.name}</span>
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
          confirmMessage={confirmMessage(item.name)}
          onConfirm={() => onArchive(item.id)}
        >
          ลบ
        </ConfirmButton>
      </div>
    </li>
  );
}

export function SimpleListManager({
  title,
  items,
  createAction,
  onRename,
  onArchive,
  emptyLabel = "ยังไม่มีรายการ",
  placeholder = "ชื่อรายการใหม่",
  addLabel = "+ เพิ่ม",
  confirmMessage = (name: string) => `ลบ "${name}"?`,
}: {
  title: string;
  items: Array<{ id: string; name: string }>;
  createAction: (
    prev: SimpleActionResult,
    formData: FormData,
  ) => Promise<SimpleActionResult>;
  onRename: (id: string, name: string) => Promise<SimpleActionResult>;
  onArchive: (id: string) => Promise<SimpleActionResult>;
  emptyLabel?: string;
  placeholder?: string;
  addLabel?: string;
  confirmMessage?: (name: string) => string;
}) {
  const [state, formAction] = useActionState(createAction, {} as SimpleActionResult);

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="mb-3 text-sm text-ink-light">{emptyLabel}</p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onRename={onRename}
              onArchive={onArchive}
              confirmMessage={confirmMessage}
            />
          ))}
        </ul>
      )}
      <form action={formAction} className="flex items-start gap-2">
        <div className="flex-1">
          <input name="name" placeholder={placeholder} className="field-input" />
          {state.error && <p className="field-error">{state.error}</p>}
        </div>
        <AddButton label={addLabel} />
      </form>
    </div>
  );
}
