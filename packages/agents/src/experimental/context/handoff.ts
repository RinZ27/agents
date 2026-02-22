import { WorkingContext } from "./working-context";
import type { ContextMessage, HandoffOptions } from "./types";

function translateForCallee(
  messages: ContextMessage[],
  options: HandoffOptions
): ContextMessage[] {
  if (options.recastPriorAssistantAsUserContext !== true) {
    return messages;
  }

  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;

    return {
      role: "user",
      content: `[For context from ${
        options.fromAgent ?? "upstream agent"
      }] ${msg.content}`,
      metadata: {
        ...msg.metadata,
        sourceAgent: options.fromAgent
      }
    };
  });
}

/** @experimental */
export function createScopedHandoffContext(
  source: WorkingContext,
  options: HandoffOptions = {}
): WorkingContext {
  const include = options.include ?? "latest-turn";
  let selected: ContextMessage[] = [];

  if (include === "none") {
    selected = [];
  } else if (include === "latest-turn") {
    const latestUserIdx = [...source.messages]
      .map((m, idx) => ({ m, idx }))
      .reverse()
      .find((item) => item.m.role === "user")?.idx;

    if (latestUserIdx != null) {
      selected = source.messages.slice(latestUserIdx);
    }
  } else if (include === "recent") {
    const n = options.recentLimit ?? 8;
    selected = source.messages.slice(-n);
  } else if (include === "custom" && options.customSelector) {
    selected = options.customSelector(source.messages);
  } else {
    selected = [...source.messages];
  }

  const translated = translateForCallee(selected, options);

  const handoffLead = options.latestUserPrompt
    ? [
        {
          role: "user" as const,
          content: options.latestUserPrompt,
          metadata: {
            stable: false,
            sourceAgent: options.fromAgent
          }
        }
      ]
    : [];

  return new WorkingContext({
    systemInstructions: [...source.systemInstructions],
    staticSystemInstructions: [...source.staticSystemInstructions],
    messages: [...handoffLead, ...translated],
    traces: [...source.traces]
  });
}
