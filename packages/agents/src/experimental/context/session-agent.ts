import { Agent, type AgentContext } from "../../index";
import { createDefaultProcessors, runContextProcessors } from "./processors";
import { buildWorkingContext, WorkingContext } from "./working-context";
import {
  contextMessageToEvent,
  dehydrateContextEvent,
  hydrateContextEvent
} from "./utils";
import type {
  CompactSessionOptions,
  CompileContextOptions,
  ContextMemoryEntry,
  ContextSessionEvent,
  LoadContextEventsOptions,
  LoadContextMemoryOptions,
  StoredContextEvent,
  StoredContextMemoryEntry,
  StoredContextSession,
  UpsertContextMemoryInput
} from "./types";

const DEFAULT_LOAD_LIMIT = 50;

/** @experimental */
export class ContextSessionAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>
> extends Agent<Env, State, Props> {
  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);

    this.sql`
      CREATE TABLE IF NOT EXISTS cf_agents_context_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS cf_agents_context_events (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        action TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE INDEX IF NOT EXISTS idx_context_events_session_seq
      ON cf_agents_context_events(session_id, seq)
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS cf_agents_context_memory (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        memory_key TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        source TEXT,
        score REAL,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_context_memory_session_key_value
      ON cf_agents_context_memory(session_id, memory_key, memory_value)
    `;

    this.sql`
      CREATE INDEX IF NOT EXISTS idx_context_memory_session_key_updated
      ON cf_agents_context_memory(session_id, memory_key, updated_at DESC)
    `;
  }

  createSession(metadata?: Record<string, unknown>): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql`
      INSERT INTO cf_agents_context_sessions (id, agent_id, created_at, updated_at, metadata)
      VALUES (${id}, ${this.name}, ${now}, ${now}, ${
        metadata ? JSON.stringify(metadata) : null
      })
    `;
    return id;
  }

  getSession(sessionId: string): StoredContextSession | null {
    const rows = this.sql<StoredContextSession>`
      SELECT id, agent_id, created_at, updated_at, metadata
      FROM cf_agents_context_sessions
      WHERE id = ${sessionId}
    `;
    return rows[0] ?? null;
  }

  listSessions(): StoredContextSession[] {
    return this.sql<StoredContextSession>`
      SELECT id, agent_id, created_at, updated_at, metadata
      FROM cf_agents_context_sessions
      WHERE agent_id = ${this.name}
      ORDER BY updated_at DESC
    `;
  }

  deleteSession(sessionId: string): void {
    this.ctx.storage.transactionSync(() => {
      this
        .sql`DELETE FROM cf_agents_context_events WHERE session_id = ${sessionId}`;
      this
        .sql`DELETE FROM cf_agents_context_memory WHERE session_id = ${sessionId}`;
      this.sql`DELETE FROM cf_agents_context_sessions WHERE id = ${sessionId}`;
    });
  }

  loadEvents(
    sessionId: string,
    options: LoadContextEventsOptions = {}
  ): ContextSessionEvent[] {
    const limit = options.limit ?? DEFAULT_LOAD_LIMIT;
    const since = options.since ?? null;
    const actions = options.actions ?? null;
    const tail = options.tail ?? true;

    const conditions = ["session_id = ?"];
    const params: unknown[] = [sessionId];

    if (since !== null) {
      conditions.push("created_at >= ?");
      params.push(since);
    }

    if (actions && actions.length > 0) {
      conditions.push(`action IN (${actions.map(() => "?").join(",")})`);
      params.push(...actions);
    }

    const where = conditions.join(" AND ");
    const inner = `SELECT id, session_id, seq, action, content, metadata, created_at FROM cf_agents_context_events WHERE ${where} ORDER BY seq ${
      tail ? "DESC" : "ASC"
    } LIMIT ?`;
    params.push(limit);

    const query = tail
      ? `SELECT * FROM (${inner}) sub ORDER BY seq ASC`
      : inner;

    const rows = [
      ...this.ctx.storage.sql.exec(query, ...params)
    ] as unknown as StoredContextEvent[];

    return rows.map(hydrateContextEvent);
  }

  appendEvents(sessionId: string, events: ContextSessionEvent[]): void {
    if (events.length === 0) return;
    if (!this.getSession(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.ctx.storage.transactionSync(() => {
      const maxSeqRows = this.sql<{ max_seq: number | null }>`
        SELECT MAX(seq) as max_seq
        FROM cf_agents_context_events
        WHERE session_id = ${sessionId}
      `;
      let nextSeq = (maxSeqRows[0]?.max_seq ?? -1) + 1;

      for (const event of events) {
        const row = dehydrateContextEvent({
          ...event,
          seq: nextSeq,
          sessionId
        });

        this.sql`
          INSERT INTO cf_agents_context_events (id, session_id, seq, action, content, metadata, created_at)
          VALUES (${row.id}, ${row.session_id}, ${row.seq}, ${row.action}, ${row.content}, ${row.metadata}, ${row.created_at})
        `;

        nextSeq++;
      }

      this.sql`
        UPDATE cf_agents_context_sessions
        SET updated_at = ${Date.now()}
        WHERE id = ${sessionId}
      `;
    });
  }

  deleteEvents(sessionId: string, eventIds: string[]): void {
    if (eventIds.length === 0) return;

    this.ctx.storage.transactionSync(() => {
      for (const eventId of eventIds) {
        this.sql`
          DELETE FROM cf_agents_context_events
          WHERE id = ${eventId} AND session_id = ${sessionId}
        `;
      }
    });
  }

  upsertMemory(
    sessionId: string,
    entries: UpsertContextMemoryInput[],
    options: { replaceByKey?: boolean } = {}
  ): void {
    if (entries.length === 0) return;
    if (!this.getSession(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const now = Date.now();

    this.ctx.storage.transactionSync(() => {
      for (const entry of entries) {
        const key = entry.key.trim();
        const value = entry.value.trim();
        if (key.length === 0 || value.length === 0) continue;

        if (options.replaceByKey === true) {
          this.sql`
            DELETE FROM cf_agents_context_memory
            WHERE session_id = ${sessionId} AND memory_key = ${key}
          `;
        }

        this.sql`
          INSERT OR REPLACE INTO cf_agents_context_memory
            (id, session_id, memory_key, memory_value, source, score, metadata, updated_at)
          VALUES
            (${crypto.randomUUID()}, ${sessionId}, ${key}, ${value}, ${
              entry.source ?? null
            }, ${entry.score ?? null}, ${
              entry.metadata ? JSON.stringify(entry.metadata) : null
            }, ${now})
        `;
      }

      this.sql`
        UPDATE cf_agents_context_sessions
        SET updated_at = ${now}
        WHERE id = ${sessionId}
      `;
    });
  }

  loadMemory(
    sessionId: string,
    options: LoadContextMemoryOptions = {}
  ): ContextMemoryEntry[] {
    const limit = options.limit ?? 200;
    const keys = options.keys ?? [];

    const rows =
      keys.length === 0
        ? this.sql<StoredContextMemoryEntry>`
            SELECT id, session_id, memory_key, memory_value, source, score, metadata, updated_at
            FROM cf_agents_context_memory
            WHERE session_id = ${sessionId}
            ORDER BY updated_at DESC
            LIMIT ${limit}
          `
        : this.ctx.storage.sql.exec(
            `
            SELECT id, session_id, memory_key, memory_value, source, score, metadata, updated_at
            FROM cf_agents_context_memory
            WHERE session_id = ? AND memory_key IN (${keys.map(() => "?").join(",")})
            ORDER BY updated_at DESC
            LIMIT ?
          `,
            sessionId,
            ...keys,
            limit
          );

    return [...rows].map((row) => {
      const typed = row as StoredContextMemoryEntry;
      let metadata: Record<string, unknown> | undefined;
      if (typed.metadata) {
        try {
          const parsed = JSON.parse(typed.metadata) as unknown;
          if (parsed && typeof parsed === "object") {
            metadata = parsed as Record<string, unknown>;
          }
        } catch {
          // ignore malformed metadata
        }
      }

      return {
        id: typed.id,
        sessionId: typed.session_id,
        key: typed.memory_key,
        value: typed.memory_value,
        source: typed.source ?? undefined,
        score: typed.score ?? undefined,
        metadata,
        updatedAt: typed.updated_at
      } satisfies ContextMemoryEntry;
    });
  }

  deleteMemory(sessionId: string, keys?: string[]): void {
    if (!keys || keys.length === 0) {
      this.sql`
        DELETE FROM cf_agents_context_memory
        WHERE session_id = ${sessionId}
      `;
      return;
    }

    this.ctx.storage.transactionSync(() => {
      for (const key of keys) {
        this.sql`
          DELETE FROM cf_agents_context_memory
          WHERE session_id = ${sessionId} AND memory_key = ${key}
        `;
      }
    });
  }

  async compactSession(
    sessionId: string,
    options: CompactSessionOptions
  ): Promise<ContextSessionEvent | null> {
    const keepTailEvents = options.keepTailEvents ?? 20;
    const events = this.loadEvents(sessionId, {
      limit: 10_000,
      tail: false
    });

    if (events.length <= keepTailEvents) {
      return null;
    }

    const compactable = events.slice(
      0,
      Math.max(0, events.length - keepTailEvents)
    );
    const summary = await options.summarizer.summarize({
      sessionId,
      events: compactable
    });
    const resolvedSummary =
      typeof summary === "string" ? { content: summary } : summary;

    const summaryEvent: ContextSessionEvent = {
      id: crypto.randomUUID(),
      sessionId,
      seq: -1,
      timestamp: Date.now(),
      action: "compaction",
      content: resolvedSummary.content,
      replacesSeqRange: [
        compactable[0]?.seq ?? 0,
        compactable.at(-1)?.seq ?? 0
      ],
      metadata: resolvedSummary.metadata
    };

    this.appendEvents(sessionId, [summaryEvent]);

    if (options.deleteCompactedEvents === true) {
      this.deleteEvents(
        sessionId,
        compactable.map((event) => event.id)
      );
    }

    return summaryEvent;
  }

  persistWorkingContext(sessionId: string, context: WorkingContext): void {
    const newMessages = context.getNewMessages();
    if (newMessages.length === 0) return;

    const events = newMessages.map((msg) =>
      contextMessageToEvent(sessionId, msg)
    );
    this.appendEvents(sessionId, events);
  }

  buildWorkingContext(
    sessionId: string,
    options: CompileContextOptions = {}
  ): WorkingContext {
    const events = this.loadEvents(sessionId, options.load);
    return buildWorkingContext(events, options);
  }

  async compileWorkingContext(
    sessionId: string,
    options: CompileContextOptions = {}
  ): Promise<WorkingContext> {
    const events = this.loadEvents(sessionId, options.load);
    const base = buildWorkingContext(events, options);

    const initialState = {
      sessionId,
      events,
      messages: [...base.messages],
      systemInstructions: [...base.systemInstructions],
      staticSystemInstructions: [...base.staticSystemInstructions],
      traces: [],
      metadata: {}
    };

    const processors = options.processors ?? createDefaultProcessors(options);
    const finalState = await runContextProcessors(initialState, processors);

    return new WorkingContext({
      messages: finalState.messages,
      systemInstructions: finalState.systemInstructions,
      staticSystemInstructions: finalState.staticSystemInstructions,
      traces: finalState.traces
    });
  }

  async destroy() {
    this.sql`DROP TABLE IF EXISTS cf_agents_context_events`;
    this.sql`DROP TABLE IF EXISTS cf_agents_context_memory`;
    this.sql`DROP TABLE IF EXISTS cf_agents_context_sessions`;
    await super.destroy();
  }
}
