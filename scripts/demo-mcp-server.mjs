#!/usr/bin/env node
/**
 * Bundled demo MCP server (stdio, newline-delimited JSON-RPC).
 *
 * It exists so the MCP manager can be tested and demoed without a real
 * endpoint: sample tools that mirror the spec's `lead_*`, `send_*` and
 * `get_company` naming. It is NOT the real Maple CRM — fixtures for that are
 * still missing (see README Known gaps).
 */

const SERVER_INFO = { name: "demo-crm-mcp", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

const LEADS = [
  { id: "lead_1041", name: "Ada Lovelace", stage: "application", source: "web", email: "ada@example.com" },
  { id: "lead_1042", name: "Grace Hopper", stage: "new", source: "referral", email: "grace@example.com" },
  { id: "lead_1043", name: "Alan Turing", stage: "offer", source: "web", email: "alan@example.com" },
];

const TOOLS = [
  {
    name: "lead_search",
    description: "Search leads by free text and optional stage. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, email or source to match" },
        stage: { type: "string", description: "Filter by pipeline stage" },
        limit: { type: "integer", description: "Maximum rows to return" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "lead_get",
    description: "Fetch one lead by id. Read-only.",
    inputSchema: {
      type: "object",
      properties: { lead_id: { type: "string" } },
      required: ["lead_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "lead_update_stage",
    description: "Move a lead to another pipeline stage.",
    inputSchema: {
      type: "object",
      properties: { lead_id: { type: "string" }, stage: { type: "string" } },
      required: ["lead_id", "stage"],
    },
  },
  {
    name: "send_email",
    description: "Queue an email to a lead (reaches the outside world).",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "lead_delete",
    description: "Delete a lead permanently.",
    inputSchema: {
      type: "object",
      properties: { lead_id: { type: "string" } },
      required: ["lead_id"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "get_company",
    description: "Company profile and branch list. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];

function textResult(value, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function callTool(name, args) {
  switch (name) {
    case "lead_search": {
      const query = String(args.query ?? "").toLowerCase();
      const rows = LEADS.filter(
        (lead) =>
          (query === "" || lead.name.toLowerCase().includes(query) || lead.email.includes(query) || lead.source.includes(query)) &&
          (!args.stage || lead.stage === args.stage),
      ).slice(0, Number(args.limit ?? 50));
      return textResult({ count: rows.length, leads: rows });
    }
    case "lead_get": {
      const lead = LEADS.find((row) => row.id === args.lead_id);
      return lead ? textResult(lead) : textResult(`No lead with id ${args.lead_id}`, true);
    }
    case "lead_update_stage": {
      const lead = LEADS.find((row) => row.id === args.lead_id);
      if (!lead) return textResult(`No lead with id ${args.lead_id}`, true);
      lead.stage = String(args.stage);
      return textResult({ ok: true, lead });
    }
    case "send_email":
      return textResult({ ok: true, queued: `msg_${Math.random().toString(36).slice(2, 8)}`, to: args.to });
    case "lead_delete": {
      const index = LEADS.findIndex((row) => row.id === args.lead_id);
      if (index === -1) return textResult(`No lead with id ${args.lead_id}`, true);
      const [removed] = LEADS.splice(index, 1);
      return textResult({ ok: true, deleted: removed.id });
    }
    case "get_company":
      return textResult({
        company: "Maple Mortgage",
        branches: ["Toronto", "Vancouver"],
        users: 12,
      });
    default:
      throw { code: -32602, message: `Unknown tool: ${name}` };
  }
}

function handle(message) {
  const { id, method, params } = message;
  const respond = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  const fail = (code, msg) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: msg } })}\n`);

  if (method === "initialize") {
    respond({ protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (method === "tools/list") {
    respond({ tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    try {
      respond(callTool(String(params?.name ?? ""), params?.arguments ?? {}));
    } catch (error) {
      fail(error?.code ?? -32603, error?.message ?? String(error));
    }
    return;
  }
  fail(-32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line !== "") {
      try {
        const message = JSON.parse(line);
        if (message && typeof message.method === "string" && "id" in message) handle(message);
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
        );
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
