"use client";

import { useState, useTransition } from "react";

export function ConfirmButton({
  onConfirm,
  confirmMessage,
  className,
  children,
}: {
  onConfirm: () => Promise<{ error?: string } | void>;
  confirmMessage: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={isPending}
        className={className}
        onClick={() => {
          if (!window.confirm(confirmMessage)) return;
          setError(null);
          startTransition(async () => {
            const result = await onConfirm();
            if (result?.error) setError(result.error);
          });
        }}
      >
        {isPending ? "กำลังดำเนินการ..." : children}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
