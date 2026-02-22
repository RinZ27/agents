import {
  ContextEventAction,
  type ContextMessage,
  type ContextSessionEvent,
  type StoredContextEvent,
  type ToolCall
} from "./types";

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function serializeMetadata(metadata: Record<string, unknown>): string | null {
  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined
  );

  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

function readMessageMetadata(
  meta: Record<string, unknown>
): Record<string, unknown> | undefined {
  const value = meta["messageMetadata"];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** @experimental */
export function getCompactionMetadata<T extends Record<string, unknown>>(
  event: ContextSessionEvent
): T | null {
  if (
    event.action !== ContextEventAction.COMPACTION ||
    !event.metadata ||
    typeof event.metadata !== "object"
  ) {
    return null;
  }

  return event.metadata as T;
}

/** @experimental */
export function setCompactionMetadata<T extends Record<string, unknown>>(
  event: ContextSessionEvent,
  metadata: T
): ContextSessionEvent {
  if (event.action !== ContextEventAction.COMPACTION) {
    return event;
  }

  return {
    ...event,
    metadata
  };
}

/** @deprecated Use getCompactionMetadata */
export const getEventMetadata = getCompactionMetadata;

/** @deprecated Use setCompactionMetadata */
export const setEventMetadata = setCompactionMetadata;

/** @experimental */
export function hydrateContextEvent(
  row: StoredContextEvent
): ContextSessionEvent {
  const meta = parseMetadata(row.metadata);

  switch (row.action) {
    case ContextEventAction.USER_MESSAGE:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.USER_MESSAGE,
        content: row.content ?? "",
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.AGENT_MESSAGE:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.AGENT_MESSAGE,
        content: row.content ?? "",
        model: typeof meta.model === "string" ? meta.model : undefined,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.TOOL_CALL_REQUEST:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.TOOL_CALL_REQUEST,
        content: row.content ?? undefined,
        toolCalls: Array.isArray(meta.toolCalls)
          ? (meta.toolCalls as ToolCall[])
          : [],
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.TOOL_RESULT:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.TOOL_RESULT,
        content: row.content ?? undefined,
        toolCallId: typeof meta.toolCallId === "string" ? meta.toolCallId : "",
        toolName: typeof meta.toolName === "string" ? meta.toolName : "tool",
        output: meta.output,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.SYSTEM_INSTRUCTION:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.SYSTEM_INSTRUCTION,
        content: row.content ?? "",
        stable: meta.stable === true,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.COMPACTION:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.COMPACTION,
        content: row.content ?? "",
        replacesSeqRange: Array.isArray(meta.replacesSeqRange)
          ? (meta.replacesSeqRange as [number, number])
          : undefined,
        metadata:
          meta.metadata && typeof meta.metadata === "object"
            ? (meta.metadata as Record<string, unknown>)
            : undefined,
        timestamp: row.created_at
      };

    case ContextEventAction.MEMORY_SNIPPET:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.MEMORY_SNIPPET,
        content: row.content ?? "",
        source: typeof meta.source === "string" ? meta.source : undefined,
        score: typeof meta.score === "number" ? meta.score : undefined,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.ARTIFACT_REF:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.ARTIFACT_REF,
        content: row.content ?? "",
        artifactName:
          typeof meta.artifactName === "string"
            ? meta.artifactName
            : "artifact",
        artifactVersion:
          typeof meta.artifactVersion === "string"
            ? meta.artifactVersion
            : undefined,
        ephemeral: meta.ephemeral === true,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    case ContextEventAction.HANDOFF_NOTE:
      return {
        id: row.id,
        sessionId: row.session_id,
        seq: row.seq,
        action: ContextEventAction.HANDOFF_NOTE,
        content: row.content ?? "",
        fromAgent:
          typeof meta.fromAgent === "string" ? meta.fromAgent : undefined,
        toAgent: typeof meta.toAgent === "string" ? meta.toAgent : undefined,
        messageMetadata: readMessageMetadata(meta),
        timestamp: row.created_at
      };

    default:
      throw new Error(`Unknown context event action: ${row.action}`);
  }
}

