# Context Management Demo

This example demonstrates a production-oriented context management workflow in Agents SDK:

- durable Session + Event storage (`ContextSessionAgent`)
- ephemeral per-call `WorkingContext`
- explicit context compiler pipeline with processor traces
- on-demand memory injection
- scoped multi-agent handoff context
- session compaction

## Run locally

```bash
npm install
cd examples/context-management
```

Start dev:

```bash
npm run start
```

## What to try

1. Send a few profile messages (location/work/likes) in memory mode.
2. Ask follow-up questions to verify memory recall.
3. Click **Compact old events** after multiple turns.
4. Inspect the **Scoped handoff preview** and persisted event stream.

## Key files

- `src/server.ts` — `ContextDemoAgent` implementation using `agents/experimental/context`
- `src/app.tsx` — UI for chat, traces, handoff preview, and event inspection
