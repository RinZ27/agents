import { callable } from "../../index.ts";
import {
  ContextSessionAgent,
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
  getEventActions(sessionId: string): string[] {
    return this.loadEvents(sessionId, { limit: 10_000, tail: false }).map(
      (event) => event.action
    );
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
