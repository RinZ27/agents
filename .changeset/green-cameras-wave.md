---
"agents": minor
---

Add a new context-management surface to Agents SDK.

### Stable utilities (`agents/context`)

Introduces provider-agnostic context composition primitives:

- `WorkingContext` and `buildWorkingContext`
- context processor helpers (`createDefaultProcessors`, `runContextProcessors`, etc.)
- scoped multi-agent handoff helper (`createScopedHandoffContext`)
- Workers AI adapter (`workersAIContextAdapter`)

### Experimental durable primitives (`agents/experimental/context`)

Adds SQL-backed session/event context primitives behind an experimental export:

- `ContextSessionAgent` with session CRUD + event append/load
- async context compilation pipeline with processor tracing
- pluggable memory retrieval and artifact resolution processors
- session compaction entry point (`compactSession`) with pluggable summarizer
