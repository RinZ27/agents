import { describe, expect, it } from "vitest";
import { WorkingContext } from "../working-context";

describe("working context cache-friendly mapping", () => {
  it("emits system instructions before conversation messages", () => {
    const context = new WorkingContext({
      staticSystemInstructions: ["stable-1"],
      systemInstructions: ["dynamic-1"],
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "calling tool",
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "search",
                arguments: { q: "agents" }
              }
            }
          ]
        },
        {
          role: "tool",
          content: "result",
          toolCallId: "call-1",
          name: "search"
        }
      ]
    });

    const out = context.toCacheFriendlyMessages();

    expect(out[0]).toEqual({ role: "system", content: "stable-1" });
    expect(out[1]).toEqual({ role: "system", content: "dynamic-1" });
    expect(out[2]?.role).toBe("user");
    expect(out[3]?.tool_calls?.[0]?.function.name).toBe("search");
    expect(out[4]?.role).toBe("tool");
    expect(out[4]?.tool_call_id).toBe("call-1");
  });
});
