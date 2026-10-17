import { NextResponse } from "next/server";
import { loadAgentCatalog } from "@/core/agents/files";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ agents: await loadAgentCatalog(), dir: "agents/" });
}
