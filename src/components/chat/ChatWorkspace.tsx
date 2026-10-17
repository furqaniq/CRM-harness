"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { bodyToChunks, parseTransportFrame, readSse } from "@/core/events/sse";
import { recordSessionRun } from "@/components/shell/tokenMeter";
import { useShell } from "@/components/shell/shellContext";
import PromptBox from "./PromptBox";
import {
  chatReducer,
  formatSeconds,
  initialChatState,
  runHeadline,
  runMeta,
  type ChatMessage,
  type PendingRun,
  type RunTrace,
} from "./chatState";

const STOP_FORCE_MS = 3_000;

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-y4 border-t-transparent"
    />
  );
}

function TraceCard({
  trace,
  running,
  advanced,
  onToggleAdvanced,
}: {
  trace: RunTrace;
  running: boolean;
  advanced: boolean;
  onToggleAdvanced: () => void;
}) {
  const meta = runMeta(trace);
  const live = trace.entries.find((entry) => entry.status === "running");

  return (
    <div
      className={`trace rounded-xl border bg-s2 px-3 py-2.5 text-dim ${
        running ? "border-[rgba(247,201,72,0.5)]" : "border-bd"
      }`}
    >
      <div className="flex items-center gap-2">
        {running ? (
          <Spinner />
        ) : (
          <span aria-hidden="true" className={trace.stop === "error" ? "text-bad" : "text-ok"}>
            {trace.stop === "error" ? "✕" : "✓"}
          </span>
        )}
        <span className="text-tx">{runHeadline(trace)}</span>
        {trace.lanes.length > 0 && (
          <span className="text-dim">
            {trace.lanes.length} agent{trace.lanes.length === 1 ? "" : "s"}
          </span>
        )}
        {live && <span className="text-y4">● {live.label}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-pressed={advanced}
          className="pill hover:text-tx"
        >
          Advanced
        </button>
      </div>

      {trace.entries.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {trace.entries.map((entry) => (
            <li
              key={entry.callId ?? `${entry.stepId}-${entry.label}`}
              className="flex items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className={
                  entry.status === "error"
                    ? "text-bad"
                    : entry.status === "done"
                      ? "text-ok"
                      : "text-y4"
                }
              >
                {entry.status === "error" ? "✕" : entry.status === "done" ? "✓" : "●"}
              </span>
              <span>{entry.label}</span>
              {entry.durationMs !== undefined && (
                <span className="text-faint">{(entry.durationMs / 1000).toFixed(1)}s</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {trace.lanes.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
          {trace.lanes.map((lane) => (
            <div
              key={lane.runId}
              className="min-w-52 flex-1 rounded-lg border border-bd bg-s1 px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 text-[12px]">
                <span
                  aria-hidden="true"
                  className={
                    lane.status === "error"
                      ? "text-bad"
                      : lane.status === "done"
                        ? "text-ok"
                        : "text-y4"
                  }
                >
                  {lane.status === "error" ? "✕" : lane.status === "done" ? "✓" : "●"}
                </span>
                <span className="text-tx font-medium">{lane.label}</span>
                <span className="flex-1" />
                {lane.durationMs !== undefined && (
                  <span className="text-faint">{formatSeconds(lane.durationMs)}</span>
                )}
              </div>
              {lane.entries.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px]">
                  {lane.entries.map((entry) => (
                    <li
                      key={entry.callId ?? `${entry.stepId}-${entry.label}`}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          entry.status === "error"
                            ? "text-bad"
                            : entry.status === "done"
                              ? "text-ok"
                              : "text-y4"
                        }
                      >
                        {entry.status === "error" ? "✕" : entry.status === "done" ? "✓" : "●"}
                      </span>
                      <span className="truncate">{entry.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!advanced && lane.content !== "" && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[11.5px] text-dim">
                  {lane.content}
                </p>
              )}
              {advanced && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-bd bg-s2 p-1.5 text-[11px] text-faint">
                  {lane.raw.length > 0 ? lane.raw.join("\n") : "no events yet"}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {meta.length > 0 && (
        <div className="mt-1.5 text-[11.5px] text-faint">{meta.join(" · ")}</div>
      )}

      {advanced && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-bd bg-s1 p-2 text-[11.5px] text-faint">
          {trace.raw.length > 0 ? trace.raw.join("\n") : "no events yet"}
        </pre>
      )}
    </div>
  );
}

function MessageBlock({
  message,
  advanced,
  onToggleAdvanced,
}: {
  message: ChatMessage;
  advanced: boolean;
  onToggleAdvanced: () => void;
}) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] bg-s3 px-3.5 py-[9px] text-[14px] text-tx">
          {message.content}
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2">
      {message.trace && (
        <TraceCard
          trace={message.trace}
          running={false}
          advanced={advanced}
          onToggleAdvanced={onToggleAdvanced}
        />
      )}
      <div className="max-w-[78ch] whitespace-pre-wrap break-words text-[14px] text-tx">
        {message.content}
      </div>
      {message.note && <div className="text-[12.5px] text-faint">{message.note}</div>}
    </li>
  );
}

function PendingBlock({
  pending,
  advanced,
  onToggleAdvanced,
}: {
  pending: PendingRun;
  advanced: boolean;
  onToggleAdvanced: () => void;
}) {
  return (
    <li className="flex flex-col gap-2">
      <TraceCard
        trace={pending.trace}
        running
        advanced={advanced}
        onToggleAdvanced={onToggleAdvanced}
      />
      {pending.content && (
        <div className="max-w-[78ch] whitespace-pre-wrap break-words text-[14px] text-tx">
          {pending.content}
          <span className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-o5" />
        </div>
      )}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-o5 text-lg font-extrabold text-[#1a1205]">
          M
        </div>
        <p className="text-[15px] text-tx">Maple is ready.</p>
        <p className="mt-1 text-[13.5px] text-dim">
          Ask about a pipeline, contact or campaign. Type / for skills and @ for an agent.
        </p>
        <p className="mt-3 text-[12px] text-faint">
          Running on the scripted demo model until a provider key is added.
        </p>
      </div>
    </div>
  );
}

export default function ChatWorkspace() {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [advanced, setAdvanced] = useState(false);
  const { ownerMode } = useShell();
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pendingContentLength = state.pending?.content.length ?? 0;
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [state.messages.length, pendingContentLength]);

  function cancelRun(runId: string) {
    return fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelRunId: runId }),
    }).catch(() => undefined);
  }

  async function send(text: string) {
    dispatch({ type: "send", content: text });
    const controller = new AbortController();
    abortRef.current = controller;
    stopRequestedRef.current = false;
    const history = state.messages.map(({ role, content }) => ({ role, content }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: text }],
          ownerMode,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        dispatch({ type: "stream_error" });
        return;
      }

      for await (const frame of readSse(bodyToChunks(response.body))) {
        const parsed = parseTransportFrame(frame.data);
        if (!parsed || parsed.type === "stream_end") continue;
        if (parsed.type === "stream_error") {
          dispatch({ type: "stream_error" });
          continue;
        }
        if (parsed.type === "run_start" && parsed.parentRunId === undefined) {
          runIdRef.current = parsed.runId;
          if (stopRequestedRef.current) void cancelRun(parsed.runId);
        }
        if (parsed.type === "run_end") {
          recordSessionRun({ usage: parsed.usage, costUsd: parsed.costUsd });
        }
        dispatch({ type: "event", event: parsed });
      }
      dispatch({ type: "stream_closed" });
    } catch {
      dispatch({ type: controller.signal.aborted ? "stream_closed" : "stream_error" });
    } finally {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      abortRef.current = null;
      runIdRef.current = null;
      stopRequestedRef.current = false;
    }
  }

  function stop() {
    dispatch({ type: "request_stop" });
    stopRequestedRef.current = true;
    const runId = runIdRef.current;
    if (runId) void cancelRun(runId);
    // Let the stream end on its own so run_end still carries the usage;
    // force the connection down if the run never finishes.
    const controller = abortRef.current;
    if (controller) {
      stopTimerRef.current = window.setTimeout(() => controller.abort(), STOP_FORCE_MS);
    }
  }

  const busy = state.status !== "idle";
  const hasConversation = state.messages.length > 0 || state.pending !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3.5 pt-3">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!hasConversation ? (
          <EmptyState />
        ) : (
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-4">
            {state.messages.map((message, index) => (
              <MessageBlock
                key={index}
                message={message}
                advanced={advanced}
                onToggleAdvanced={() => setAdvanced((value) => !value)}
              />
            ))}
            {state.pending && (
              <PendingBlock
                pending={state.pending}
                advanced={advanced}
                onToggleAdvanced={() => setAdvanced((value) => !value)}
              />
            )}
          </ol>
        )}
      </div>

      {state.notice && state.status === "idle" && (
        <div className="note text-[13px] text-dim" role="status">
          {state.notice}
        </div>
      )}

      <PromptBox
        busy={busy}
        stopping={state.status === "stopping"}
        onSend={(text) => void send(text)}
        onStop={stop}
      />
    </div>
  );
}
