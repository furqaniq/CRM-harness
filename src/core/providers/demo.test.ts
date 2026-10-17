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

function toolRequest(
  prompt: string,
  tools: string[],
  extra: Partial<ChatRequest> = {},
): ChatRequest {
  return {
    model: "demo-model",
    messages: [{ role: "user", content: prompt }],
    tools: tools.map((name) => ({ name, description: name, inputSchema: { type: "object" } })),
    ...extra,
  };
}

describe("demo provider tool routing", () => {
  it("routes a delete-shaped prompt to a delete tool so policy can deny it", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(toolRequest("delete lead L-1001", ["lead_delete", "lead_search"])),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("lead_delete");
    expect(call?.type === "tool_call" && call.call.arguments).toContain("L-1001");
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "tool_calls" });
  });

  it("proposes the delete-shaped call even when the delete tool is not offered", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(provider.stream(toolRequest("delete lead L-1001", ["lead_search"])));

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("lead_delete");
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "tool_calls" });
  });

  it("extracts the search query and asks lead_search for it", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(provider.stream(toolRequest("find Ada", ["lead_search"])));

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("lead_search");
    expect(call?.type === "tool_call" && call.call.arguments).toContain("Ada");
  });

  it("maps a how-many-leads question to lead_count with the open status", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(toolRequest("how many leads are open?", ["lead_count"])),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("lead_count");
    expect(call?.type === "tool_call" && call.call.arguments).toContain('"open"');
  });

  it("answers the second turn from the tool result, not from a script", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "delete lead L-1001" },
      { role: "assistant", content: "" },
      {
        role: "tool",
        toolCallId: "c1",
        name: "lead_delete",
        content: "Denied by policy: destructive tools are never available to the agent.",
        isError: true,
      },
    ];

    const events = await collect(provider.stream({ model: "demo-model", messages }));
    const text = textOf(events);

    expect(text).toContain("blocked by policy");
    expect(text).not.toContain("You asked:");
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "end" });
  });

  it("mentions the artifact when the tool result was artifactized", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "list the automations" },
      { role: "assistant", content: "" },
      {
        role: "tool",
        toolCallId: "c1",
        name: "automation_list",
        content: "Large result stored as artifact art_1 (270.4 KB — 900 items): preview…",
      },
    ];

    const events = await collect(provider.stream({ model: "demo-model", messages }));
    const text = textOf(events);
    expect(text).toContain("artifact");
    expect(text).toContain("exact count");
    expect(text).toContain("handle art_1");
  });

  it("reads a slice of the artifact when one is in the transcript", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(
        toolRequest("read the artifact", ["read_artifact", "automation_list"], {
          messages: [
            { role: "user", content: "list the automations" },
            { role: "assistant", content: "" },
            {
              role: "tool",
              toolCallId: "c1",
              name: "automation_list",
              content:
                'Large result stored as artifact art_abc123_9 (405.4 KB — 900 items): a JSON object whose "automations" holds 900 items. Preview: …',
            },
            { role: "assistant", content: "That list is stored as an artifact." },
            { role: "user", content: "read the artifact" },
          ],
        }),
      ),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("read_artifact");
    expect(call?.type === "tool_call" && call.call.arguments).toContain("art_abc123_9");
  });

  it("does not offer to read an artifact when the transcript has no handle", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(toolRequest("read the artifact", ["read_artifact"])),
    );

    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(textOf(events)).toContain("read the artifact");
  });
});

function spawnResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "leads",
    status: "ok",
    summary: "4 open leads.",
    writes: [],
    errors: [],
    runId: "run_child_1",
    usage: { inputTokens: 40, outputTokens: 10 },
    ...over,
  };
}

function secondTurn(name: string, content: string): ChatRequest["messages"] {
  return [
    { role: "user", content: "fan out" },
    { role: "assistant", content: "" },
    { role: "tool", toolCallId: "c1", name, content },
  ];
}

describe("demo provider subagent routing", () => {
  it("fans out to spawn_agents when the prompt asks for parallel work", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(
        toolRequest("check open leads and waiting conversations in parallel", [
          "spawn_agents",
          "lead_count",
          "conversation_list",
        ]),
      ),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("spawn_agents");
    if (call?.type !== "tool_call") throw new Error("expected a tool_call");
    const args = JSON.parse(call.call.arguments) as { agents: { agent: string }[] };
    expect(args.agents.map((entry) => entry.agent)).toEqual(["leads", "inbox"]);
  });

  it("skips the spawn rule when a specialist is not offered the spawn tools", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(
        toolRequest("check open leads and waiting conversations in parallel", [
          "lead_count",
          "conversation_list",
        ]),
      ),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("conversation_list");
  });

  it("routes a create-lead prompt through spawn_agent when the root can spawn", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(
        toolRequest("Create a lead named Ada Harness", [
          "spawn_agent",
          "lead_create",
          "lead_search",
        ]),
      ),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("spawn_agent");
    if (call?.type !== "tool_call") throw new Error("expected a tool_call");
    const args = JSON.parse(call.call.arguments) as { agent: string; task: string };
    expect(args.agent).toBe("leads");
    expect(args.task).toContain("Ada Harness");
  });

  it("creates the lead directly when spawn tools are not offered", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const events = await collect(
      provider.stream(
        toolRequest("Create a lead named Ada Harness", ["lead_create", "lead_search"]),
      ),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type === "tool_call" && call.call.name).toBe("lead_create");
    expect(call?.type === "tool_call" && call.call.arguments).toContain("Ada Harness");
  });

  it("narrates a parallel spawn result from what the agents reported", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const content = JSON.stringify([
      spawnResult({ agent: "leads", summary: "That returned 4 items." }),
      spawnResult({ agent: "inbox", summary: "That returned 2 items." }),
    ]);
    const events = await collect(
      provider.stream({ model: "demo-model", messages: secondTurn("spawn_agents", content) }),
    );
    const text = textOf(events);

    expect(text).toContain("Ran 2 agents side by side.");
    expect(text).toContain("Leads agent — ok. That returned 4 items.");
    expect(text).toContain("Inbox agent — ok. That returned 2 items.");
    expect(text).not.toContain("You asked:");
  });

  it("narrates one agent's result with its status and verified writes", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const content = JSON.stringify(
      spawnResult({
        summary: "The record was saved and then read back from the CRM — verified.",
        writes: [{ tool: "lead_create", recordId: "L-9001", verified: true }],
      }),
    );
    const events = await collect(
      provider.stream({ model: "demo-model", messages: secondTurn("spawn_agent", content) }),
    );
    const text = textOf(events);

    expect(text).toContain("Leads agent finished — ok.");
    expect(text).toContain("verified by reading the record back");
  });

  it("says a write was verified when the coordinator stamped it", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const content = JSON.stringify({ created: { id: "L-9001" }, verified: true });
    const events = await collect(
      provider.stream({ model: "demo-model", messages: secondTurn("lead_create", content) }),
    );

    expect(textOf(events)).toContain("read back from the CRM — verified");
  });

  it("stays honest when a write could not be read back", async () => {
    const provider = createDemoProvider({ delayMs: 0 });
    const content = JSON.stringify({
      created: { id: "L-9001" },
      verified: false,
      verified_note: 'Read-back failed: No lead with id "L-9001".',
    });
    const events = await collect(
      provider.stream({ model: "demo-model", messages: secondTurn("lead_create", content) }),
    );
    const text = textOf(events);

    expect(text).toContain("could not be confirmed");
    expect(text).toContain("unconfirmed");
  });
});
