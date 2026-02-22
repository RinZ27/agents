/**
 * Stable context utilities for composing LLM payloads.
 *
 * This surface intentionally excludes durable session storage and event schemas.
 * For experimental session/event primitives, use `agents/experimental/context`.
 */

export {
  WorkingContext,
  buildWorkingContext
} from "./experimental/context/working-context";
export { createScopedHandoffContext } from "./experimental/context/handoff";
export {
  workersAIContextAdapter,
  type WorkersAIChatMessage
} from "./experimental/context/adapters/workers-ai";
export type {
  ContextMessage,
  HandoffIncludeMode,
  HandoffOptions,
  ToolCall,
  WorkingContextOptions
} from "./experimental/context/types";
