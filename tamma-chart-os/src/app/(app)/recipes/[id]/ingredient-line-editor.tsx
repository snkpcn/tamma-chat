"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  addRecipeIngredient,
  removeRecipeIngredient,
  reorderRecipeIngredient,
  updateRecipeIngredientQuantity,
  type ActionResult,
} from "@/server/recipes";
import type { IngredientRow } from "@/types/database";
import type { RecipeCostBreakdown } from "@/server/recipes";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "กำลังเพิ่ม..." : "+ เพิ่มวัตถุดิบ"}
    </button>
  );
}

function LineRow({
  line,
  recipeId,
  isFirst,
  isLast,
}: {
  line: RecipeCostBreakdown["lines"][number];
  recipeId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unit, setUnit] = useState(line.unit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-4">{line.ingredientName}</td>
      <td className="py-2 pr-4">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              className="field-input w-24"
              type="number"
              step="0.001"
              min="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <input
              className="field-input w-20"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        ) : (
          `${line.quantity} ${line.unit}`
        )}
        {error && <p className="field-error">{error}</p>}
      </td>
      <td className="py-2 pr-4">
        {line.missingPrice ? (
          <span className="text-gold-600">ยังไม่มีราคา</span>
        ) : (
          `${line.lineCost.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`
        )}
      </td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-3">
          {editing ? (
            <>
              <button
                type="button"
                className="text-forest-500 hover:underline"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const result = await updateRecipeIngredientQuantity(
                    line.id,
                    recipeId,
                    Number(quantity),
                    unit,
                  );
                  setSaving(false);
                  if (result.error) setError(result.error);
                  else setEditing(false);
                }}
              >
                บันทึก
              </button>
              <button type="button" className="text-ink-light hover:underline" onClick={() => setEditing(false)}>
                ยกเลิก
              </button>
            </>
          ) : (
            <>
              <button type="button" className="text-forest-500 hover:underline" onClick={() => setEditing(true)}>
                แก้ปริมาณ
              </button>
              <button
                type="button"
                className="text-ink-light hover:underline disabled:opacity-30"
                disabled={isFirst}
                onClick={() => reorderRecipeIngredient(line.id, recipeId, "up")}
              >
                ขึ้น
              </button>
              <button
                type="button"
                className="text-ink-light hover:underline disabled:opacity-30"
                disabled={isLast}
                onClick={() => reorderRecipeIngredient(line.id, recipeId, "down")}
              >
                ลง
              </button>
              <ConfirmButton
                className="text-red-600 hover:underline"
                confirmMessage={`ลบ "${line.ingredientName}" ออกจากสูตร?`}
                onConfirm={() => removeRecipeIngredient(line.id, recipeId)}
              >
                ลบ
              </ConfirmButton>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function IngredientLineEditor({
  recipeId,
  breakdown,
  ingredients,
}: {
  recipeId: string;
  breakdown: RecipeCostBreakdown;
  ingredients: IngredientRow[];
}) {
  const action = addRecipeIngredient.bind(null, recipeId);
  const [state, formAction] = useActionState(action, {} as ActionResult);

  return (
    <div className="space-y-4">
      {breakdown.lines.length === 0 ? (
        <p className="text-sm text-ink-light">ยังไม่มีวัตถุดิบในสูตรนี้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-light">
                <th className="py-2 pr-4 font-medium">วัตถุดิบ</th>
                <th className="py-2 pr-4 font-medium">ปริมาณ</th>
                <th className="py-2 pr-4 font-medium">ต้นทุน</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {breakdown.lines.map((line, i) => (
                <LineRow
                  key={line.id}
                  line={line}
                  recipeId={recipeId}
                  isFirst={i === 0}
                  isLast={i === breakdown.lines.length - 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <div>
          <label className="field-label" htmlFor="ingredient_id">
            วัตถุดิบ
          </label>
          <select id="ingredient_id" name="ingredient_id" className="field-input" defaultValue="">
            <option value="" disabled>
              เลือกวัตถุดิบ
            </option>
            {ingredients.map((ing) => (
              <option key={ing.id} value={ing.id}>
                {ing.name} ({ing.base_unit})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="quantity">
            ปริมาณ (หน่วยฐาน)
          </label>
          <input id="quantity" name="quantity" type="number" step="0.001" min="0.001" className="field-input w-28" />
        </div>
        <div>
          <label className="field-label" htmlFor="unit">
            หน่วย
          </label>
          <input id="unit" name="unit" className="field-input w-24" placeholder="เช่น กรัม" />
        </div>
        <AddButton />
      </form>
      {state.error && <p className="field-error">{state.error}</p>}
    </div>
  );
}
