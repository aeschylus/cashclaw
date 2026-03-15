import { sql, initDb } from "./db.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface FeedbackEntry {
  taskId: string;
  taskDescription: string;
  score: number;
  comments: string;
  timestamp: number;
}

export interface KnowledgeEntry {
  id: string;
  topic: "feedback_analysis" | "specialty_research" | "task_simulation";
  specialty: string;
  insight: string;
  source: string;
  timestamp: number;
}

let dbInitialized = false;

async function ensureInit(): Promise<void> {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

// --- Chat ---

export async function loadChat(): Promise<ChatMessage[]> {
  await ensureInit();
  const rows = await sql`
    SELECT role, content, timestamp
    FROM cashclaw_chat
    ORDER BY timestamp ASC
    LIMIT 100
  `;
  return rows.map((r) => ({ role: r.role, content: r.content, timestamp: Number(r.timestamp) }));
}

export async function appendChat(message: ChatMessage): Promise<void> {
  await ensureInit();
  await sql`
    INSERT INTO cashclaw_chat (role, content, timestamp)
    VALUES (${message.role}, ${message.content}, ${message.timestamp})
  `;
  // Trim to last 100
  await sql`
    DELETE FROM cashclaw_chat
    WHERE id NOT IN (
      SELECT id FROM cashclaw_chat ORDER BY timestamp DESC LIMIT 100
    )
  `;
}

export async function clearChat(): Promise<void> {
  await ensureInit();
  await sql`DELETE FROM cashclaw_chat`;
}

// --- Feedback ---

export async function loadFeedback(): Promise<FeedbackEntry[]> {
  await ensureInit();
  const rows = await sql`
    SELECT task_id, task_description, score, comments, timestamp
    FROM cashclaw_feedback
    ORDER BY timestamp ASC
    LIMIT 100
  `;
  return rows.map((r) => ({
    taskId: r.task_id,
    taskDescription: r.task_description,
    score: Number(r.score),
    comments: r.comments,
    timestamp: Number(r.timestamp),
  }));
}

export async function storeFeedback(entry: FeedbackEntry): Promise<void> {
  await ensureInit();
  await sql`
    INSERT INTO cashclaw_feedback (task_id, task_description, score, comments, timestamp)
    VALUES (${entry.taskId}, ${entry.taskDescription}, ${entry.score}, ${entry.comments}, ${entry.timestamp})
    ON CONFLICT (task_id) DO UPDATE
      SET score = EXCLUDED.score,
          comments = EXCLUDED.comments,
          timestamp = EXCLUDED.timestamp
  `;
}

export function getFeedbackStats(entries: FeedbackEntry[]): {
  totalTasks: number;
  avgScore: number;
  completionRate: number;
} {
  if (entries.length === 0) {
    return { totalTasks: 0, avgScore: 0, completionRate: 0 };
  }
  const scored = entries.filter((e) => e.score > 0);
  const avgScore =
    scored.length > 0
      ? scored.reduce((sum, e) => sum + e.score, 0) / scored.length
      : 0;
  return {
    totalTasks: entries.length,
    avgScore: Math.round(avgScore * 10) / 10,
    completionRate: Math.round((scored.length / entries.length) * 100),
  };
}

// --- Knowledge ---

export async function loadKnowledge(): Promise<KnowledgeEntry[]> {
  await ensureInit();
  const rows = await sql`
    SELECT id, topic, specialty, insight, source, timestamp
    FROM cashclaw_knowledge
    ORDER BY timestamp ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    specialty: r.specialty,
    insight: r.insight,
    source: r.source,
    timestamp: Number(r.timestamp),
  }));
}

export async function storeKnowledge(entry: KnowledgeEntry): Promise<void> {
  await ensureInit();
  await sql`
    INSERT INTO cashclaw_knowledge (id, topic, specialty, insight, source, timestamp)
    VALUES (${entry.id}, ${entry.topic}, ${entry.specialty}, ${entry.insight}, ${entry.source}, ${entry.timestamp})
    ON CONFLICT (id) DO UPDATE
      SET insight = EXCLUDED.insight, timestamp = EXCLUDED.timestamp
  `;
  // Trim to last 50
  await sql`
    DELETE FROM cashclaw_knowledge
    WHERE id NOT IN (
      SELECT id FROM cashclaw_knowledge ORDER BY timestamp DESC LIMIT 50
    )
  `;
}

export async function deleteKnowledge(id: string): Promise<boolean> {
  await ensureInit();
  const result = await sql`
    DELETE FROM cashclaw_knowledge WHERE id = ${id}
    RETURNING id
  `;
  return result.length > 0;
}

export function getRelevantKnowledge(
  entries: KnowledgeEntry[],
  specialties: string[],
  limit = 5,
): KnowledgeEntry[] {
  const lowerSpecs = new Set(specialties.map((s) => s.toLowerCase()));
  const matching = entries.filter(
    (e) => lowerSpecs.has(e.specialty.toLowerCase()) || e.specialty === "general",
  );
  return matching.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

// --- Logs ---

export async function appendLog(entry: string): Promise<void> {
  await ensureInit();
  const logDate = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO cashclaw_logs (log_date, entry)
    VALUES (${logDate}, ${entry})
  `;
  // Keep last 1000 log entries
  await sql`
    DELETE FROM cashclaw_logs
    WHERE id NOT IN (
      SELECT id FROM cashclaw_logs ORDER BY id DESC LIMIT 1000
    )
  `;
}

export async function readTodayLog(): Promise<string> {
  await ensureInit();
  const logDate = new Date().toISOString().split("T")[0];
  const rows = await sql`
    SELECT entry, created_at
    FROM cashclaw_logs
    WHERE log_date = ${logDate}
    ORDER BY id ASC
  `;
  if (rows.length === 0) return "No activity today.";
  const header = `# CashClaw Activity — ${logDate}\n\n`;
  const lines = rows
    .map((r) => {
      const time = new Date(r.created_at).toISOString().split("T")[1].split(".")[0];
      return `- \`${time}\` ${r.entry}`;
    })
    .join("\n");
  return header + lines;
}

// --- Agent State ---

export interface AgentState {
  running: boolean;
  startedAt: number;
  lastPoll: number;
  totalPolls: number;
  totalStudySessions: number;
}

export async function loadAgentState(): Promise<AgentState> {
  await ensureInit();
  const rows = await sql`
    SELECT running, started_at, last_poll, total_polls, total_study_sessions
    FROM cashclaw_agent_state
    WHERE id = 'default'
  `;
  if (rows.length === 0) {
    return { running: false, startedAt: 0, lastPoll: 0, totalPolls: 0, totalStudySessions: 0 };
  }
  const r = rows[0];
  return {
    running: r.running,
    startedAt: Number(r.started_at),
    lastPoll: Number(r.last_poll),
    totalPolls: Number(r.total_polls),
    totalStudySessions: Number(r.total_study_sessions),
  };
}

export async function saveAgentState(state: Partial<AgentState>): Promise<void> {
  await ensureInit();
  const current = await loadAgentState();
  const merged = { ...current, ...state };
  await sql`
    INSERT INTO cashclaw_agent_state (id, running, started_at, last_poll, total_polls, total_study_sessions, updated_at)
    VALUES ('default', ${merged.running}, ${merged.startedAt}, ${merged.lastPoll}, ${merged.totalPolls}, ${merged.totalStudySessions}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      running = EXCLUDED.running,
      started_at = EXCLUDED.started_at,
      last_poll = EXCLUDED.last_poll,
      total_polls = EXCLUDED.total_polls,
      total_study_sessions = EXCLUDED.total_study_sessions,
      updated_at = NOW()
  `;
}
