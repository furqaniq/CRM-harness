"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Rail from "./Rail";
import SidePanel from "./SidePanel";
import TopBar from "./TopBar";
import { titleFor } from "./nav";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(true);
  const [ownerMode, setOwnerMode] = useState(true);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setPanelOpen(true);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const columns = panelOpen
    ? "grid-cols-[64px_260px_minmax(0,1fr)] max-[760px]:grid-cols-[56px_minmax(0,1fr)]"
    : "grid-cols-[64px_minmax(0,1fr)] max-[760px]:grid-cols-[56px_minmax(0,1fr)]";

  return (
    <div className={`grid h-dvh overflow-hidden ${columns}`}>
      <Rail />

      {panelOpen && <SidePanel searchRef={searchRef} />}

      <div className="flex min-w-0 flex-col">
        <TopBar
          title={titleFor(pathname)}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
          ownerMode={ownerMode}
          onToggleOwnerMode={() => setOwnerMode((mode) => !mode)}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
