/**
 * @experimental Context primitives — unstable and may change without notice.
 */

export const ContextEventAction = {
  USER_MESSAGE: "user_message",
  AGENT_MESSAGE: "agent_message",
  TOOL_CALL_REQUEST: "tool_call_request",
  TOOL_RESULT: "tool_result",
  SYSTEM_INSTRUCTION: "system_instruction",
  COMPACTION: "compaction",
  MEMORY_SNIPPET: "memory_snippet",
  ARTIFACT_REF: "artifact_ref",
  HANDOFF_NOTE: "handoff_note"
} as const;

export type ContextEventActionType =
  (typeof ContextEventAction)[keyof typeof ContextEventAction];

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface StoredContextSession {
  id: string;
  agent_id: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

export interface StoredContextEvent {
  id: string;
  session_id: string;
  seq: number;
  action: string;
  content: string | null;
  metadata: string | null;
  created_at: number;
}

interface BaseContextEvent {
  id: string;
  sessionId: string;
  seq: number;
  timestamp: number;
}

export type ContextSessionEvent =
  | (BaseContextEvent & {
      action: typeof ContextEventAction.USER_MESSAGE;
      content: string;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.AGENT_MESSAGE;
      content: string;
      model?: string;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.TOOL_CALL_REQUEST;
      toolCalls: ToolCall[];
      content?: string;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.TOOL_RESULT;
      toolCallId: string;
      toolName: string;
      output: unknown;
      content?: string;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.SYSTEM_INSTRUCTION;
      content: string;
      stable?: boolean;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.COMPACTION;
      content: string;
      replacesSeqRange?: [number, number];
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.MEMORY_SNIPPET;
      content: string;
      source?: string;
      score?: number;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.ARTIFACT_REF;
      content: string;
      artifactName: string;
      artifactVersion?: string;
      ephemeral?: boolean;
    })
  | (BaseContextEvent & {
      action: typeof ContextEventAction.HANDOFF_NOTE;
      content: string;
      fromAgent?: string;
      toAgent?: string;
    });

export interface ContextMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  metadata?: {
    stable?: boolean;
    sourceEventId?: string;
    sourceAction?: ContextEventActionType;
    sourceAgent?: string;
    [key: string]: unknown;
  };
}

export interface LoadContextEventsOptions {
  limit?: number;
  since?: number;
  actions?: ContextEventActionType[];
  tail?: boolean;
}

export interface WorkingContextOptions {
  systemInstructions?: string[];
  staticSystemInstructions?: string[];
  eventToMessage?: (event: ContextSessionEvent) => ContextMessage | null;
}

export interface ContextTrace {
  processor: string;
  beforeEventCount: number;
  afterEventCount: number;
  beforeMessageCount: number;
  afterMessageCount: number;
  details?: Record<string, unknown>;
}

export interface MemorySnippet {
  id: string;
  content: string;
  score?: number;
  source?: string;
}

export interface ArtifactHandle {
  name: string;
  version?: string;
  summary: string;
  ephemeral?: boolean;
}

export interface MemoryRetriever {
  retrieve(input: {
    sessionId: string;
    latestUserMessage: string | null;
    messages: ContextMessage[];
  }): Promise<MemorySnippet[]>;
}

export interface ArtifactResolver {
  resolve(input: {
    sessionId: string;
    latestUserMessage: string | null;
    messages: ContextMessage[];
  }): Promise<ArtifactHandle[]>;
}

export interface ContextCompileState {
  sessionId: string;
  events: ContextSessionEvent[];
  messages: ContextMessage[];
  systemInstructions: string[];
  staticSystemInstructions: string[];
  traces: ContextTrace[];
  metadata: Record<string, unknown>;
}

export interface ContextProcessor {
  name: string;
  process(state: ContextCompileState): Promise<ContextCompileState>;
}

export interface CompileContextOptions extends WorkingContextOptions {
  load?: LoadContextEventsOptions;
  processors?: ContextProcessor[];
  memoryRetriever?: MemoryRetriever;
  artifactResolver?: ArtifactResolver;
}

export interface CompactionSummarizer {
  summarize(input: {
    sessionId: string;
    events: ContextSessionEvent[];
  }): Promise<string>;
}

export interface CompactSessionOptions {
  keepTailEvents?: number;
  summarizer: CompactionSummarizer;
  deleteCompactedEvents?: boolean;
}

export type HandoffIncludeMode =
  | "none"
  | "latest-turn"
  | "recent"
  | "full"
  | "custom";

export interface HandoffOptions {
  include?: HandoffIncludeMode;
  customSelector?: (messages: ContextMessage[]) => ContextMessage[];
  latestUserPrompt?: string;
  fromAgent?: string;
  toAgent?: string;
  recastPriorAssistantAsUserContext?: boolean;
  recentLimit?: number;
}
