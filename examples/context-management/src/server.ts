import { callable, routeAgentRequest } from "agents";
import {
  ContextEventAction,
  ContextSessionAgent,
  contextEventToMessage,
  contextMessageToEvent,
  createScopedHandoffContext,
  type ContextMessage,
  type ContextTrace,
  type HandoffOptions,
  type MemoryRetriever
} from "agents/experimental/context";

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
  memorySnippetCount: number;
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

type AIBinding = {
  run: (
    model: string,
    input: {
      messages?: Array<{ role: "system" | "user"; content: string }>;
      text?: string;
      max_tokens?: number;
      temperature?: number;
      response_format?: {
        type: "json_schema";
        json_schema: {
          name: string;
          schema: Record<string, unknown>;
          strict?: boolean;
        };
      };
    }
  ) => Promise<unknown>;
};

function normalizeValue(value: string): string {
  return value
    .trim()
    .replace(/[.?!,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function buildUserCorpus(messages: ContextMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message, index) => `Turn ${index + 1}: ${message.content}`)
    .join("\n");
}

function mergeFacts(primary: UserFacts, fallback: UserFacts): UserFacts {
  const likes = [...primary.likes];
  for (const like of fallback.likes) {
    if (
      !likes.some((existing) => existing.toLowerCase() === like.toLowerCase())
    ) {
      likes.push(like);
    }
  }

  return {
    location: primary.location ?? fallback.location,
    workplace: primary.workplace ?? fallback.workplace,
    likes
  };
}

function parseFactsMetadata(value: unknown): UserFacts | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const likesRaw = Array.isArray(candidate.likes) ? candidate.likes : [];
  const likes = likesRaw
    .filter((item): item is string => typeof item === "string")
    .map((item) =>
      normalizeValue(item)
        .replace(/^to\s+/i, "")
        .replace(/^play(?:ing)?\s+/i, "")
    )
    .filter((item) => item.length > 0);

  return {
    location:
      typeof candidate.location === "string"
        ? normalizeValue(candidate.location)
        : undefined,
    workplace:
      typeof candidate.workplace === "string"
        ? normalizeValue(candidate.workplace)
        : undefined,
    likes
  };
}

function formatFactsFallback(facts: UserFacts): string {
  const lines: string[] = [];
  if (facts.location) lines.push(`You live in ${facts.location}.`);
  if (facts.workplace) lines.push(`You work at ${facts.workplace}.`);
  if (facts.likes.length > 0) lines.push(`You like ${facts.likes.join(", ")}.`);

  if (lines.length === 0) {
    return "I don't know enough about you yet from memory.";
  }

  return `From memory: ${lines.join(" ")}`;
}

function normalizeFacts(facts: UserFacts): UserFacts {
  const location = facts.location?.trim();
  const workplace = facts.workplace?.trim();

  const samePlace =
    location && workplace && location.toLowerCase() === workplace.toLowerCase();

  return {
    location,
    workplace: samePlace ? undefined : workplace,
    likes: facts.likes
  };
}

function extractJsonString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const seen = new Set<unknown>();
  const stack: unknown[] = [value];
  const stringCandidates: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string") {
      stringCandidates.push(current);
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const prioritized = ["response", "output_text", "result", "text"];
      for (const key of prioritized) {
        const item = record[key];
        if (typeof item === "string") {
          stringCandidates.push(item);
        }
      }

      for (const item of Object.values(record)) {
        stack.push(item);
      }
    }
  }

  const jsonLike = stringCandidates.find(
    (text) => text.includes("{") && text.includes("}")
  );
  return jsonLike ?? stringCandidates[0] ?? null;
}

