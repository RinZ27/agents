/**
 * Context composition utilities for building LLM payloads.
 *
 * Note: these are convenience re-exports from the experimental context
 * implementation and may evolve as that API stabilizes.
 * For full session/event primitives, use `agents/experimental/context`.
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
