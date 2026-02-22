import { describe, expect, it } from "vitest";
import { ContextEventAction, type ContextSessionEvent } from "../types";
import {
  contextEventToMessage,
  contextMessageToEvent,
  dehydrateContextEvent,
  hydrateContextEvent
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

  it("maps compaction event to stable assistant message", () => {
    const message = contextEventToMessage({
      id: "e2",
      sessionId: "s1",
      seq: 2,
      timestamp: Date.now(),
      action: ContextEventAction.COMPACTION,
      content: "Previous 20 turns summarized"
    });

    expect(message).not.toBeNull();
    expect(message?.role).toBe("assistant");
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
});
