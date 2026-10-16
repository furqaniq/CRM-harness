"use client";

import Link from "next/link";
import { Icon } from "./Icon";

const SHELL_USER = { name: "Furqan", initials: "F" };

interface TopBarProps {
  title: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  ownerMode: boolean;
  onToggleOwnerMode: () => void;
}

export default function TopBar({
  title,
  panelOpen,
  onTogglePanel,
  ownerMode,
  onToggleOwnerMode,
}: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-bd px-4 py-2.5 text-[12.5px] text-dim">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
          className="rounded-[7px] p-1.5 hover:bg-s4 hover:text-tx"
        >
          <Icon name="panel" />
        </button>
        <span className="truncate text-tx">{title}</span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="pill flex items-center gap-1.5 hover:text-tx">
          <Icon name="branch" className="h-3.5 w-3.5" />
          Default branch
          <Icon name="chevron" className="h-3 w-3 rotate-90" />
        </button>

        <button type="button" className="pill hover:text-tx" aria-label="Language: English">
          EN
        </button>

        <button
          type="button"
          onClick={onToggleOwnerMode}
          aria-pressed={ownerMode}
          className={`pill hover:text-tx ${ownerMode ? "border-[rgba(247,201,72,0.45)] text-y4" : ""}`}
        >
          Owner mode {ownerMode ? "on" : "off"}
        </button>

        <Link
          href="/settings"
          aria-label="Settings"
          className="grid h-7 w-7 place-items-center rounded-full bg-o5 text-[12px] font-extrabold text-[#1a1205] hover:bg-o4"
        >
          {SHELL_USER.initials}
        </Link>
      </div>
    </header>
  );
}
