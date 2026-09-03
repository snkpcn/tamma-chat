"use client";

export function ExportCsvButton({
  filename,
  csv,
}: {
  filename: string;
  csv: string;
}) {
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => {
        const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }}
    >
      ส่งออก CSV
    </button>
  );
}
