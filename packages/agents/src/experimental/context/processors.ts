import { contextEventToMessage } from "./utils";
import {
  ContextEventAction,
  type ArtifactResolver,
  type CompileContextOptions,
  type ContextCompileState,
  type ContextMessage,
  type ContextProcessor,
  type ContextSessionEvent,
  type MemoryRetriever,
  type StructuredMemoryProvider
} from "./types";

const DEFAULT_LIMIT = 50;

function latestUserMessage(events: ContextSessionEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.action === ContextEventAction.USER_MESSAGE) {
      return ev.content;
    }
  }
  return null;
}

/** @experimental */
export function createSelectTailEventsProcessor(
  limit = DEFAULT_LIMIT
): ContextProcessor {
  return {
    name: "select-tail-events",
    async process(state) {
      if (state.events.length <= limit) return state;

      const selected = state.events.slice(-limit);
      return {
        ...state,
        events: selected
      };
    }
  };
}

/** @experimental */
export function createEventToMessageProcessor(
  mapper: (
    event: ContextSessionEvent
  ) => ContextMessage | null = contextEventToMessage
): ContextProcessor {
  return {
    name: "event-to-message",
    async process(state) {
      const messages = state.events.map(mapper).filter((msg) => msg !== null);
      return {
        ...state,
        messages
      };
    }
  };
}

/** @experimental */
export function createTokenBudgetProcessor(
  maxTokenEstimate: number
): ContextProcessor {
  return {
    name: "token-budget",
    async process(state) {
      if (maxTokenEstimate <= 0) return state;

      const estimate = (text: string): number => Math.ceil(text.length / 4);
      const systemEstimate = state.staticSystemInstructions
        .concat(state.systemInstructions)
        .reduce((sum, text) => sum + estimate(text), 0);

      let used = systemEstimate;
      const selected: typeof state.messages = [];

      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        const msgCost = estimate(msg.content);
        if (used + msgCost > maxTokenEstimate) {
          continue;
        }

        selected.push(msg);
        used += msgCost;
      }

      selected.reverse();

      return {
        ...state,
        messages: selected
      };
    }
  };
}

/** @experimental */
export function createMemoryRetrievalProcessor(
  retriever: MemoryRetriever
): ContextProcessor {
  return {
    name: "memory-retrieval",
    async process(state) {
      const snippets = await retriever.retrieve({
        sessionId: state.sessionId,
        latestUserMessage: latestUserMessage(state.events),
        messages: state.messages
      });

      if (snippets.length === 0) return state;

      const injected = snippets.map((snippet) => ({
        role: "system" as const,
        content: `[Memory:${snippet.source ?? "memory"}] ${snippet.content}`,
        metadata: {
          stable: true,
          source: snippet.source,
          score: snippet.score,
          memoryId: snippet.id
        }
      }));

      return {
        ...state,
        messages: [...injected, ...state.messages]
      };
    }
  };
}

/** @experimental */
export function createStructuredMemoryProcessor(
  provider: StructuredMemoryProvider
): ContextProcessor {
  return {
    name: "structured-memory",
    async process(state) {
      const latest = latestUserMessage(state.events);
      const memory = await provider.load({
        sessionId: state.sessionId,
        latestUserMessage: latest,
        messages: state.messages
      });

      const mergedMetadata = {
        ...state.metadata,
        structuredMemory: memory
      };

      if (!provider.toSnippets) {
        return {
          ...state,
          metadata: mergedMetadata
        };
      }

      const snippets = await provider.toSnippets({
        memory,
        sessionId: state.sessionId,
        latestUserMessage: latest,
        messages: state.messages
      });

      if (snippets.length === 0) {
        return {
          ...state,
          metadata: mergedMetadata
        };
      }

      const injected = snippets.map((snippet) => ({
        role: "system" as const,
        content: `[Memory:${snippet.source ?? "structured"}] ${snippet.content}`,
        metadata: {
          stable: true,
          source: snippet.source,
          score: snippet.score,
          memoryId: snippet.id
        }
      }));

      return {
        ...state,
        metadata: mergedMetadata,
        messages: [...injected, ...state.messages]
      };
    }
  };
}

/** @experimental */
export function createArtifactResolverProcessor(
  resolver: ArtifactResolver
): ContextProcessor {
  return {
    name: "artifact-resolver",
    async process(state) {
      const handles = await resolver.resolve({
        sessionId: state.sessionId,
        latestUserMessage: latestUserMessage(state.events),
        messages: state.messages
      });

      if (handles.length === 0) return state;

      const artifactMessages = handles.map((handle) => ({
        role: "system" as const,
        content: `[Artifact ${handle.name}${
          handle.version ? `@${handle.version}` : ""
        }] ${handle.summary}`,
        metadata: {
          stable: handle.ephemeral !== true,
          artifactName: handle.name,
          artifactVersion: handle.version,
          ephemeral: handle.ephemeral === true
        }
      }));

      return {
        ...state,
        messages: [...artifactMessages, ...state.messages]
      };
    }
  };
}

/** @experimental */
export function createStablePrefixProcessor(): ContextProcessor {
  return {
    name: "stable-prefix",
    async process(state) {
      const stable = state.messages.filter(
        (msg) => msg.metadata?.stable === true
      );
      const dynamic = state.messages.filter(
        (msg) => msg.metadata?.stable !== true
      );
      return {
        ...state,
        messages: [...stable, ...dynamic]
      };
    }
  };
}

/** @experimental */
export async function runContextProcessors(
  state: ContextCompileState,
  processors: ContextProcessor[]
): Promise<ContextCompileState> {
  let current = state;

  for (const processor of processors) {
    const beforeEventCount = current.events.length;
    const beforeMessageCount = current.messages.length;
    current = await processor.process(current);
    current = {
      ...current,
      traces: [
        ...current.traces,
        {
          processor: processor.name,
          beforeEventCount,
          afterEventCount: current.events.length,
          beforeMessageCount,
          afterMessageCount: current.messages.length
        }
      ]
    };
  }

  return current;
}

/** @experimental */
export function createDefaultProcessors(
  options: CompileContextOptions
): ContextProcessor[] {
  const limit = options.load?.limit ?? DEFAULT_LIMIT;
  const processors: ContextProcessor[] = [
    createSelectTailEventsProcessor(limit),
    createEventToMessageProcessor(options.eventToMessage)
  ];

  if (options.structuredMemoryProvider) {
    processors.push(
      createStructuredMemoryProcessor(options.structuredMemoryProvider)
    );
  }

  if (options.memoryRetriever) {
    processors.push(createMemoryRetrievalProcessor(options.memoryRetriever));
  }

  if (options.artifactResolver) {
    processors.push(createArtifactResolverProcessor(options.artifactResolver));
  }

  processors.push(createStablePrefixProcessor());

  if (typeof options.maxTokenEstimate === "number") {
    processors.push(createTokenBudgetProcessor(options.maxTokenEstimate));
  }

  return processors;
}
