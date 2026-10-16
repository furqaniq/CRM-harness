import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../providers/types";
import {
  assembleRequest,
  estimateConversationTokens,
  estimateTokens,
  messageText,
  trimMessages,
} from "./context";

function user(content: string): Message {
  return { role: "user", content };
}

function assistant(content: string): Message {
  return { role: "assistant", content };
}

function toolCallMessage(content: string, calls: ToolCall[]): Message {
  return { role: "assistant", content, toolCalls: calls };
}

function toolResult(id: string, content: string): Message {
  return { role: "tool", toolCallId: id, name: "probe", content };
}

describe("context assembly", () => {
  it("estimates tokens at roughly four characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateConversationTokens([user("a".repeat(400))])).toBeGreaterThan(100);
  });

  it("describes each message kind for the estimate", () => {
    expect(messageText(user("hello"))).toBe("hello");
    expect(messageText(assistant("hi"))).toBe("hi");
    expect(messageText(toolResult("c1", "[]"))).toContain("probe");
    expect(
      messageText(toolCallMessage("checking", [{ id: "c1", name: "probe", arguments: "{}" }])),
    ).toContain("probe({})");
  });

  it("keeps everything when the conversation is inside the budget", () => {
    const messages = [user("one"), assistant("two"), user("three")];
    const trimmed = trimMessages(messages, 1_000);

    expect(trimmed.dropped).toBe(0);
    expect(trimmed.messages).toEqual(messages);
  });

  it("drops the oldest turn first and keeps the newest", () => {
    const messages = [
      user(`old question ${"x".repeat(4000)}`),
      assistant(`old answer ${"y".repeat(4000)}`),
      user("recent question"),
      assistant("recent answer"),
    ];

    const trimmed = trimMessages(messages, 1_000);

    expect(trimmed.dropped).toBe(2);
    expect(trimmed.messages).toEqual(messages.slice(2));
    expect(trimmed.estimatedTokens).toBeLessThanOrEqual(1_000);
    expect(trimmed.estimatedTokens).toBeLessThan(estimateConversationTokens(messages));
  });

  it("never leaves an orphaned tool result at the front of the transcript", () => {
    const messages = [
      user("first question"),
      toolCallMessage("on it", [{ id: "c1", name: "probe", arguments: "{}" }]),
      toolResult("c1", "z".repeat(4000)),
      user("second question"),
      assistant("second answer"),
    ];

    const trimmed = trimMessages(messages, 500);

    expect(trimmed.dropped).toBe(3);
    expect(trimmed.messages[0]).toEqual(user("second question"));
    expect(trimmed.messages.some((message) => message.role === "tool")).toBe(false);
    expect(trimmed.messages).toHaveLength(2);
  });

  it("assembles a request with system prompt, tools and budgets", () => {
    const request = assembleRequest({
      model: "mock-model",
      system: "You are Maple.",
      messages: [user("hi")],
      tools: [{ name: "probe", description: "probe", inputSchema: { type: "object" } }],
      temperature: 0,
      maxTokens: 512,
    });

    expect(request).toEqual({
      model: "mock-model",
      system: "You are Maple.",
      messages: [user("hi")],
      tools: [{ name: "probe", description: "probe", inputSchema: { type: "object" } }],
      temperature: 0,
      maxTokens: 512,
    });
  });

  it("omits empty optional fields so no provider sees an empty tool list", () => {
    const request = assembleRequest({ model: "mock-model", messages: [user("hi")], tools: [] });

    expect(request.system).toBeUndefined();
    expect(request.tools).toBeUndefined();
    expect(request.temperature).toBeUndefined();
  });

  it("trims to the context budget before the call is sent", () => {
    const messages = [
      user(`old question ${"o".repeat(2000)}`),
      assistant(`old answer ${"a".repeat(2000)}`),
      user("new question"),
      assistant("new answer"),
    ];

    const request = assembleRequest({
      model: "mock-model",
      messages,
      maxContextTokens: 200,
    });

    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]).toEqual(user("new question"));
  });
});
