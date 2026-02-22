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

  it("supports loadEvents action filters and tail ordering", async () => {
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
  });
});
