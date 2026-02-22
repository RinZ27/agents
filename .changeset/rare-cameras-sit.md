---
"agents": patch
"@cloudflare/ai-chat": patch
---

Update experimental warning copy to remove "Do not use in production" wording while keeping clear instability messaging.

- `agents/experimental/forever`: adjust top-of-file warning banner and runtime `console.warn`
- `agents/experimental/context`: adjust top-of-file warning banner
- `@cloudflare/ai-chat/experimental/forever`: adjust top-of-file warning banner and runtime `console.warn`
