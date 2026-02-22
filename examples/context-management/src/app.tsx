import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Empty, Input, Surface, Text } from "@cloudflare/kumo";
import {
  ConnectionIndicator,
  ModeToggle,
  PoweredByAgents
} from "@cloudflare/agents-ui";
import type { ConnectionStatus } from "@cloudflare/agents-ui";
import { Info } from "@phosphor-icons/react";
import type { ChatResult, EventRow, SessionSummary } from "./server";

type ChatEntry = {
  role: "user" | "assistant";
  content: string;
};

export default function App() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [traces, setTraces] = useState<ChatResult["traces"]>([]);
  const [handoffPreview, setHandoffPreview] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [lastMemorySnippetCount, setLastMemorySnippetCount] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [lastAction, setLastAction] = useState("Waiting for first message...");

  const agent = useAgent<Record<string, never>>({
    agent: "ContextDemoAgent",
    name: "demo",
    onOpen: () => setConnectionStatus("connected"),
    onClose: () => setConnectionStatus("disconnected")
  });

  const connected = connectionStatus === "connected";

  const callAgent = useCallback(
    async <T,>(method: string, args: unknown[]): Promise<T> => {
      return (await agent.call(method, args)) as T;
    },
    [agent]
  );

  const refreshEvents = useCallback(
    async (id: string) => {
      if (!id) return;
      const rows = await callAgent<EventRow[]>("getSessionEvents", [id]);
      setEvents(rows);
      setChat(
        rows
          .filter(
            (row) =>
              row.action === "user_message" ||
              row.action === "agent_message" ||
              row.action === "compaction"
          )
          .map((row) => ({
            role:
              row.action === "user_message"
                ? ("user" as const)
                : ("assistant" as const),
            content: row.content
          }))
      );
    },
    [callAgent]
  );

  const refreshSessions = useCallback(async (): Promise<SessionSummary[]> => {
    const rows = await callAgent<SessionSummary[]>("listSessionSummaries", []);
    setSessions(rows);
    return rows;
  }, [callAgent]);

  const startSession = useCallback(async () => {
    const result = await callAgent<{ sessionId: string }>("startSession", []);
    setSessionId(result.sessionId);
    setTraces([]);
    setHandoffPreview([]);
    setLastMemorySnippetCount(0);
    await refreshEvents(result.sessionId);
    await refreshSessions();
    setLastAction(`Started session ${result.sessionId.slice(0, 8)}`);
  }, [callAgent, refreshEvents, refreshSessions]);

  useEffect(() => {
    if (!connected) return;
    void refreshSessions();
    if (!sessionId) void startSession();
  }, [connected, refreshSessions, sessionId, startSession]);

  const sendMessage = useCallback(async () => {
    if (!sessionId || !message.trim() || isSending) return;

    const userMessage = message.trim();
    setMessage("");
    setIsSending(true);

    try {
      const result = await callAgent<ChatResult>("chat", [
        sessionId,
        userMessage
      ]);

      setSessionId(result.sessionId);
      setTraces(result.traces);
      setHandoffPreview(result.handoffPreview);
      setLastMemorySnippetCount(result.memorySnippetCount);
      await refreshEvents(result.sessionId);
      await refreshSessions();
      setLastAction(`Processed message · traces ${result.traces.length}`);
    } finally {
      setIsSending(false);
    }
  }, [
    callAgent,
    isSending,
    message,
    refreshEvents,
    refreshSessions,
    sessionId
  ]);

  const compact = useCallback(async () => {
    if (!sessionId) return;
    const result = await callAgent<{ compacted: boolean; summary?: string }>(
      "compact",
      [sessionId]
    );
    await refreshEvents(sessionId);
    await refreshSessions();
    setLastAction(
      result.compacted
        ? "Compaction completed: older events summarized"
        : "Compaction skipped: not enough events yet"
    );
  }, [callAgent, refreshEvents, refreshSessions, sessionId]);

  const switchSession = useCallback(
    async (id: string) => {
      setSessionId(id);
      setTraces([]);
      setHandoffPreview([]);
      setLastMemorySnippetCount(0);
      await refreshEvents(id);
      setLastAction(`Switched to session ${id.slice(0, 8)}`);
    },
    [refreshEvents]
  );

  const removeSession = useCallback(
    async (id: string) => {
      const confirmed = window.confirm(
        `Delete session ${id.slice(0, 8)}? This removes all its events.`
      );
      if (!confirmed) return;

      const result = await callAgent<{ removed: boolean }>("removeSession", [
        id
      ]);
      if (!result.removed) {
        setLastAction(`Session ${id.slice(0, 8)} was already removed`);
        await refreshSessions();
        return;
      }

      const updated = await refreshSessions();

      if (id !== sessionId) {
        setLastAction(`Removed session ${id.slice(0, 8)}`);
        return;
      }

      const next = updated[0];
      if (!next) {
        await startSession();
        setLastAction("Removed session and created a new one");
        return;
      }

      setSessionId(next.id);
      setTraces([]);
      setHandoffPreview([]);
      setLastMemorySnippetCount(0);
      await refreshEvents(next.id);
      setLastAction(`Removed session and switched to ${next.id.slice(0, 8)}`);
    },
    [callAgent, refreshEvents, refreshSessions, sessionId, startSession]
  );

  const traceSummary = useMemo(() => {
    if (traces.length === 0) return "No processor traces yet";
    return traces
      .map(
        (trace) =>
          `${trace.processor}: ${trace.beforeMessageCount}→${trace.afterMessageCount}`
      )
      .join(" | ");
  }, [traces]);

  const hasSession = sessionId.length > 0;
  const hasChat = chat.length > 0;
  const hasEvents = events.length > 0;
  const hasTraces = traces.length > 0;

  const compactionThreshold = 9;
  const canCompact = events.length >= compactionThreshold;
  const eventsUntilCompaction = Math.max(
    0,
    compactionThreshold - events.length
  );

  return (
    <div className="min-h-screen bg-kumo-elevated">
      <div className="w-full max-w-none px-5 py-6 lg:px-8 lg:py-8">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Text variant="heading1">Context Management Demo</Text>
            <span className="mt-1 block">
              <Text size="sm" variant="secondary">
                Session events → compiled working context → optional compaction.
              </Text>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionIndicator status={connectionStatus} />
            <ModeToggle />
          </div>
        </header>

        <Surface className="mb-4 rounded-xl p-4 ring ring-kumo-line">
          <div className="flex flex-wrap items-center gap-3">
            <Info size={20} className="text-kumo-accent" weight="bold" />
            <Badge variant="secondary">
              {connected ? "✅ Connected" : "❌ Not connected"}
            </Badge>
            <Badge variant="secondary">
              {hasSession ? `Session ${sessionId.slice(0, 8)}` : "No session"}
            </Badge>
            <Badge variant="secondary">
              {canCompact
                ? `✅ Compaction ready (${events.length} events)`
                : `⏳ ${eventsUntilCompaction} more event${eventsUntilCompaction === 1 ? "" : "s"} for compaction`}
            </Badge>
            <Button
              variant="secondary"
              onClick={startSession}
              disabled={isSending}
            >
              New session
            </Button>
            <Button variant="secondary" onClick={compact} disabled={isSending}>
              Compact old events
            </Button>
          </div>
          <span className="mt-2 block">
            <Text size="sm" variant="secondary">
              Last action: {lastAction}
            </Text>
          </span>
        </Surface>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr_1fr]">
          <Surface className="rounded-xl p-4 ring ring-kumo-line">
            <div className="mb-2 flex items-center justify-between">
              <Text size="lg" bold>
                Sessions
              </Text>
              <Badge variant="secondary">{sessions.length}</Badge>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-auto rounded border border-kumo-line bg-kumo-base p-2">
              {sessions.length === 0 ? (
                <Text size="sm" variant="secondary">
                  No sessions yet
                </Text>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded border border-kumo-line p-2"
                  >
                    <Text size="sm" bold>
                      {session.id.slice(0, 8)}
                    </Text>
                    <span className="block">
                      <Text size="xs" variant="secondary">
                        {session.eventCount} events
                      </Text>
                    </span>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant={
                          session.id === sessionId ? "primary" : "secondary"
                        }
                        onClick={() => void switchSession(session.id)}
                        disabled={isSending}
                      >
                        {session.id === sessionId ? "Current" : "Switch"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void removeSession(session.id)}
                        disabled={isSending}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Surface>

          <Surface className="rounded-xl p-4 ring ring-kumo-line">
            <div className="mb-2 flex items-center justify-between">
              <Text size="lg" bold>
                Chat
              </Text>
              <Badge variant="secondary">{hasChat ? "✅ Live" : "Idle"}</Badge>
            </div>

            <span className="mb-3 block">
              <Text size="sm" variant="secondary">
                Memory mode is always enabled in this demo.
              </Text>
            </span>

            <div className="mb-3">
              <Text size="sm" bold>
                Prompt input
              </Text>
              <div className="mt-1 w-full min-w-0 rounded-lg border-2 border-kumo-brand bg-kumo-base p-1">
                <Input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !isSending
                    ) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Type a prompt and press Enter…"
                  aria-label="Chat input"
                  className="w-full"
                  disabled={isSending}
                />
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  onClick={sendMessage}
                  disabled={!message.trim() || !connected || isSending}
                >
                  {isSending ? "Sending..." : "Send"}
                </Button>
              </div>
            </div>

            <div className="max-h-[52vh] space-y-2 overflow-auto rounded-lg border border-kumo-line bg-kumo-base p-3">
              {chat.length === 0 ? (
                <Empty
                  title="No messages yet"
                  description="Send your first message to generate session events."
                />
              ) : (
                chat.map((entry, index) => (
                  <div
                    key={`${entry.role}-${index}`}
                    className="rounded border border-kumo-line p-2"
                  >
                    <Text size="sm" bold>
                      {entry.role === "user" ? "User" : "Assistant"}
                    </Text>
                    <pre className="m-0 whitespace-pre-wrap text-sm text-kumo-default">
                      {entry.content}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </Surface>

          <Surface className="rounded-xl p-4 ring ring-kumo-line">
            <Text size="lg" bold>
              Internals
            </Text>

            <div className="mt-2 space-y-2">
              <Badge variant="secondary">
                {hasEvents ? "✅ Events persisted" : "❌ No events yet"}
              </Badge>
              <Badge variant="secondary">
                {hasTraces ? "✅ Traces generated" : "❌ No traces yet"}
              </Badge>
            </div>

            <span className="mt-2 block">
              <Text size="sm" variant="secondary">
                Processor trace: {traceSummary}
              </Text>
            </span>
            <span className="mt-1 block">
              <Text size="sm" variant="secondary">
                Last injected memory snippets: {lastMemorySnippetCount}
              </Text>
            </span>

            <div className="mt-3">
              <Text size="sm" bold>
                Scoped handoff preview
              </Text>
              <div className="mt-1 max-h-28 overflow-auto rounded border border-kumo-line bg-kumo-base p-2">
                {handoffPreview.length === 0 ? (
                  <Text size="sm" variant="secondary">
                    No handoff yet
                  </Text>
                ) : (
                  handoffPreview.map((line, index) => (
                    <pre
                      key={`${line}-${index}`}
                      className="m-0 whitespace-pre-wrap text-sm text-kumo-default"
                    >
                      {line}
                    </pre>
                  ))
                )}
              </div>
            </div>

            <div className="mt-3">
              <Text size="sm" bold>
                Persisted events ({events.length})
              </Text>
              <div className="mt-1 max-h-[40vh] overflow-auto rounded border border-kumo-line bg-kumo-base p-2">
                {events.length === 0 ? (
                  <Text size="sm" variant="secondary">
                    No events yet
                  </Text>
                ) : (
                  events.map((event) => (
                    <div
                      key={event.seq}
                      className="mb-1 rounded border border-kumo-line p-2"
                    >
                      <Text size="sm" bold>
                        #{event.seq} · {event.action}
                      </Text>
                      <pre className="m-0 whitespace-pre-wrap text-sm text-kumo-default">
                        {event.content}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Surface>
        </div>

        <div className="mt-6 flex justify-center">
          <PoweredByAgents />
        </div>
      </div>
    </div>
  );
}
