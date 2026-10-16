"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { isActive, QUICK_ACCESS, RECENT_ITEMS } from "./nav";
import {
  formatTokens,
  meterFromSession,
  useSessionUsage,
  usedPercent,
} from "./tokenMeter";
import { formatUsd } from "@/core/models/config";

interface SidePanelProps {
  searchRef: RefObject<HTMLInputElement | null>;
}

export default function SidePanel({ searchRef }: SidePanelProps) {
  const pathname = usePathname();
  const meter = meterFromSession(useSessionUsage());
  const percent = usedPercent(meter);

  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r border-bd bg-s1 p-3 text-[12.5px] text-dim max-[760px]:hidden">
      <b className="text-[16px] text-tx">Quick access</b>

      <label className="relative flex items-center">
        <span className="sr-only">Search all pages</span>
        <Icon
          name="search"
          className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-faint"
        />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search all pages"
          className="w-full rounded-[9px] border border-bd bg-[#17191d] py-1.5 pl-8 pr-12 text-tx placeholder:text-faint focus:border-o5 focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 rounded border border-bd bg-s3 px-1.5 py-0.5 text-[10px] text-faint">
          Ctrl K
        </kbd>
      </label>

      <ul className="flex flex-col gap-1">
        {QUICK_ACCESS.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className={`block rounded-[7px] px-2 py-1 hover:bg-s4 hover:text-tx ${
                isActive(pathname, item.href) ? "text-tx" : ""
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-1 text-faint">Recently viewed</div>
      <ul className="flex flex-col gap-1">
        {RECENT_ITEMS.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="block rounded-[7px] px-2 py-1 hover:bg-s4 hover:text-tx"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-6">
        <div className="flex items-baseline justify-between gap-2">
          <span>Your tokens used</span>
          <b className="text-[12.5px] text-tx">
            {formatTokens(meter.yourUsed)} / {formatTokens(meter.yourLimit)}
          </b>
        </div>
        <div
          role="progressbar"
          aria-label="Your tokens used"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="my-1.5 h-[5px] overflow-hidden rounded-[9px] bg-s4"
        >
          <div
            className="h-full rounded-[9px] bg-o5"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="text-[11.5px]">
          {meter.runs} {meter.runs === 1 ? "run" : "runs"} this session ·{" "}
          {formatUsd(meter.costUsd)}
        </div>
      </div>
    </aside>
  );
}
