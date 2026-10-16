"use client";

import { useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/shell/Icon";

export interface PromptBoxProps {
  busy: boolean;
  stopping: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function PromptBox({ busy, stopping, onSend, onStop }: PromptBoxProps) {
  const [draft, setDraft] = useState("");
  const canSend = !busy && draft.trim() !== "";

  function submit() {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className={`prompt-ring ${busy ? "prompt-ring-live" : ""} mt-auto`}>
      <div className="rounded-2xl bg-s2 px-3.5 py-3">
        <label htmlFor="prompt" className="sr-only">
          Ask Maple
        </label>
        <textarea
          id="prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask Maple, or type / for skills and @ for an agent"
          className="block w-full resize-none bg-transparent text-[14px] text-tx placeholder:text-faint focus:outline-none"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button type="button" className="pill hover:text-tx">
            Attach
          </button>
          <button type="button" className="pill hover:text-tx">
            @ agent
          </button>
          <button type="button" className="pill hover:text-tx">
            / skill
          </button>
          <span className="flex-1" />
          <button type="button" className="pill hover:text-tx">
            Worker model
          </button>
          <button type="button" className="pill hover:text-tx">
            Auto
          </button>

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              aria-label={stopping ? "Stopping run" : "Stop run"}
              className="grid h-8 w-8 place-items-center rounded-full bg-bad text-white disabled:opacity-60"
            >
              <Icon name="stop" className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className={`send ${canSend ? "" : "cursor-not-allowed opacity-70"}`}
            >
              <Icon name="chevron" className="h-4 w-4 -rotate-90" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
