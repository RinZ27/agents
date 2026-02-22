import { callable } from "../../index.ts";
import {
  ContextSessionAgent,
  contextMessageToEvent,
  type ContextSessionEvent
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
  async compactAndSummarize(
    sessionId: string,
    keepTailEvents = 4
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
          return `compacted:${events.length}:${preview}`;
        }
      }
    });

    return result?.content ?? null;
  }
}
