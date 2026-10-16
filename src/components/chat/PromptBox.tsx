"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/Icon";

export default function PromptBox() {
  const [draft, setDraft] = useState("");

  return (
    <div className="prompt-ring mt-auto">
      <div className="rounded-2xl bg-s2 px-3.5 py-3">
        <label htmlFor="prompt" className="sr-only">
          Ask Maple
        </label>
        <textarea
          id="prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label="Send"
            className="send cursor-not-allowed opacity-70"
          >
            <Icon name="chevron" className="h-4 w-4 -rotate-90" />
          </button>
        </div>
      </div>
    </div>
  );
}
