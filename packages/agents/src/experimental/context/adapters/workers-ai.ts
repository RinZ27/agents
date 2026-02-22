import type { ContextMessage } from "../types";

/** @experimental */
export interface WorkersAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** @experimental */
export const workersAIContextAdapter = {
  toModelMessages(
    staticSystemInstructions: string[],
    systemInstructions: string[],
    messages: ContextMessage[]
  ): { messages: WorkersAIChatMessage[] } {
    const allSystem = [...staticSystemInstructions, ...systemInstructions];
    const result: WorkersAIChatMessage[] = [];

    if (allSystem.length > 0) {
      result.push({
        role: "system",
        content: allSystem.join("\n\n")
      });
    }

    for (const msg of messages) {
      result.push({
        role: msg.role,
        content: msg.content,
        ...(msg.name ? { name: msg.name } : {}),
        ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
        ...(msg.toolCalls
          ? {
              tool_calls: msg.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.function.name,
                  arguments: JSON.stringify(call.function.arguments ?? {})
                }
              }))
            }
          : {})
      });
    }

    return { messages: result };
  }
};