function extractFirstJsonObjectText(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseFactsFromText(text: string): UserFacts | null {
  try {
    return parseFactsMetadata(JSON.parse(text) as unknown);
  } catch {
    const jsonCandidate = extractFirstJsonObjectText(text);
    if (!jsonCandidate) return null;

    try {
      return parseFactsMetadata(JSON.parse(jsonCandidate) as unknown);
    } catch {
      return null;
    }
  }
}

function hasAnyFacts(facts: UserFacts): boolean {
  return Boolean(facts.location || facts.workplace || facts.likes.length > 0);
}

function extractFactsHeuristically(utterance: string): UserFacts {
  const likes: string[] = [];
  let location: string | undefined;
  let workplace: string | undefined;

  const workAt = utterance.match(
    /\bwork\s+at\s+([^.,;!\n]+?)(?:\s+in\s+([^.,;!\n]+?))?(?:\s+and\b|$)/i
  );
  if (workAt) {
    const org = normalizeValue(workAt[1] ?? "");
    if (org) workplace = org;

    const cityFromWork = normalizeValue(workAt[2] ?? "");
    if (cityFromWork) location = cityFromWork;
  }

  const liveIn = utterance.match(/\b(?:live|based)\s+in\s+([^.,;!\n]+)/i);
  if (liveIn) {
    const place = normalizeValue(liveIn[1] ?? "");
    if (place) location = place;
  }

  const likesChunk = utterance.match(/\b(?:enjoy|like|love)\s+([^.!?\n]+)/i);
  if (likesChunk) {
    for (const raw of likesChunk[1].split(/,|\band\b/i)) {
      const normalized = normalizeValue(raw)
        .replace(/^the\s+color\s+/i, "")
        .replace(/^the\s+colour\s+/i, "");
      if (normalized) likes.push(normalized);
    }
  }

  const color = utterance.match(/\bcolou?r\s+([a-z]+)\b/i);
  if (color) {
    const value = normalizeValue(color[1] ?? "");
    if (value) likes.push(value);
  }

  const dedupedLikes = likes.filter(
    (like, index, arr) =>
      arr.findIndex((item) => item.toLowerCase() === like.toLowerCase()) ===
      index
  );

  return { location, workplace, likes: dedupedLikes };
}

function answerQuestionFromFactsFast(
  question: string,
  facts: UserFacts
): string {
  const normalized = normalizeFacts(facts);
  const q = question.toLowerCase();

  if (q.includes("where") && q.includes("work")) {
    return normalized.workplace
      ? `From memory: You work at ${normalized.workplace}.`
      : "I don't know where you work from memory yet.";
  }

  if (q.includes("where") && q.includes("live")) {
    return normalized.location
      ? `From memory: You live in ${normalized.location}.`
      : "I don't know where you live from memory yet.";
  }

  if (
    q.includes("work") ||
    q.includes("job") ||
    q.includes("career") ||
    q.includes("profession") ||
    q.includes("do for life")
  ) {
    return normalized.workplace
      ? `From memory: You work at ${normalized.workplace}.`
      : "I don't know your work details from memory yet.";
  }

  if (q.includes("what do you know") || q.includes("about me")) {
    return formatFactsFallback(normalized);
  }

  if (
    q.includes("like") ||
    q.includes("prefer") ||
    q.includes("favorite") ||
    q.includes("favourite") ||
    q.includes("colour") ||
    q.includes("color")
  ) {
    return normalized.likes.length > 0
      ? `From memory: You like ${normalized.likes.join(", ")}.`
      : "I don't know your preferences from memory yet.";
  }

  return formatFactsFallback(normalized);
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

          const compactedMessages = events
            .map((event) => contextEventToMessage(event))
            .filter((message): message is ContextMessage => message !== null);
          const compactedFacts = await this.extractFactsWithLLM(
            buildUserCorpus(compactedMessages)
          );

          return {
            content: `Compacted ${events.length} events. Recent summary: ${preview}`,
            metadata: {
              compactedEventCount: events.length,
              facts: compactedFacts
            }
          };
        }
      }
    });

    if (!result) {
      return { compacted: false };
    }

    return { compacted: true, summary: result.content };
  }

  private getLatestCompactionFacts(sessionId: string): UserFacts {
    const compactionEvents = this.loadEvents(sessionId, {
      limit: 200,
      tail: true,
      actions: [ContextEventAction.COMPACTION]
    });

    const latestCompaction = [...compactionEvents]
      .reverse()
      .find((event) => event.action === "compaction");

    if (!latestCompaction || latestCompaction.action !== "compaction") {
      return { likes: [] };
    }

    const rawFacts = latestCompaction.metadata?.facts;
    const parsed = parseFactsMetadata(rawFacts);
    return parsed ?? { likes: [] };
  }

  private persistFacts(sessionId: string, facts: UserFacts): void {
    const singletonEntries: Array<{
      key: string;
      value: string;
      source: string;
      score: number;
    }> = [];

    if (facts.location) {
      singletonEntries.push({
        key: "location",
        value: facts.location,
        source: "profile-extractor",
        score: 0.96
      });
    }

    if (facts.workplace) {
      singletonEntries.push({
        key: "workplace",
        value: facts.workplace,
        source: "profile-extractor",
        score: 0.95
      });
    }

    if (singletonEntries.length > 0) {
      this.upsertMemory(sessionId, singletonEntries, { replaceByKey: true });
    }

    const likeEntries = facts.likes.map((like) => ({
      key: "like",
      value: like,
      source: "profile-extractor",
      score: 0.9
    }));

    if (likeEntries.length > 0) {
      this.upsertMemory(sessionId, likeEntries, { replaceByKey: false });
    }
  }

  private loadPersistedFacts(sessionId: string): UserFacts {
    const entries = this.loadMemory(sessionId, { limit: 300 });

    const likes: string[] = [];
    let location: string | undefined;
    let workplace: string | undefined;

    for (const entry of entries) {
      const value = normalizeValue(entry.value);
      if (entry.key === "location" && !location) {
        location = value;
      } else if (entry.key === "workplace" && !workplace) {
        workplace = value;
      } else if (entry.key === "like") {
        if (!likes.some((item) => item.toLowerCase() === value.toLowerCase())) {
          likes.push(value);
        }
      }
    }

    return { location, workplace, likes };
  }

  private async extractFactsWithLLM(utterance: string): Promise<UserFacts> {
    const heuristicFacts = extractFactsHeuristically(utterance);
    if (hasAnyFacts(heuristicFacts)) {
      return heuristicFacts;
    }

    const ai = (this.env as Cloudflare.Env & { AI?: AIBinding }).AI;
    if (!ai) {
      return { likes: [] };
    }

    const baseMessages: Array<{ role: "system" | "user"; content: string }> = [
      {
        role: "system",
        content:
          "Extract user profile facts from the provided conversation turns. Return ONLY JSON with keys location, workplace, likes (array of strings). Workplace must be employer/company/org name (for example Cloudflare), not city or country. Use the most recent value when facts conflict. Use null for unknown location/workplace and [] for no likes."
      },
      {
        role: "user",
        content: utterance
      }
    ];

    try {
      const response = await ai.run("@cf/zai-org/glm-4.7-flash", {
        messages: baseMessages,
        max_tokens: 220,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "user_facts",
            strict: true,
            schema: {
              type: "object",
              properties: {
                location: {
                  anyOf: [{ type: "string" }, { type: "null" }]
                },
                workplace: {
                  anyOf: [{ type: "string" }, { type: "null" }]
                },
                likes: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["location", "workplace", "likes"],
              additionalProperties: false
            }
          }
        }
      });

      const jsonText = extractJsonString(response);
      if (!jsonText) return { likes: [] };

      const parsed = parseFactsFromText(jsonText);
      return parsed ?? { likes: [] };
    } catch {
      return { likes: [] };
    }
  }

  private answerQuestionFromFacts(question: string, facts: UserFacts): string {
    return answerQuestionFromFactsFast(question, facts);
  }

  @callable()
  async chat(sessionId: string, message: string): Promise<ChatResult> {
    const safeSessionId =
      sessionId || this.createSession({ startedAt: Date.now() });

    this.appendEvents(safeSessionId, [
      contextMessageToEvent(safeSessionId, {
        role: "user",
        content: message
      })
    ]);

    const extractedFromTurn = await this.extractFactsWithLLM(message);
    this.persistFacts(safeSessionId, extractedFromTurn);

    let retrievedFacts: UserFacts | null = null;
    let memorySnippetCount = 0;

    const memoryRetriever: MemoryRetriever = {
      retrieve: async ({ sessionId: activeSessionId }) => {
        const persistedFacts = this.loadPersistedFacts(activeSessionId);
        const compactedFacts = this.getLatestCompactionFacts(activeSessionId);
        const facts = mergeFacts(persistedFacts, compactedFacts);
        retrievedFacts = facts;

        const snippets: Array<{
          id: string;
          content: string;
          source: string;
          score?: number;
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

        memorySnippetCount = snippets.length;
        return snippets;
      }
    };

    const context = await this.compileWorkingContext(safeSessionId, {
      load: { limit: 40, tail: true },
      staticSystemInstructions: [
        "You are a concise assistant in a context-engineering demo."
      ],
      systemInstructions: [
        "Focus on the latest user request and mention when memory was injected."
      ],
      memoryRetriever
    });

    const memoryFacts =
      retrievedFacts ??
      mergeFacts(
        this.loadPersistedFacts(safeSessionId),
        this.getLatestCompactionFacts(safeSessionId)
      );

    const reply = this.generateReply(context.messages, memoryFacts);
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
      totalMessages: context.messages.length,
      memorySnippetCount
    };
  }

  private generateReply(
    messages: ContextMessage[],
    memoryFacts: UserFacts
  ): string {
    const latestUser = [...messages]
      .reverse()
      .find((msg) => msg.role === "user")?.content;

    if (!latestUser) {
      return "I couldn't find your latest message in context.";
    }

    return this.answerQuestionFromFacts(latestUser, memoryFacts);
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
