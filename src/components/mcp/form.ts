import type { JsonSchema } from "@/core/providers/types";
import type { McpAuthConfig, McpServerConfig, McpServerState, McpTransportKind } from "@/core/mcp/types";
import { slug } from "@/core/mcp/import";

export interface ServerForm {
  name: string;
  transport: McpTransportKind;
  /** URL for http/sse, command for stdio. */
  endpoint: string;
  /** stdio only: arguments, split on whitespace. */
  args: string;
  authType: "none" | "bearer" | "header";
  token: string;
  headerName: string;
  headerValue: string;
  note: string;
  enabled: boolean;
}

export const EMPTY_SERVER_FORM: ServerForm = {
  name: "",
  transport: "http",
  endpoint: "",
  args: "",
  authType: "none",
  token: "",
  headerName: "",
  headerValue: "",
  note: "",
  enabled: true,
};

/** Turns the add-server form into config, rejecting anything incomplete. */
export function buildServerConfig(form: ServerForm, existingIds: string[] = []): McpServerConfig {
  const name = form.name.trim();
  if (name === "") throw new Error("Give the server a name.");
  const id = slug(name);
  if (existingIds.includes(id)) {
    throw new Error(`"${name}" would reuse the id "${id}" — pick a different name.`);
  }

  const auth = buildAuth(form);

  if (form.transport === "stdio") {
    const command = form.endpoint.trim();
    if (command === "") throw new Error("Enter the command to run for the stdio server.");
    return {
      id,
      name,
      transport: "stdio",
      command: command.split(/\s+/)[0],
      args: [...command.split(/\s+/).slice(1), ...parseArgsLine(form.args)],
      auth,
      enabled: form.enabled,
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    };
  }

  const url = form.endpoint.trim();
  if (url === "") throw new Error("Enter the server URL.");
  if (!/^https?:\/\//i.test(url)) throw new Error("The URL must start with http:// or https://.");
  return {
    id,
    name,
    transport: form.transport,
    url,
    auth,
    enabled: form.enabled,
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
  };
}

function buildAuth(form: ServerForm): McpAuthConfig {
  if (form.authType === "none") return { type: "none" };
  if (form.authType === "bearer") {
    if (form.token.trim() === "") throw new Error("Paste the bearer token.");
    return { type: "bearer", token: form.token.trim() };
  }
  if (form.headerName.trim() === "") throw new Error("Give the header a name.");
  if (form.headerValue.trim() === "") throw new Error("Give the header a value.");
  return { type: "header", name: form.headerName.trim(), value: form.headerValue.trim() };
}

export function parseArgsLine(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
}

/**
 * Starting JSON for the tool console: required arguments first, then a few
 * more the schema declares, each with a value of the right kind to edit.
 */
export function argSkeleton(schema: JsonSchema | undefined): string {
  if (!schema?.properties) return "{}";
  const keys = Object.keys(schema.properties);
  const required = (schema.required ?? []).filter((key) => keys.includes(key));
  const chosen = [...required, ...keys.filter((key) => !required.includes(key))].slice(0, 6);
  const sample: Record<string, unknown> = {};
  for (const key of chosen) sample[key] = sampleValue(schema.properties[key]);
  return JSON.stringify(sample, null, 2);
}

function sampleValue(schema: JsonSchema | undefined): unknown {
  if (!schema) return "";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.includes("integer") || types.includes("number")) return 0;
  if (types.includes("boolean")) return false;
  if (types.includes("array")) return [];
  if (types.includes("object")) return {};
  return "";
}

/** Tool console input: a JSON object the caller can edit. */
export function parseToolArgs(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Arguments must be a JSON object, for example {\"query\": \"Ada\"}.");
  }
  return parsed as Record<string, unknown>;
}

export function statusLabel(state: McpServerState): string {
  switch (state) {
    case "disabled":
      return "Disabled";
    case "disconnected":
      return "Not connected";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "error":
      return "Needs attention";
  }
}

export function statusDotClass(state: McpServerState): string {
  switch (state) {
    case "connected":
      return "bg-ok";
    case "connecting":
      return "bg-y4 animate-pulse";
    case "error":
      return "bg-bad";
    case "disabled":
      return "bg-faint";
    case "disconnected":
      return "bg-dim";
  }
}
