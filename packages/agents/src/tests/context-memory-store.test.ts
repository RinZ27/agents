import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "../index";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("context memory store", () => {
  it("upserts and reads session-scoped memory entries", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "memory-store");
    const sessionId = await agent.createSessionWithTurns(1);

    await agent.upsertMemoryEntries(sessionId, [
      { key: "location", value: "London", source: "extractor", score: 0.9 },
      { key: "like", value: "golf", source: "extractor", score: 0.8 }
    ]);

    const memory = await agent.getMemoryEntries(sessionId);
    expect(memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "location", value: "London" }),
        expect.objectContaining({ key: "like", value: "golf" })
      ])
    );
  });

  it("supports replaceByKey for canonical facts", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "memory-replace");
    const sessionId = await agent.createSessionWithTurns(1);

    await agent.upsertMemoryEntries(sessionId, [
      { key: "location", value: "Berlin" }
    ]);
    await agent.upsertMemoryEntries(
      sessionId,
      [{ key: "location", value: "London" }],
      true
    );

    const memory = await agent.getMemoryEntries(sessionId);
    const locations = memory.filter((entry) => entry.key === "location");
    expect(locations).toHaveLength(1);
    expect(locations[0]?.value).toBe("London");
  });
});
