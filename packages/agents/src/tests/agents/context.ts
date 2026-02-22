import { callable } from "../../index.ts";
import {
  ContextSessionAgent,
  WorkingContext,
  contextMessageToEvent,
  type ContextSessionEvent,
  type UpsertContextMemoryInput
} from "../../experimental/context/index.ts";

export class TestContextAgent extends ContextSessionAgent<
  Cloudflare.Env,
  Record<string, never>
> {
  initialState: Record<string, never> = {};

  @callable()
  createSessionWithTurns(turns: number): string {
    const sessionId = this.createSession({ turns });
    const events: ContextSessionEvent[] = [];

    for (let i = 1; i <= turns; i++) {
      events.push(
        contextMessageToEvent(sessionId, {
          role: "user",
          content: `user-${i}`
        })
      );
      events.push(
        contextMessageToEvent(sessionId, {
          role: "assistant",
          content: `assistant-${i}`
        })
      );
    }

    this.appendEvents(sessionId, events);
    return sessionId;
  }

  @callable()
  upsertMemoryEntries(
    sessionId: string,
    entries: UpsertContextMemoryInput[],
    replaceByKey = false
  ): void {
    this.upsertMemory(sessionId, entries, { replaceByKey });
  }

  @callable()
  getMemoryEntries(sessionId: string): Array<{
    key: string;
    value: string;
    source?: string;
    score?: number;
  }> {
    return this.loadMemory(sessionId, { limit: 100 }).map((entry) => ({
      key: entry.key,
      value: entry.value,
      source: entry.source,
      score: entry.score
    }));
  }

  @callable()
  appendUserMessages(sessionId: string, contents: string[]): void {
    const events = contents.map((content) =>
      contextMessageToEvent(sessionId, {
        role: "user",
        content
      })
    );
    this.appendEvents(sessionId, events);
  }

  @callable()
  tryAppendUserMessages(
    sessionId: string,
    contents: string[]
  ): { ok: boolean; error?: string } {
    try {
      this.appendUserMessages(sessionId, contents);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  @callable()
  getEventActions(sessionId: string): string[] {
    return this.loadEvents(sessionId, { limit: 10_000, tail: false }).map(
      (event) => event.action
    );
  }

  @callable()
  getFilteredEventActions(
    sessionId: string,
    options: {
      limit?: number;
      since?: number;
      actions?: string[];
      tail?: boolean;
    }
  ): string[] {
    return this.loadEvents(sessionId, {
      limit: options.limit,
      since: options.since,
      actions: options.actions as ContextSessionEvent["action"][] | undefined,
      tail: options.tail
    }).map((event) => event.action);
  }

  @callable()
  getFilteredEventContents(
    sessionId: string,
    options: {
      limit?: number;
      since?: number;
      actions?: string[];
      tail?: boolean;
    }
  ): string[] {
    return this.loadEvents(sessionId, {
      limit: options.limit,
      since: options.since,
      actions: options.actions as ContextSessionEvent["action"][] | undefined,
      tail: options.tail
    }).map((event) => {
      if ("content" in event && typeof event.content === "string") {
        return event.content;
      }
      return event.action;
    });
  }

  @callable()
  getSessionExists(sessionId: string): boolean {
    return this.getSession(sessionId) !== null;
  }

  @callable()
  deleteSessionAndVerifyCascade(sessionId: string): {
    sessionExists: boolean;
    eventCount: number;
    memoryCount: number;
  } {
    this.deleteSession(sessionId);
    return {
      sessionExists: this.getSession(sessionId) !== null,
      eventCount: this.loadEvents(sessionId, { limit: 1000, tail: false })
        .length,
      memoryCount: this.loadMemory(sessionId, { limit: 1000 }).length
    };
  }

  @callable()
  getEventContents(sessionId: string): string[] {
    return this.loadEvents(sessionId, { limit: 10_000, tail: false }).map(
      (event) => {
        if ("content" in event && typeof event.content === "string") {
          return event.content;
        }
        return event.action;
      }
    );
  }

  @callable()
  getLastCompactionMetadata(sessionId: string): Record<string, unknown> | null {
    const events = this.loadEvents(sessionId, { limit: 10_000, tail: false });
    const lastCompaction = [...events]
      .reverse()
      .find((event) => event.action === "compaction");

    if (!lastCompaction || lastCompaction.action !== "compaction") {
      return null;
    }

    return lastCompaction.metadata ?? null;
  }

  @callable()
  persistAssistantMessageWithMetadata(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>
  ): void {
    const context = new WorkingContext();
    context.addMessage({ role: "assistant", content, metadata });
    this.persistWorkingContext(sessionId, context);
  }

  @callable()
  getLastAssistantMessageMetadata(
    sessionId: string
  ): Record<string, unknown> | null {
    const context = this.buildWorkingContext(sessionId, {
      load: { limit: 10_000, tail: false }
    });

    const lastAssistant = [...context.messages]
      .reverse()
      .find((message) => message.role === "assistant");

    return (
      (lastAssistant?.metadata as Record<string, unknown> | undefined) ?? null
    );
  }

  @callable()
  async compileContextWithMemory(
    sessionId: string
  ): Promise<{ traceProcessors: string[]; memoryMessageCount: number }> {
    const context = await this.compileWorkingContext(sessionId, {
      load: { limit: 20, tail: true },
      memoryRetriever: {
        async retrieve() {
          return [{ id: "m1", content: "Remembered fact", source: "test" }];
        }
      }
    });

    return {
      traceProcessors: context.traces.map((trace) => trace.processor),
      memoryMessageCount: context.messages.filter(
        (m) => m.role === "system" && m.content.includes("[Memory")
      ).length
    };
  }

  @callable()
  async destroyForTest(): Promise<void> {
    await this.destroy();
  }

  @callable()
  async compactAndSummarize(
    sessionId: string,
    keepTailEvents = 4,
    withMetadata = false
  ): Promise<string | null> {
    const result = await this.compactSession(sessionId, {
      keepTailEvents,
      deleteCompactedEvents: true,
      summarizer: {
        summarize: async ({ events }) => {
          const preview = events
            .slice(0, 3)
            .map((event) =>
              "content" in event && typeof event.content === "string"
                ? event.content
                : event.action
            )
            .join(",");

          const content = `compacted:${events.length}:${preview}`;
          if (!withMetadata) {
            return content;
          }

          return {
            content,
            metadata: {
              compactedCount: events.length,
              preview
            }
          };
        }
      }
    });

    return result?.content ?? null;
  }
}
