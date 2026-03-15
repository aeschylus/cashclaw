import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const sql = neon(DATABASE_URL);

export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_chat (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_feedback (
      task_id TEXT PRIMARY KEY,
      task_description TEXT NOT NULL,
      score NUMERIC NOT NULL,
      comments TEXT NOT NULL DEFAULT '',
      timestamp BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_knowledge (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      specialty TEXT NOT NULL,
      insight TEXT NOT NULL,
      source TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_logs (
      id SERIAL PRIMARY KEY,
      log_date TEXT NOT NULL,
      entry TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cashclaw_agent_state (
      id TEXT PRIMARY KEY DEFAULT 'default',
      running BOOLEAN NOT NULL DEFAULT false,
      started_at BIGINT DEFAULT 0,
      last_poll BIGINT DEFAULT 0,
      total_polls INTEGER DEFAULT 0,
      total_study_sessions INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