/** @experimental */
export function dehydrateContextEvent(
  event: ContextSessionEvent
): StoredContextEvent {
  const base: StoredContextEvent = {
    id: event.id,
    session_id: event.sessionId,
    seq: event.seq,
    action: event.action,
    content: null,
    metadata: null,
    created_at: event.timestamp
  };

  switch (event.action) {
    case ContextEventAction.USER_MESSAGE:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({ messageMetadata: event.messageMetadata })
      };

    case ContextEventAction.AGENT_MESSAGE:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          model: event.model,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.COMPACTION:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          replacesSeqRange: event.replacesSeqRange,
          metadata: event.metadata,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.SYSTEM_INSTRUCTION:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          stable: event.stable === true,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.MEMORY_SNIPPET:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          source: event.source,
          score: event.score,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.HANDOFF_NOTE:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          fromAgent: event.fromAgent,
          toAgent: event.toAgent,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.TOOL_CALL_REQUEST:
      return {
        ...base,
        content: event.content ?? null,
        metadata: serializeMetadata({
          toolCalls: event.toolCalls,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.TOOL_RESULT:
      return {
        ...base,
        content: event.content ?? null,
        metadata: serializeMetadata({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.output,
          messageMetadata: event.messageMetadata
        })
      };

    case ContextEventAction.ARTIFACT_REF:
      return {
        ...base,
        content: event.content,
        metadata: serializeMetadata({
          artifactName: event.artifactName,
          artifactVersion: event.artifactVersion,
          ephemeral: event.ephemeral,
          messageMetadata: event.messageMetadata
        })
      };
  }
}

/** @experimental */
export function contextEventToMessage(
  event: ContextSessionEvent
): ContextMessage | null {
  switch (event.action) {
    case ContextEventAction.USER_MESSAGE:
      return {
        role: "user",
        content: event.content,
        metadata: {
          ...event.messageMetadata,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.AGENT_MESSAGE:
      return {
        role: "assistant",
        content: event.content,
        metadata: {
          ...event.messageMetadata,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.TOOL_CALL_REQUEST:
      return {
        role: "assistant",
        content: event.content ?? "",
        toolCalls: event.toolCalls,
        metadata: {
          ...event.messageMetadata,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.TOOL_RESULT:
      return {
        role: "tool",
        name: event.toolName,
        toolCallId: event.toolCallId,
        content:
          event.content ??
          (typeof event.output === "string"
            ? event.output
            : JSON.stringify(event.output ?? null)),
        metadata: {
          ...event.messageMetadata,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.COMPACTION:
      return {
        role: "system",
        content: `[Compacted summary] ${event.content}`,
        metadata: {
          ...event.messageMetadata,
          stable: true,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.MEMORY_SNIPPET:
      return {
        role: "system",
        content: `[Memory] ${event.content}`,
        metadata: {
          ...event.messageMetadata,
          stable: true,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.ARTIFACT_REF:
      return {
        role: "system",
        content: `[Artifact: ${event.artifactName}] ${event.content}`,
        metadata: {
          ...event.messageMetadata,
          stable: event.ephemeral !== true,
          sourceEventId: event.id,
          sourceAction: event.action
        }
      };

    case ContextEventAction.HANDOFF_NOTE:
      return {
        role: "system",
        content: `[Handoff] ${event.content}`,
        metadata: {
          ...event.messageMetadata,
          stable: true,
          sourceEventId: event.id,
          sourceAction: event.action,
          sourceAgent: event.fromAgent
        }
      };

    case ContextEventAction.SYSTEM_INSTRUCTION:
      return null;

    default:
      return null;
  }
}

/** @experimental */
export function contextMessageToEvent(
  sessionId: string,
  message: ContextMessage
): ContextSessionEvent {
  const common = {
    id: crypto.randomUUID(),
    sessionId,
    seq: -1,
    timestamp: Date.now()
  };

  if (message.role === "user") {
    return {
      ...common,
      action: ContextEventAction.USER_MESSAGE,
      content: message.content,
      messageMetadata: message.metadata
    };
  }

  if (message.role === "tool") {
    return {
      ...common,
      action: ContextEventAction.TOOL_RESULT,
      toolCallId: message.toolCallId ?? "",
      toolName: message.name ?? "tool",
      content: message.content,
      output: message.content,
      messageMetadata: message.metadata
    };
  }

  if (message.role === "system") {
    return {
      ...common,
      action: ContextEventAction.SYSTEM_INSTRUCTION,
      content: message.content,
      stable: message.metadata?.stable === true,
      messageMetadata: message.metadata
    };
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    return {
      ...common,
      action: ContextEventAction.TOOL_CALL_REQUEST,
      content: message.content,
      toolCalls: message.toolCalls,
      messageMetadata: message.metadata
    };
  }

  return {
    ...common,
    action: ContextEventAction.AGENT_MESSAGE,
    content: message.content,
    messageMetadata: message.metadata
  };
}
