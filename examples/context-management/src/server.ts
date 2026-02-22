import { callable, routeAgentRequest } from "agents";
import {
  ContextSessionAgent,
  contextMessageToEvent,
  createScopedHandoffContext,
  type ContextMessage,
  type ContextTrace,
  type HandoffOptions,
  type MemoryRetriever,
  type ArtifactResolver
} from "agents/experimental/context";

export type ChatMode = "default" | "memory" | "artifact";

export type EventRow = {
  seq: number;
  action: string;
  content: string;
};

export type ChatResult = {
  sessionId: string;
  reply: string;
  traces: ContextTrace[];
  handoffPreview: string[];
  totalMessages: number;
};

export type SessionSummary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
};

type UserFacts = {
  location?: string;
  workplace?: string;
  likes: string[];
};

function normalizeValue(value: string): string {
  return value
    .trim()
    .replace(/^\s+|\s+$/g, "")
    .replace(/[.?!,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function splitClauses(text: string): string[] {
  return text
    .split(/[,.!?;|\n]/g)
    .flatMap((sentence) => sentence.split(/\band\b/gi))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseUserFacts(messages: ContextMessage[]): UserFacts {
  const facts: UserFacts = { likes: [] };

  for (const message of messages) {
    for (const rawClause of splitClauses(message.content)) {
      const clause = rawClause.replace(/^echo:\s*/i, "").trim();

      const factStart = clause.search(/\bi\s+(live\s+in|work\s+at|like)\b/i);
      const candidate = factStart >= 0 ? clause.slice(factStart) : clause;

      const liveMatch = candidate.match(/^i\s+live\s+in\s+(.+)$/i);
      if (liveMatch) {
        const location = normalizeValue(liveMatch[1]);
        if (location) facts.location = location;
      }

      const workMatch = candidate.match(/^i\s+work\s+at\s+(.+)$/i);
      if (workMatch) {
        const workplace = normalizeValue(workMatch[1]);
        if (workplace) facts.workplace = workplace;
      }

      const likeMatch = candidate.match(/^i\s+like\s+(.+)$/i);
      if (likeMatch) {
        const rawLikes = likeMatch[1]
          .split(/,|\||\band\b/gi)
          .map((item) => normalizeValue(item))
          .filter((item) => item.length > 0);

        for (const item of rawLikes) {
          if (
            !facts.likes.some(
              (existing) => existing.toLowerCase() === item.toLowerCase()
            )
          ) {
            facts.likes.push(item);
          }
        }
      }
    }
  }

  return facts;
}

function extractMemorySnippets(messages: ContextMessage[]): string[] {
  return messages
    .filter((message) => message.content.startsWith("[Memory:"))
    .map((message) => {
      const split = message.content.indexOf("] ");
      if (split === -1) return message.content;
      return message.content.slice(split + 2);
    });
}

function extractLikedItemsFromMemory(memorySnippets: string[]): string[] {
  const likes: string[] = [];

  for (const snippet of memorySnippets) {
    const match = snippet.match(/user likes\s+(.+)$/i);
    if (!match) continue;

    const items = match[1]
      .split(/,|\||\band\b/gi)
      .map((item) => normalizeValue(item))
      .filter((item) => item.length > 0);

    for (const item of items) {
      if (
        !likes.some((existing) => existing.toLowerCase() === item.toLowerCase())
      ) {
        likes.push(item);
      }
    }
  }

  return likes;
}

function isLikelyCarBrand(value: string): boolean {
  const brand = value.toLowerCase();
  return [
    "audi",
    "bmw",
    "mercedes",
    "mercedes-benz",
    "tesla",
    "toyota",
    "honda",
    "ford",
    "volkswagen",
    "vw",
    "porsche",
    "nissan",
    "hyundai",
    "kia",
    "lexus",
    "mazda",
    "skoda",
    "renault",
    "peugeot",
    "fiat",
    "ferrari",
    "lamborghini",
    "jaguar",
    "land rover",
    "chevrolet"
  ].includes(brand);
}

function answerFromMemory(
  latestUserMessage: string | null,
  memorySnippets: string[]
): string | null {
  if (!latestUserMessage || memorySnippets.length === 0) return null;

  const question = latestUserMessage.toLowerCase();

  if (question.includes("where") && question.includes("live")) {
    const locationSnippet = memorySnippets.find((snippet) =>
      /user lives in /i.test(snippet)
    );
    if (locationSnippet) {
      const match = locationSnippet.match(/user lives in\s+(.+)$/i);
      if (match) return `You told me you live in ${normalizeValue(match[1])}.`;
    }
  }

  if (question.includes("where") && question.includes("work")) {
    const workSnippet = memorySnippets.find((snippet) =>
      /user works at /i.test(snippet)
    );
    if (workSnippet) {
      const match = workSnippet.match(/user works at\s+(.+)$/i);
      if (match) return `You told me you work at ${normalizeValue(match[1])}.`;
    }
  }

  if (question.includes("car") && question.includes("like")) {
    const likes = extractLikedItemsFromMemory(memorySnippets);
    const carLikes = likes.filter(isLikelyCarBrand);
    if (carLikes.length > 0) {
      return `You told me you like ${carLikes.join(", ")}.`;
    }
    return "I don't have a car preference in memory yet.";
  }

  if (question.includes("what") && question.includes("like")) {
    const likes = extractLikedItemsFromMemory(memorySnippets);
    if (likes.length > 0) {
      return `You told me you like ${likes.join(", ")}.`;
    }
  }

  return `From memory: ${memorySnippets[0]}`;
}

export class ContextDemoAgent extends ContextSessionAgent<
  Cloudflare.Env,
  Record<string, never>
> {
  initialState: Record<string, never> = {};

  @callable()
  startSession(): { sessionId: string } {
    const sessionId = this.createSession({ startedAt: Date.now() });
    return { sessionId };
  }

  @callable()
  removeSession(sessionId: string): { removed: boolean } {
    const existing = this.getSession(sessionId);
    if (!existing) {
      return { removed: false };
    }

    this.deleteSession(sessionId);
    return { removed: true };
  }

  @callable()
  listSessionSummaries(): SessionSummary[] {
    const sessions = this.listSessions();

    return sessions.map((session) => {
      const rows = this.sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM cf_agents_context_events
        WHERE session_id = ${session.id}
      `;

      return {
        id: session.id,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        eventCount: rows[0]?.count ?? 0
      };
    });
  }

  @callable()
  getSessionEvents(sessionId: string): EventRow[] {
    return this.loadEvents(sessionId, { limit: 200, tail: false }).map(
      (event) => ({
        seq: event.seq,
        action: event.action,
        content:
          "content" in event && typeof event.content === "string"
            ? event.content
            : event.action
      })
    );
  }

  @callable()
  async compact(
    sessionId: string
  ): Promise<{ compacted: boolean; summary?: string }> {
    const result = await this.compactSession(sessionId, {
      keepTailEvents: 8,
      deleteCompactedEvents: true,
      summarizer: {
        summarize: async ({ events }) => {
          const preview = events
            .slice(-6)
            .map((event) => {
              if ("content" in event && typeof event.content === "string") {
                return event.content;
              }
              return event.action;
            })
            .join(" | ");

          return `Compacted ${events.length} events. Recent summary: ${preview}`;
        }
      }
    });

    if (!result) {
      return { compacted: false };
    }

    return { compacted: true, summary: result.content };
  }

  @callable()
  async chat(
    sessionId: string,
    message: string,
    mode: ChatMode
  ): Promise<ChatResult> {
    const safeSessionId =
      sessionId || this.createSession({ startedAt: Date.now() });

    this.appendEvents(safeSessionId, [
      contextMessageToEvent(safeSessionId, {
        role: "user",
        content: message
      })
    ]);

    const memoryRetriever: MemoryRetriever | undefined =
      mode === "memory"
        ? {
            retrieve: async ({ messages }) => {
              const facts = parseUserFacts(messages);
              const snippets: Array<{
                id: string;
                content: string;
                source: string;
                score: number;
              }> = [];

              if (facts.location) {
                snippets.push({
                  id: crypto.randomUUID(),
                  content: `User lives in ${facts.location}`,
                  source: "profile-memory",
                  score: 0.96
                });
              }

              if (facts.workplace) {
                snippets.push({
                  id: crypto.randomUUID(),
                  content: `User works at ${facts.workplace}`,
                  source: "profile-memory",
                  score: 0.95
                });
              }

              if (facts.likes.length > 0) {
                snippets.push({
                  id: crypto.randomUUID(),
                  content: `User likes ${facts.likes.join(", ")}`,
                  source: "profile-memory",
                  score: 0.94
                });
              }

              return snippets;
            }
          }
        : undefined;

    const artifactResolver: ArtifactResolver | undefined =
      mode === "artifact"
        ? {
            resolve: async () => [
              {
                name: "pricing-table.csv",
                version: "v3",
                summary: "Artifact handle loaded on demand (not full payload).",
                ephemeral: true
              }
            ]
          }
        : undefined;

    const context = await this.compileWorkingContext(safeSessionId, {
      load: { limit: 80, tail: true },
      staticSystemInstructions: [
        "You are a concise assistant in a context-engineering demo."
      ],
      systemInstructions: [
        "Focus on the latest user request and mention when memory/artifacts were injected."
      ],
      memoryRetriever,
      artifactResolver
    });

    const reply = this.generateReply(context.messages, mode);
    context.addMessage({ role: "assistant", content: reply });
    this.persistWorkingContext(safeSessionId, context);

    const handoff = createScopedHandoffContext(context, {
      include: "latest-turn",
      fromAgent: "planner",
      toAgent: "specialist",
      recastPriorAssistantAsUserContext: true
    } satisfies HandoffOptions);

    return {
      sessionId: safeSessionId,
      reply,
      traces: context.traces,
      handoffPreview: handoff.messages.slice(0, 3).map((msg) => msg.content),
      totalMessages: context.messages.length
    };
  }

  private generateReply(messages: ContextMessage[], mode: ChatMode): string {
    const latestUser = [...messages]
      .reverse()
      .find((msg) => msg.role === "user")?.content;

    const memoryCount = messages.filter((msg) =>
      msg.content.startsWith("[Memory")
    ).length;
    const artifactCount = messages.filter((msg) =>
      msg.content.startsWith("[Artifact")
    ).length;

    const memorySnippets = extractMemorySnippets(messages);
    const memoryAnswer =
      mode === "memory"
        ? answerFromMemory(latestUser ?? null, memorySnippets)
        : null;

    return [
      memoryAnswer ?? `Echo: ${latestUser ?? "(no user message found)"}`,
      `Mode: ${mode}`,
      `Injected memory snippets: ${memoryCount}`,
      `Injected artifact handles: ${artifactCount}`,
      "Context was compiled from session events, then persisted as a new assistant event."
    ].join("\n");
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
};
