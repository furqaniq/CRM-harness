"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentEntry } from "@/core/agents/files";

interface ApiResponse {
  agents: AgentEntry[];
  dir: string;
}

export default function AgentsWorkspace() {
  const [agents, setAgents] = useState<AgentEntry[] | null>(null);
  const [dir, setDir] = useState("agents/");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/agents", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the agents folder.");
        return response.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        setAgents(data.agents);
        setDir(data.dir);
        setSelected((current) => current ?? data.agents.find((agent) => agent.valid)?.name ?? null);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Could not load the agents folder.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="note text-[13px] text-bad">{loadError}</p>
      </div>
    );
  }

  if (!agents) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="text-[13.5px] text-dim">Loading agents…</p>
      </div>
    );
  }

  const active = agents.find((agent) => agent.name === selected) ?? null;
  const valid = agents.filter((agent) => agent.valid).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-6">
        <h1 className="text-[22px] font-semibold text-tx">Agents</h1>
        <p className="mt-1 max-w-[78ch] text-[13.5px] text-dim">
          Specialists stored as files in <span className="font-mono text-tx">{dir}</span> — name,
          model role, tool globs, skills, limits and policy, then the prompt body.
          <span className="text-faint"> {valid} of {agents.length} load.</span>
        </p>
        <p className="note mt-2 text-[12.5px] text-faint">
          Read-only here: edit an agent&apos;s AGENT.md and the chat reloads it on the next request.
        </p>
      </div>

      <div className="mt-5 grid min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-8 md:grid-cols-[280px_1fr]">
        <ul className="min-h-0 overflow-y-auto">
          {agents.map((agent) => (
            <li key={agent.name} className="mb-2">
              <button
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  selected === agent.name ? "border-o5/60 bg-s2" : "border-bd bg-s1"
                }`}
                onClick={() => setSelected(agent.name)}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${agent.valid ? "bg-ok" : "bg-bad"}`}
                    aria-hidden
                  />
                  <span className="text-[13px] text-tx">{agent.displayName || agent.name}</span>
                  <span className="ml-auto pill">{agent.modelRole}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11.5px] text-faint">
                  {agent.name}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-h-0 overflow-y-auto">
          {active === null ? (
            <p className="text-[13.5px] text-dim">Pick an agent to inspect its file.</p>
          ) : (
            <div className="grid gap-4 rounded-xl border border-bd bg-s2 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16px] font-semibold text-tx">{active.displayName || active.name}</h2>
                  <span className="font-mono text-[12px] text-faint">{active.name}</span>
                  <span className="pill">{active.modelRole}</span>
                  {active.canSpawn && <span className="pill border-o5/60 text-o5">can spawn</span>}
                  {!active.valid && <span className="pill border-bad/50 text-bad">not loading</span>}
                </div>
                <p className="mt-1 text-[13px] text-dim">{active.description}</p>
              </div>

              {active.errors.map((error) => (
                <p key={error} className="text-[12.5px] text-bad">
                  {error}
                </p>
              ))}
              {active.warnings.map((warning) => (
                <p key={warning} className="text-[12.5px] text-y4">
                  {warning}
                </p>
              ))}

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-faint">Tools</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {active.toolGlobs.length === 0 ? (
                      <span className="text-[12.5px] text-dim">none</span>
                    ) : (
                      active.toolGlobs.map((glob) => (
                        <span key={glob} className="pill font-mono">
                          {glob}
                        </span>
                      ))
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-faint">Skills</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {active.skills.length === 0 ? (
                      <span className="text-[12.5px] text-dim">none</span>
                    ) : (
                      active.skills.map((skill) => (
                        <span key={skill} className="pill font-mono">
                          {skill}
                        </span>
                      ))
                    )}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-faint">Policy</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(active.policy).length === 0 ? (
                      <span className="text-[12.5px] text-dim">workspace defaults</span>
                    ) : (
                      Object.entries(active.policy).map(([className, mode]) => (
                        <span key={className} className="pill">
                          {className}: {mode}
                        </span>
                      ))
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-faint">Limits</p>
                  <p className="mt-1 text-[12.5px] text-dim">
                    {Object.entries(active.limits).length === 0
                      ? "run defaults"
                      : Object.entries(active.limits)
                          .map(([key, value]) => `${key} ${value.toLocaleString("en-US")}`)
                          .join(" · ")}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[12px] uppercase tracking-wide text-faint">Prompt body</p>
                <pre className="mt-1 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-bd bg-s1 p-3 font-mono text-[12.5px] text-tx">
                  {active.body || "—"}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
