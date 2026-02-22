import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "../index";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("context compile + persistence", () => {
  it("round-trips assistant message metadata through persistWorkingContext", async () => {
    const agent = await getAgentByName(
      env.TestContextAgent,
      "persist-roundtrip"
    );
    const sessionId = await agent.createSessionWithTurns(1);

    await agent.persistAssistantMessageWithMetadata(
      sessionId,
      "assistant-extra",
      {
        source: "test-suite",
        score: 0.91,
        customFlag: true
      }
    );

    const metadata = await agent.getLastAssistantMessageMetadata(sessionId);
    expect(metadata).not.toBeNull();
    expect(metadata?.["source"]).toBe("test-suite");
    expect(metadata?.["customFlag"]).toBe(true);
  });

  it("compileWorkingContext includes memory processor output and traces", async () => {
    const agent = await getAgentByName(env.TestContextAgent, "compile-memory");
    const sessionId = await agent.createSessionWithTurns(1);

    const compiled = await agent.compileContextWithMemory(sessionId);
    expect(compiled.traceProcessors).toContain("memory-retrieval");
    expect(compiled.traceProcessors).toContain("event-to-message");
    expect(compiled.memoryMessageCount).toBeGreaterThan(0);
  });
});
