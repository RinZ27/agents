import { describe, expect, it } from "vitest";
import { createScopedHandoffContext } from "../handoff";
import { createDefaultProcessors, runContextProcessors } from "../processors";
import { buildWorkingContext } from "../working-context";
import { ContextEventAction, type ContextCompileState } from "../types";

describe("context pipeline", () => {
  it("injects memory and artifacts via default processors", async () => {
    const now = Date.now();
    const events = [
      {
        id: "1",
        sessionId: "s1",
        seq: 0,
        timestamp: now,
        action: ContextEventAction.USER_MESSAGE,
        content: "remember my preferred city"
      }
    ];

    const base = buildWorkingContext(events);
    const state: ContextCompileState = {
      sessionId: "s1",
      events,
      messages: base.messages,
      systemInstructions: [],
      staticSystemInstructions: [],
      traces: [],
      metadata: {}
    };

    const processors = createDefaultProcessors({
      load: { limit: 10 },
      memoryRetriever: {
        async retrieve() {
          return [
            { id: "m1", content: "User prefers Berlin", source: "profile" }
          ];
        }
      },
      artifactResolver: {
        async resolve() {
          return [
            {
              name: "report.csv",
              summary: "Sales report reference",
              ephemeral: true
            }
          ];
        }
      }
    });

    const out = await runContextProcessors(state, processors);
    const contents = out.messages.map((m) => m.content).join("\n");
    expect(contents).toContain("Artifact");
    expect(contents).toContain("Memory");
    expect(out.messages[0]?.role).toBe("system");
    expect(out.messages[1]?.role).toBe("system");
    expect(out.traces.length).toBeGreaterThan(0);
  });

  it("supports structured memory provider metadata and snippet injection", async () => {
    const now = Date.now();
    const events = [
      {
        id: "sm-1",
        sessionId: "s1",
        seq: 0,
        timestamp: now,
        action: ContextEventAction.USER_MESSAGE,
        content: "I live in Berlin"
      }
    ];

    const base = buildWorkingContext(events);
    const state: ContextCompileState = {
      sessionId: "s1",
      events,
      messages: base.messages,
      systemInstructions: [],
      staticSystemInstructions: [],
      traces: [],
      metadata: {}
    };

    const processors = createDefaultProcessors({
      structuredMemoryProvider: {
        async load() {
          return { location: "Berlin" };
        },
        async toSnippets({ memory }) {
          return [
            {
              id: "sm-snippet",
              content: `User lives in ${String(memory["location"] ?? "")}`,
              source: "structured-memory"
            }
          ];
        }
      }
    });

    const out = await runContextProcessors(state, processors);
    expect(out.metadata["structuredMemory"]).toEqual({ location: "Berlin" });
    expect(out.messages[0]?.role).toBe("system");
    expect(out.messages[0]?.content).toContain("User lives in Berlin");
    expect(
      out.traces.some((trace) => trace.processor === "structured-memory")
    ).toBe(true);
  });

  it("respects custom eventToMessage mapper in default processors", async () => {
    const now = Date.now();
    const events = [
      {
        id: "custom-1",
        sessionId: "s1",
        seq: 0,
        timestamp: now,
        action: ContextEventAction.USER_MESSAGE,
        content: "hello"
      }
    ];

    const state: ContextCompileState = {
      sessionId: "s1",
      events,
      messages: [],
      systemInstructions: [],
      staticSystemInstructions: [],
      traces: [],
      metadata: {}
    };

    const processors = createDefaultProcessors({
      eventToMessage(event) {
        return {
          role: "user",
          content: `[custom] ${event.action}`
        };
      }
    });

    const out = await runContextProcessors(state, processors);
    expect(out.messages[0]?.content).toBe("[custom] user_message");
  });

  it("applies token budget trimming when configured", async () => {
    const now = Date.now();
    const events = Array.from({ length: 6 }, (_, i) => ({
      id: `b-${i}`,
      sessionId: "s1",
      seq: i,
      timestamp: now + i,
      action: ContextEventAction.USER_MESSAGE as const,
      content: `message-${i}-xxxxxxxxxxxxxxxxxxxxxxxx`
    }));

    const state: ContextCompileState = {
      sessionId: "s1",
      events,
      messages: [],
      systemInstructions: [],
      staticSystemInstructions: [],
      traces: [],
      metadata: {}
    };

    const out = await runContextProcessors(
      state,
      createDefaultProcessors({ maxTokenEstimate: 10 })
    );

    expect(out.traces.some((t) => t.processor === "token-budget")).toBe(true);
    expect(out.messages.length).toBeLessThan(events.length);
  });

  it("creates latest-turn scoped handoff with recasting", () => {
    const ctx = buildWorkingContext([
      {
        id: "a",
        sessionId: "s1",
        seq: 0,
        timestamp: Date.now(),
        action: ContextEventAction.USER_MESSAGE,
        content: "book flight"
      },
      {
        id: "b",
        sessionId: "s1",
        seq: 1,
        timestamp: Date.now(),
        action: ContextEventAction.AGENT_MESSAGE,
        content: "Sure, where to?"
      }
    ]);

    const handoff = createScopedHandoffContext(ctx, {
      include: "latest-turn",
      fromAgent: "root",
      toAgent: "travel",
      recastPriorAssistantAsUserContext: true
    });

    expect(handoff.messages.length).toBe(2);
    expect(handoff.messages[1]?.role).toBe("user");
    expect(handoff.messages[1]?.content).toContain("For context");
  });
});
