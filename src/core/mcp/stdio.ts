import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { McpError, type JsonRpcMessage, type JsonRpcTransport, type RpcChannel, createRpcChannel, encodeLine, parseLine } from "./rpc";
import type { McpServerConfig } from "./types";

export interface SpawnDeps {
  spawnImpl?: typeof spawn;
}

function transportName(config: McpServerConfig): string {
  return `MCP server "${config.name}"`;
}

/**
 * stdio: newline-delimited JSON-RPC over the child process's stdin/stdout.
 * stderr is read only to be able to explain a crash in plain language.
 */
export function createStdioChannel(config: McpServerConfig, deps: SpawnDeps = {}): RpcChannel {
  const spawnImpl = deps.spawnImpl ?? spawn;
  if (!config.command) throw new McpError(`${transportName(config)} has no command to run.`);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
  } catch (error) {
    throw new McpError(
      `Could not start ${config.command}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let push: ((message: JsonRpcMessage) => void) | null = null;
  let stderrTail = "";
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let sendError: McpError | null = null;

  child.on("error", (error) => {
    const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
    sendError = new McpError(
      notFound
        ? `Could not find \`${config.command}\` — is it installed and on PATH?`
        : `Could not run \`${config.command}\`: ${error.message}`,
      { cause: error },
    );
  });
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-1_000);
  });
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const message = parseLine(line);
      if (message) push?.(message);
      index = buffer.indexOf("\n");
    }
  });
  child.stdout.on("end", () => {
    const line = buffer.trim();
    if (line === "") return;
    const message = parseLine(line);
    if (message) push?.(message);
    buffer = "";
  });

  const transport: JsonRpcTransport = {
    async send(message: JsonRpcMessage) {
      if (sendError) throw sendError;
      if (exited) {
        throw new McpError(`${config.name} stopped running${describeExit(exited)}${stderrDetail(stderrTail)}`);
      }
      const payload = encodeLine(message);
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(payload, (error) => {
          if (!error) {
            resolve();
            return;
          }
          // A spawn failure (ENOENT and friends) surfaces as a write error
          // first; give the child's own error event a turn to land so we can
          // say what actually went wrong.
          setTimeout(() => reject(explainWriteFailure()), 5);
        });
      });
    },
    async close() {
      if (!child.killed && !exited) child.kill();
    },
  };

  function explainWriteFailure(): McpError {
    if (sendError) return sendError;
    if (exited) return new McpError(`${config.name} stopped running${describeExit(exited)}${stderrDetail(stderrTail)}`);
    return new McpError(`${config.name} stopped accepting input${stderrDetail(stderrTail)}`);
  }

  const channel = createRpcChannel(transport, transportName(config));
  push = (message) => channel.handle(message);
  return channel;
}

function describeExit(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  if (exit.signal) return ` (killed by ${exit.signal})`;
  if (exit.code !== null) return ` (exit code ${exit.code})`;
  return "";
}

function stderrDetail(stderrTail: string): string {
  const last = stderrTail.trim().split("\n").filter(Boolean).at(-1);
  return last ? `: ${last.slice(0, 200)}` : ".";
}
