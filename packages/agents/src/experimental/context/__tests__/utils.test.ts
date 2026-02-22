import { describe, expect, it } from "vitest";
import { ContextEventAction, type ContextSessionEvent } from "../types";
import {
  contextEventToMessage,
  contextMessageToEvent,
  dehydrateContextEvent,
  getCompactionMetadata,
  hydrateContextEvent,
  setCompactionMetadata
} from "../utils";

describe("context utils", () => {
  it("round trips tool result events", () => {
    const event: ContextSessionEvent = {
      id: "e1",
      sessionId: "s1",
      seq: 1,
      timestamp: Date.now(),
      action: ContextEventAction.TOOL_RESULT,
      toolCallId: "tc1",
      toolName: "weather",
      output: { temp: 20 },
      content: "20C"
    };

    const row = dehydrateContextEvent(event);
    const hydrated = hydrateContextEvent(row);

    expect(hydrated.action).toBe(ContextEventAction.TOOL_RESULT);
    if (hydrated.action === ContextEventAction.TOOL_RESULT) {
      expect(hydrated.toolName).toBe("weather");
      expect(hydrated.toolCallId).toBe("tc1");
    }
  });

  it("maps compaction event to stable system message", () => {
    const message = contextEventToMessage({
      id: "e2",
      sessionId: "s1",
      seq: 2,
      timestamp: Date.now(),
      action: ContextEventAction.COMPACTION,
      content: "Previous 20 turns summarized"
    });

    expect(message).not.toBeNull();
    expect(message?.role).toBe("system");
    expect(message?.metadata?.stable).toBe(true);
  });

  it("maps assistant tool calls back to events", () => {
    const event = contextMessageToEvent("s1", {
      role: "assistant",
      content: "calling tool",
      toolCalls: [
        {
          id: "call1",
          type: "function",
          function: {
            name: "search",
            arguments: { q: "agents" }
          }
        }
      ]
    });

    expect(event.action).toBe(ContextEventAction.TOOL_CALL_REQUEST);
  });

  it("round trips compaction metadata and typed helpers", () => {
    const event: ContextSessionEvent = {
      id: "c1",
      sessionId: "s1",
      seq: 3,
      timestamp: Date.now(),
      action: ContextEventAction.COMPACTION,
      content: "summary",
      replacesSeqRange: [0, 2],
      metadata: {
        entities: ["cloudflare", "agents"],
        source: "test"
      }
    };

    const row = dehydrateContextEvent(event);
    const hydrated = hydrateContextEvent(row);

    expect(hydrated.action).toBe(ContextEventAction.COMPACTION);
    if (hydrated.action === ContextEventAction.COMPACTION) {
      const metadata = getCompactionMetadata<{ source: string }>(hydrated);
      expect(metadata?.source).toBe("test");

      const updated = setCompactionMetadata(hydrated, { source: "updated" });
      const updatedMeta = getCompactionMetadata<{ source: string }>(updated);
      expect(updatedMeta?.source).toBe("updated");
    }
  });

  it("preserves model metadata for agent messages", () => {
    const event: ContextSessionEvent = {
      id: "agent1",
      sessionId: "s1",
      seq: 4,
      timestamp: Date.now(),
      action: ContextEventAction.AGENT_MESSAGE,
      content: "hello",
      model: "@cf/meta/llama-3.1-8b-instruct"
    };

    const hydrated = hydrateContextEvent(dehydrateContextEvent(event));
    expect(hydrated.action).toBe(ContextEventAction.AGENT_MESSAGE);
    if (hydrated.action === ContextEventAction.AGENT_MESSAGE) {
      expect(hydrated.model).toBe("@cf/meta/llama-3.1-8b-instruct");
    }
  });

  it("throws for unknown stored actions instead of coercing", () => {
    expect(() =>
      hydrateContextEvent({
        id: "bad",
        session_id: "s1",
        seq: 1,
        action: "unknown_action",
        content: "x",
        metadata: null,
        created_at: Date.now()
      })
    ).toThrow(/Unknown context event action/);
  });
});
