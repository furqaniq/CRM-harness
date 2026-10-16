import { describe, expect, it } from "vitest";
import type { ChatRequest, ProviderEvent } from "./types";
import { createDemoProvider, demoReplyChunks } from "./demo";

function request(prompt: string): ChatRequest {
  return { model: "demo-model", messages: [{ role: "user", content: prompt }] };
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function textOf(events: ProviderEvent[]): string {
  return events
    .filter((event): event is Extract<ProviderEvent, { type: "text_delta" }> => {
      return event.type === "text_delta";
    })
    .map((event) => event.text)
    .join("");
}

describe("demo provider", () => {
  it("answers the last user message and says it is scripted", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(provider.stream(request("how many leads are open?")));
    const text = textOf(events);

    expect(text).toContain('You asked: "how many leads are open?"');
    expect(text).toMatch(/scripted demo model/);
    expect(text).toMatch(/no CRM record was read or written/);
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "end" });
  });

  it("reports input and output token usage", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(provider.stream(request("hi")));

    const usage = events.filter(
      (event): event is Extract<ProviderEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage.length).toBeGreaterThanOrEqual(2);
    expect(usage[0].inputTokens).toBeGreaterThan(0);
    expect(usage.at(-1)?.outputTokens).toBeGreaterThan(0);
    expect(usage.at(-1)?.inputTokens).toBe(0);
  });

  it("handles an empty prompt without pretending to have data", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(provider.stream({ model: "demo-model", messages: [] }));

    expect(textOf(events)).toMatch(/type a message/);
    expect(textOf(events)).not.toMatch(/You asked:/);
  });

  it("stops as soon as the signal aborts", async () => {
    const provider = createDemoProvider({ delayMs: 15 });
    const controller = new AbortController();
    const events: ProviderEvent[] = [];

    for await (const event of provider.stream(request("cancel me"), controller.signal)) {
      events.push(event);
      if (events.length === 1) controller.abort();
    }

    expect(events.at(-1)).toMatchObject({ type: "done", stop: "cancelled" });
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(0);
  });

  it("quotes at most 80 characters of the prompt", () => {
    const chunks = demoReplyChunks("x".repeat(200));
    const first = chunks[0];

    expect(first).toContain("…");
    expect(first.length).toBeLessThan(120);
  });
});
