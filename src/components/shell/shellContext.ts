"use client";

import { createContext, useContext } from "react";

/**
 * Shell-wide state the pages care about. Owner mode (spec §1) is the one that
 * matters to chat today: with it off, live-effect tools resolve to ask, and
 * with no approver wired they are blocked with the reason.
 */
export interface ShellState {
  ownerMode: boolean;
}

export const ShellContext = createContext<ShellState>({ ownerMode: true });

export function useShell(): ShellState {
  return useContext(ShellContext);
}
