export type IconKey =
  | "home"
  | "agents"
  | "skills"
  | "loops"
  | "mcp"
  | "models"
  | "runs"
  | "tests"
  | "settings"
  | "search"
  | "panel"
  | "chevron"
  | "clock"
  | "branch";

export interface NavItem {
  key: string;
  label: string;
  railLabel: string;
  href: string;
  icon: IconKey;
  title: string;
}

/** Rail order and destinations from spec section 1. */
export const NAV: NavItem[] = [
  { key: "home", label: "Chat", railLabel: "Home", href: "/", icon: "home", title: "Chat" },
  { key: "agents", label: "Agents", railLabel: "Agents", href: "/agents", icon: "agents", title: "Agents" },
  { key: "skills", label: "Skills", railLabel: "Skills", href: "/skills", icon: "skills", title: "Skills" },
  { key: "loops", label: "Loops and Routines", railLabel: "Loops", href: "/loops", icon: "loops", title: "Loops and Routines" },
  { key: "mcp", label: "MCP", railLabel: "MCP", href: "/mcp", icon: "mcp", title: "MCP" },
  { key: "models", label: "Providers", railLabel: "Models", href: "/providers", icon: "models", title: "Providers" },
  { key: "runs", label: "Runs", railLabel: "Runs", href: "/runs", icon: "runs", title: "Runs" },
  { key: "tests", label: "Test Lab", railLabel: "Tests", href: "/tests", icon: "tests", title: "Test Lab" },
  { key: "settings", label: "Settings", railLabel: "Settings", href: "/settings", icon: "settings", title: "Settings" },
];

export const RAIL_NAV = NAV.filter((item) => item.key !== "settings");

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function titleFor(pathname: string): string {
  const match = [...NAV].reverse().find((item) => isActive(pathname, item.href));
  return match?.title ?? "Maple Harness";
}

/** Panel sections from spec section 1: quick access and recently viewed. */
export const QUICK_ACCESS = [
  { label: "Chat", href: "/" },
  { label: "Agents", href: "/agents" },
  { label: "Routines", href: "/loops" },
];

export const RECENT_ITEMS = [
  { label: "Morning check", href: "/loops" },
  { label: "Leads agent", href: "/agents" },
];
