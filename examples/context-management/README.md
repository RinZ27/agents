# Context Management Demo

This example demonstrates a production-oriented context management workflow in Agents SDK:

- durable Session + Event storage (`ContextSessionAgent`)
- ephemeral per-call `WorkingContext`
- explicit context compiler pipeline with processor traces
- on-demand memory/artifact injection
- scoped multi-agent handoff context
- session compaction

## Run locally

```bash
npm install
cd examples/context-management
npm run start
```

## What to try

1. Send a few messages in **Default** mode.
2. Switch to **Inject memory** and observe new context traces/events.
3. Switch to **Inject artifact handle** and compare output.
4. Click **Compact old events** after multiple turns.
5. Inspect the **Scoped handoff preview** and persisted event stream.

## Key files

- `src/server.ts` — `ContextDemoAgent` implementation using `agents/experimental/context`
- `src/app.tsx` — UI for chat, traces, handoff preview, and event inspection
