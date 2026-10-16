"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpSnapshot, McpServerView, TestResult, CallResult } from "@/core/mcp/manager";
import type { McpTransportKind } from "@/core/mcp/types";
import { TOOL_CLASSES, type ToolClass } from "@/core/tools/classify";
import type { ToolEntry } from "@/core/tools/registry";
import {
  EMPTY_SERVER_FORM,
  argSkeleton,
  buildServerConfig,
  parseToolArgs,
  statusDotClass,
  statusLabel,
  type ServerForm,
} from "./form";

const CLASS_STYLE: Record<ToolClass, string> = {
  read: "text-ok border-ok/40",
  write: "text-info border-info/40",
  "live-effect": "text-y4 border-y4/40",
  destructive: "text-bad border-bad/40",
};

interface ApiResponse {
  error?: string;
  snapshot?: McpSnapshot;
  result?: unknown;
  added?: string[];
  entry?: ToolEntry;
}

async function callApi(payload: unknown): Promise<ApiResponse> {
  const response = await fetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(data.error ?? "That request could not be completed.");
  return data;
}

export default function McpWorkspace() {
  const [snapshot, setSnapshot] = useState<McpSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ServerForm>(EMPTY_SERVER_FORM);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [consoleKey, setConsoleKey] = useState("");
  const [consoleArgs, setConsoleArgs] = useState("{}");
  const [consoleResult, setConsoleResult] = useState<CallResult | null>(null);
  const [consoleBusy, setConsoleBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/mcp", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the MCP servers.");
        return response.json() as Promise<McpSnapshot>;
      })
      .then((data) => {
        setSnapshot(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Could not load the MCP servers.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label: string, payload: unknown, onSuccess?: (data: ApiResponse) => void) {
    setBusy(label);
    setNotice(null);
    try {
      const data = await callApi(payload);
      if (data.snapshot) setSnapshot(data.snapshot);
      onSuccess?.(data);
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "That request failed." });
    } finally {
      setBusy(null);
    }
  }

  function testServer(server: McpServerView, discover: boolean) {
    void run(`${discover ? "discover" : "test"}:${server.config.id}`, {
      action: discover ? "discover" : "test",
      serverId: server.config.id,
    }, (data) => {
      const result = data.result as TestResult;
      setNotice({ tone: result.ok ? "ok" : "bad", text: result.message });
    });
  }

  async function submitServer() {
    setBusy("add");
    setNotice(null);
    try {
      const config = buildServerConfig(form, (snapshot?.servers ?? []).map((server) => server.config.id));
      const data = await callApi({ action: "add", config });
      if (data.snapshot) setSnapshot(data.snapshot);
      setForm(EMPTY_SERVER_FORM);
      setFormOpen(false);
      setNotice({ tone: "ok", text: `${config.name} added. Run Test to connect and Discover to list its tools.` });
    } catch (error) {
      setNotice({ tone: "bad", text: error instanceof Error ? error.message : "That server could not be added." });
    } finally {
      setBusy(null);
    }
  }

  async function submitImport() {
    await run("import", { action: "import", json: importText }, (data) => {
      setImportText("");
      setImportOpen(false);
      setNotice({ tone: "ok", text: `Imported ${(data.added ?? []).join(", ")}.` });
    });
  }

  async function callSelectedTool() {
    const entry = (snapshot?.tools ?? []).find((tool) => tool.key === consoleKey);
    if (!entry) return;
    setConsoleBusy(true);
    setNotice(null);
    try {
      const args = parseToolArgs(consoleArgs);
      const data = await callApi({
        action: "call",
        serverId: entry.serverId,
        toolName: entry.toolName,
        args,
      });
      setConsoleResult(data.result as CallResult);
    } catch (error) {
      setConsoleResult({
        ok: false,
        text: error instanceof Error ? error.message : "That call failed.",
        isError: true,
      });
    } finally {
      setConsoleBusy(false);
    }
  }

  function selectConsoleTool(key: string) {
    setConsoleKey(key);
    setConsoleResult(null);
    const entry = (snapshot?.tools ?? []).find((tool) => tool.key === key);
    setConsoleArgs(argSkeleton(entry?.inputSchema));
  }

  const tools = snapshot?.tools ?? [];
  const selectedTool: ToolEntry | null = tools.find((tool) => tool.key === consoleKey) ?? null;

  if (loadError) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="note text-[13px] text-bad">{loadError}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6">
        <p className="text-[13.5px] text-dim">Loading MCP servers…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 px-5 pt-6">
        <div>
          <h1 className="text-[22px] font-semibold text-tx">MCP servers</h1>
          <p className="mt-1 max-w-[78ch] text-[13.5px] text-dim">
            Tool servers over stdio, streamable HTTP and legacy SSE. Test a connection, discover its
            tools, class them for policy and try one by hand.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="pill" onClick={() => { setImportOpen(!importOpen); setFormOpen(false); }}>
            Import .mcp.json
          </button>
          <button
            type="button"
            className="pill border-o5/60 text-o5"
            onClick={() => { setFormOpen(!formOpen); setImportOpen(false); }}
          >
            Add server
          </button>
        </div>
      </div>

      {notice && (
        <div className="mx-5 mt-4">
          <p className={`note text-[13px] ${notice.tone === "ok" ? "text-ok" : "text-bad"}`} role="status">
            {notice.text}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {formOpen && (
          <ServerFormPanel
            form={form}
            onChange={setForm}
            busy={busy === "add"}
            onSubmit={() => void submitServer()}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {importOpen && (
          <div className="mt-4 rounded-xl border border-bd bg-s2 p-4">
            <label className="block text-[13px] text-dim" htmlFor="mcp-import">
              Paste a .mcp.json file
            </label>
            <textarea
              id="mcp-import"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={7}
              spellCheck={false}
              placeholder={'{ "mcpServers": { "My server": { "command": "node", "args": ["server.mjs"] } } }'}
              className="mt-2 w-full rounded-lg border border-bd bg-s1 p-3 font-mono text-[12.5px] text-tx placeholder:text-faint"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="pill border-o5/60 text-o5 disabled:opacity-50"
                disabled={busy === "import" || importText.trim() === ""}
                onClick={() => void submitImport()}
              >
                {busy === "import" ? "Importing…" : "Import"}
              </button>
              <button type="button" className="pill" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <ul className="mt-5 grid gap-3">
          {(snapshot?.servers ?? []).map((server) => (
            <li key={server.config.id} className="rounded-xl border border-bd bg-s2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(server.status.state)}`} aria-hidden />
                <span className="text-[15px] font-semibold text-tx">{server.config.name}</span>
                <span className="pill">{server.config.transport}</span>
                <span className="pill">{statusLabel(server.status.state)}</span>
                {server.status.toolCount !== undefined && (
                  <span className="pill">{server.status.toolCount} tools</span>
                )}
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="pill disabled:opacity-50"
                    disabled={busy !== null || server.status.state === "disabled"}
                    onClick={() => testServer(server, false)}
                  >
                    {busy === `test:${server.config.id}` ? "Testing…" : "Test"}
                  </button>
                  <button
                    type="button"
                    className="pill disabled:opacity-50"
                    disabled={busy !== null || server.status.state === "disabled"}
                    onClick={() => testServer(server, true)}
                  >
                    {busy === `discover:${server.config.id}` ? "Discovering…" : "Discover"}
                  </button>
                  <button
                    type="button"
                    className="pill disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("toggle", {
                        action: "update",
                        serverId: server.config.id,
                        patch: { enabled: !server.config.enabled },
                      })
                    }
                  >
                    {server.config.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="pill text-bad disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("remove", { action: "remove", serverId: server.config.id }, () =>
                        setNotice({ tone: "ok", text: `${server.config.name} removed.` }),
                      )
                    }
                  >
                    Remove
                  </button>
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-dim">
                <span className="font-mono">
                  {server.config.transport === "stdio"
                    ? `${server.config.command} ${(server.config.args ?? []).join(" ")}`
                    : server.config.url}
                </span>
                <span>auth: {server.config.auth.type}</span>
                {server.config.enabled && server.status.state === "disabled" && <span>—</span>}
              </div>

              {server.status.message && (
                <p className={`mt-2 text-[12.5px] ${server.status.state === "error" ? "text-bad" : "text-faint"}`}>
                  {server.status.message}
                </p>
              )}
              {server.config.note && server.config.note !== server.status.message && (
                <p className="mt-1 text-[12.5px] text-faint">{server.config.note}</p>
              )}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-[15px] font-semibold text-tx">
          Tools <span className="text-faint">({tools.length})</span>
        </h2>
        {tools.length === 0 ? (
          <p className="mt-2 text-[13.5px] text-dim">
            No tools discovered yet — run <span className="text-tx">Discover</span> on a server.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-bd">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-bd bg-s2 text-[12px] uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Server</th>
                  <th className="px-3 py-2 font-medium">Display label</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Verify with</th>
                  <th className="px-3 py-2 text-right font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr key={tool.key} className="border-b border-bd/60 last:border-b-0">
                    <td className="px-3 py-2 font-mono text-tx">
                      {tool.toolName}
                      {tool.description && (
                        <span className="ml-2 font-sans text-[12px] text-faint">{tool.description}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-dim">{tool.serverName}</td>
                    <td className="px-3 py-2">
                      <input
                        key={`label-${tool.key}`}
                        defaultValue={tool.label}
                        onBlur={(event) => {
                          const label = event.currentTarget.value;
                          if (label !== tool.label) {
                            void run(`label:${tool.key}`, {
                              action: "setTool",
                              key: tool.key,
                              patch: { label },
                            });
                          }
                        }}
                        className="w-40 rounded-md border border-bd bg-s1 px-2 py-1 text-[12.5px] text-tx"
                        aria-label={`Display label for ${tool.toolName}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={tool.className}
                        onChange={(event) =>
                          void run(`class:${tool.key}`, {
                            action: "setTool",
                            key: tool.key,
                            patch: { className: event.target.value as ToolClass },
                          })
                        }
                        className={`rounded-md border bg-s1 px-2 py-1 text-[12.5px] ${CLASS_STYLE[tool.className]}`}
                        aria-label={`Class for ${tool.toolName}`}
                      >
                        {TOOL_CLASSES.map((className) => (
                          <option key={className} value={className}>
                            {className}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        key={`verify-${tool.key}`}
                        defaultValue={tool.verifyWith ?? ""}
                        placeholder="test id"
                        onBlur={(event) => {
                          const verifyWith = event.currentTarget.value;
                          if (verifyWith !== (tool.verifyWith ?? "")) {
                            void run(`verify:${tool.key}`, {
                              action: "setTool",
                              key: tool.key,
                              patch: { verifyWith: verifyWith === "" ? null : verifyWith },
                            });
                          }
                        }}
                        className="w-28 rounded-md border border-bd bg-s1 px-2 py-1 font-mono text-[12px] text-tx placeholder:text-faint"
                        aria-label={`Verify ${tool.toolName} with`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="checkbox"
                        checked={tool.enabled}
                        onChange={(event) =>
                          void run(`enable:${tool.key}`, {
                            action: "setTool",
                            key: tool.key,
                            patch: { enabled: event.target.checked },
                          })
                        }
                        aria-label={`Enable ${tool.toolName}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 className="mt-8 text-[15px] font-semibold text-tx">Tool console</h2>
        <p className="mt-1 text-[13px] text-dim">
          Call one tool by hand to see exactly what it returns — arguments are a JSON object.
        </p>
        <div className="mt-3 rounded-xl border border-bd bg-s2 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[12.5px] text-dim">
              Tool
              <select
                value={consoleKey}
                onChange={(event) => selectConsoleTool(event.target.value)}
                className="min-w-64 rounded-md border border-bd bg-s1 px-2 py-1.5 font-mono text-[12.5px] text-tx"
              >
                <option value="">Choose a tool…</option>
                {tools.map((tool) => (
                  <option key={tool.key} value={tool.key}>
                    {tool.serverName} · {tool.toolName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="pill border-o5/60 text-o5 disabled:opacity-50"
              disabled={!selectedTool || consoleBusy}
              onClick={() => void callSelectedTool()}
            >
              {consoleBusy ? "Calling…" : "Call tool"}
            </button>
          </div>

          <textarea
            value={consoleArgs}
            onChange={(event) => setConsoleArgs(event.target.value)}
            rows={6}
            spellCheck={false}
            aria-label="Tool arguments"
            className="mt-3 w-full rounded-lg border border-bd bg-s1 p-3 font-mono text-[12.5px] text-tx"
          />

          {consoleResult && (
            <div className={`mt-3 rounded-lg border p-3 ${consoleResult.ok ? "border-bd" : "border-bad/50"}`}>
              <p className={`text-[12.5px] ${consoleResult.ok ? "text-ok" : "text-bad"}`}>
                {consoleResult.ok ? "Call succeeded." : "Call failed."}
              </p>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{consoleResult.text}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ServerFormPanel({
  form,
  onChange,
  busy,
  onSubmit,
  onCancel,
}: {
  form: ServerForm;
  onChange: (form: ServerForm) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const field = "rounded-md border border-bd bg-s1 px-2 py-1.5 text-[13px] text-tx placeholder:text-faint";
  const label = "flex flex-col gap-1 text-[12.5px] text-dim";

  function patch(next: Partial<ServerForm>) {
    onChange({ ...form, ...next });
  }

  return (
    <div className="mt-4 rounded-xl border border-bd bg-s2 p-4">
      <h2 className="text-[15px] font-semibold text-tx">Add a server</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Name
          <input className={field} value={form.name} onChange={(event) => patch({ name: event.target.value })} placeholder="Production CRM" />
        </label>
        <label className={label}>
          Transport
          <select
            className={field}
            value={form.transport}
            onChange={(event) => patch({ transport: event.target.value as McpTransportKind })}
          >
            <option value="http">streamable HTTP</option>
            <option value="sse">legacy SSE</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
        <label className={label}>
          {form.transport === "stdio" ? "Command" : "URL"}
          <input
            className={field}
            value={form.endpoint}
            onChange={(event) => patch({ endpoint: event.target.value })}
            placeholder={form.transport === "stdio" ? "node server.mjs" : "https://crm.example/mcp"}
          />
        </label>
        {form.transport === "stdio" && (
          <label className={label}>
            Arguments
            <input
              className={field}
              value={form.args}
              onChange={(event) => patch({ args: event.target.value })}
              placeholder="--port 1234"
            />
          </label>
        )}
        <label className={label}>
          Auth
          <select
            className={field}
            value={form.authType}
            onChange={(event) => patch({ authType: event.target.value as ServerForm["authType"] })}
          >
            <option value="none">none</option>
            <option value="bearer">bearer token</option>
            <option value="header">custom header</option>
          </select>
        </label>
        {form.authType === "bearer" && (
          <label className={label}>
            Token
            <input className={field} type="password" value={form.token} onChange={(event) => patch({ token: event.target.value })} />
          </label>
        )}
        {form.authType === "header" && (
          <>
            <label className={label}>
              Header name
              <input className={field} value={form.headerName} onChange={(event) => patch({ headerName: event.target.value })} placeholder="X-Api-Key" />
            </label>
            <label className={label}>
              Header value
              <input className={field} type="password" value={form.headerValue} onChange={(event) => patch({ headerValue: event.target.value })} />
            </label>
          </>
        )}
        <label className={label}>
          Note
          <input className={field} value={form.note} onChange={(event) => patch({ note: event.target.value })} placeholder="Why it exists, who owns it" />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="pill border-o5/60 text-o5 disabled:opacity-50"
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? "Adding…" : "Add server"}
        </button>
        <button type="button" className="pill" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
