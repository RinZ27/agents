import { describe, expect, it } from "vitest";
import { workersAIContextAdapter } from "../adapters/workers-ai";

describe("workers ai adapter", () => {
  it("maps system + chat messages", () => {
    const out = workersAIContextAdapter.toModelMessages(
      ["You are static."],
      ["You are helpful."],
      [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "calling",
          toolCalls: [
            {
              id: "t1",
              type: "function",
              function: { name: "weather", arguments: { city: "Berlin" } }
            }
          ]
        }
      ]
    );

    expect(out.messages[0]?.role).toBe("system");
    expect(out.messages[1]?.role).toBe("user");
    expect(out.messages[2]?.tool_calls?.[0]?.function.name).toBe("weather");
  });
});
