/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !! WARNING: EXPERIMENTAL API — EXPECT BREAKING CHANGES              !!
 * !!                                                                   !!
 * !! This API is under active development and WILL break between       !!
 * !! releases. Method names, types, behavior, and schema may change    !!
 * !! without notice.                                                    !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 */

console.warn(
  "[agents/experimental/context] WARNING: You are using an experimental API that WILL break between releases."
);

export { ContextSessionAgent } from "./session-agent";
export { WorkingContext, buildWorkingContext } from "./working-context";
export {
  createDefaultProcessors,
  createSelectTailEventsProcessor,
  createEventToMessageProcessor,
  createMemoryRetrievalProcessor,
  createStructuredMemoryProcessor,
  createArtifactResolverProcessor,
  createStablePrefixProcessor,
  runContextProcessors
} from "./processors";
export { createScopedHandoffContext } from "./handoff";
export {
  hydrateContextEvent,
  dehydrateContextEvent,
  contextEventToMessage,
  contextMessageToEvent,
  getEventMetadata,
  setEventMetadata
} from "./utils";
export {
  workersAIContextAdapter,
  type WorkersAIChatMessage
} from "./adapters/workers-ai";
export type {
  ArtifactHandle,
  ArtifactResolver,
  CompactSessionOptions,
  CompactionSummarizer,
  CompactionSummary,
  CompileContextOptions,
  ContextCompileState,
  ContextEventActionType,
  ContextMemoryEntry,
  ContextMessage,
  ContextProcessor,
  ContextSessionEvent,
  ContextTrace,
  HandoffIncludeMode,
  HandoffOptions,
  LoadContextEventsOptions,
  LoadContextMemoryOptions,
  MemoryRetriever,
  MemorySnippet,
  StoredContextEvent,
  StoredContextMemoryEntry,
  StoredContextSession,
  StructuredMemoryProvider,
  ToolCall,
  UpsertContextMemoryInput,
  WorkingContextOptions
} from "./types";
export { ContextEventAction } from "./types";
