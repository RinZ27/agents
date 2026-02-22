import { describe, expect, it } from "vitest";
import { createScopedHandoffContext } from "../handoff";
import { buildWorkingContext } from "../working-context";
import { ContextEventAction } from "../types";

const baseEvents = [
  {
    id: "u1",
    sessionId: "s1",
    seq: 0,
    timestamp: Date.now(),
    action: ContextEventAction.USER_MESSAGE,
    content: "first"
  },
  {
    id: "a1",
    sessionId: "s1",
    seq: 1,
    timestamp: Date.now(),
    action: ContextEventAction.AGENT_MESSAGE,
    content: "reply"
  },
  {
    id: "u2",
    sessionId: "s1",
    seq: 2,
    timestamp: Date.now(),
    action: ContextEventAction.USER_MESSAGE,
    content: "second"
  }
] as const;

describe("handoff modes", () => {
  it("supports include none", () => {
    const ctx = buildWorkingContext([...baseEvents]);
    const handoff = createScopedHandoffContext(ctx, { include: "none" });
    expect(handoff.messages).toHaveLength(0);
  });

  it("supports include full", () => {
    const ctx = buildWorkingContext([...baseEvents]);
    const handoff = createScopedHandoffContext(ctx, { include: "full" });
    expect(handoff.messages).toHaveLength(3);
  });

  it("supports include custom", () => {
    const ctx = buildWorkingContext([...baseEvents]);
    const handoff = createScopedHandoffContext(ctx, {
      include: "custom",
      customSelector(messages) {
        return messages.filter((m) => m.role === "user");
      }
    });

    expect(handoff.messages).toHaveLength(2);
    expect(handoff.messages.every((m) => m.role === "user")).toBe(true);
  });

  it("appends latestUserPrompt after translated context", () => {
    const ctx = buildWorkingContext([...baseEvents]);
    const handoff = createScopedHandoffContext(ctx, {
      include: "recent",
      recentLimit: 2,
      latestUserPrompt: "Now continue with booking"
    });

    expect(handoff.messages).toHaveLength(3);
    expect(handoff.messages[2]?.content).toBe("Now continue with booking");
  });
});
