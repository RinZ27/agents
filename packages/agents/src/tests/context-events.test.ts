import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "../index";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("context events", () => {
  it("returns an error when appending events to a missing session", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "events-missing");

    const result = await agent.tryAppendUserMessages("does-not-exist", [
      "hello"
    ]);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("supports loadEvents action filters, tail ordering, and since filters", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "events-filters");
    const sessionId = await agent.createSessionWithTurns(3);

    const tailUserOnly = await agent.getFilteredEventActions(sessionId, {
      actions: ["user_message"],
      limit: 2,
      tail: true
    });

    expect(tailUserOnly).toEqual(["user_message", "user_message"]);

    const headUserOnly = await agent.getFilteredEventActions(sessionId, {
      actions: ["user_message"],
      limit: 2,
      tail: false
    });

    expect(headUserOnly).toEqual(["user_message", "user_message"]);

    const since = Date.now();
    await agent.appendUserMessages(sessionId, ["recent-a", "recent-b"]);

    const recentContents = await agent.getFilteredEventContents(sessionId, {
      since,
      actions: ["user_message"],
      tail: false,
      limit: 10
    });

    expect(recentContents).toEqual(["recent-a", "recent-b"]);
  });

  it("deletes session and cascades events + memory", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "events-delete");
    const sessionId = await agent.createSessionWithTurns(2);

    await agent.upsertMemoryEntries(sessionId, [
      { key: "location", value: "London" },
      { key: "like", value: "golf" }
    ]);

    const result = await agent.deleteSessionAndVerifyCascade(sessionId);
    expect(result.sessionExists).toBe(false);
    expect(result.eventCount).toBe(0);
    expect(result.memoryCount).toBe(0);
  });
});
