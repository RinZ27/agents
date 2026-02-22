import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "../index";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("context compaction", () => {
  it("compacts old events and keeps recent tail with summary event", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "compact-e2e");

    const sessionId = await agent.createSessionWithTurns(6);

    const beforeActions = await agent.getEventActions(sessionId);
    expect(beforeActions).toHaveLength(12);

    const summary = await agent.compactAndSummarize(sessionId, 4);
    expect(summary).toContain("compacted:8:");

    const afterActions = await agent.getEventActions(sessionId);
    const afterContents = await agent.getEventContents(sessionId);

    expect(afterActions).toEqual([
      "user_message",
      "agent_message",
      "user_message",
      "agent_message",
      "compaction"
    ]);

    expect(afterContents.slice(0, 4)).toEqual([
      "user-5",
      "assistant-5",
      "user-6",
      "assistant-6"
    ]);
    expect(afterContents.at(-1)).toContain("compacted:8:");
  });
});
