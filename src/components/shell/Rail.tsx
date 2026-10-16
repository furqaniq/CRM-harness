"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { isActive, RAIL_NAV } from "./nav";

export default function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="flex flex-col items-center gap-1 overflow-y-auto border-r border-bd bg-s3 py-3 text-[10px] text-dim"
    >
      <Link
        href="/"
        onClick={onNavigate}
        aria-label="Maple Harness home"
        className="mb-2 grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-o5 text-[16px] font-extrabold text-[#1a1205]"
      >
        M
      </Link>

      {RAIL_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex w-[52px] flex-col items-center gap-0.5 rounded-[9px] px-1 py-1.5 transition-colors ${
              active ? "bg-[rgba(240,152,48,0.16)] text-o3" : "hover:bg-s4 hover:text-tx"
            }`}
          >
            <Icon name={item.icon} className="h-4 w-4" />
            <span className="truncate">{item.railLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
