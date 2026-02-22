import { contextEventToMessage } from "./utils";
import type {
  ContextMessage,
  ContextSessionEvent,
  ContextTrace,
  WorkingContextOptions
} from "./types";

/** @experimental */
export class WorkingContext {
  readonly messages: ContextMessage[];
  readonly systemInstructions: string[];
  readonly staticSystemInstructions: string[];
  readonly traces: ContextTrace[];
  private readonly _initialCount: number;

  constructor(input?: {
    messages?: ContextMessage[];
    systemInstructions?: string[];
    staticSystemInstructions?: string[];
    traces?: ContextTrace[];
  }) {
    this.messages = input?.messages ? [...input.messages] : [];
    this.systemInstructions = input?.systemInstructions
      ? [...input.systemInstructions]
      : [];
    this.staticSystemInstructions = input?.staticSystemInstructions
      ? [...input.staticSystemInstructions]
      : [];
    this.traces = input?.traces ? [...input.traces] : [];
    this._initialCount = this.messages.length;
  }

  addMessage(message: ContextMessage): void {
    this.messages.push(message);
  }

  getNewMessages(): ContextMessage[] {
    return this.messages.slice(this._initialCount);
  }

  toCacheFriendlyMessages(): Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ContextMessage["toolCalls"];
  }> {
    const stableSystem = [
      ...this.staticSystemInstructions,
      ...this.systemInstructions
    ];

    const sysMsgs = stableSystem.map((content) => ({
      role: "system" as const,
      content
    }));

    const convoMsgs = this.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name ? { name: msg.name } : {}),
      ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
      ...(msg.toolCalls ? { tool_calls: msg.toolCalls } : {})
    }));

    return [...sysMsgs, ...convoMsgs];
  }
}

/** @experimental */
export function buildWorkingContext(
  events: ContextSessionEvent[],
  options: WorkingContextOptions = {}
): WorkingContext {
  const mapper = options.eventToMessage ?? contextEventToMessage;
  const messages: ContextMessage[] = [];
  const systemInstructions = options.systemInstructions
    ? [...options.systemInstructions]
    : [];
  const staticSystemInstructions = options.staticSystemInstructions
    ? [...options.staticSystemInstructions]
    : [];

  for (const event of events) {
    if (event.action === "system_instruction") {
      if (event.stable === true) {
        staticSystemInstructions.push(event.content);
      } else {
        systemInstructions.push(event.content);
      }
      continue;
    }

    const msg = mapper(event);
    if (msg) {
      messages.push(msg);
    }
  }

  return new WorkingContext({
    messages,
    systemInstructions,
    staticSystemInstructions
  });
}
