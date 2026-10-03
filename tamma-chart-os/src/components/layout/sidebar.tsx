"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/investment", label: "การลงทุน" },
  { href: "/recipes", label: "สูตรอาหาร" },
  { href: "/ingredients", label: "ต้นทุนวัตถุดิบ" },
  { href: "/stock", label: "สต๊อก" },
  { href: "/menu", label: "เมนูอาหาร" },
  { href: "/personnel", label: "บุคลากร" },
  { href: "/projects", label: "งาน/โปรเจกต์" },
  { href: "/reports", label: "รายงาน" },
  { href: "/settings", label: "ตั้งค่า" },
] as const;

const SECONDARY_ITEMS = [{ href: "/suppliers", label: "ผู้ขาย / ซัพพลายเออร์" }] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
        isActive
          ? "bg-forest-500 text-white"
          : "text-cream-100/90 hover:bg-forest-600"
      }`}
    >
      {label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-forest-700 px-3 py-5">
      <div className="mb-6 px-3">
        <p className="text-lg font-semibold text-white">ตำมา-ชาติ OS</p>
        <p className="text-xs text-cream-100/70">ระบบหลังบ้านร้านอาหาร</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className="my-3 h-px bg-forest-600" />
        {SECONDARY_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>
    </aside>
  );
}
