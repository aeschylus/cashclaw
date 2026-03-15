import { sql, initDb } from "./db.js";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "openrouter";
  model: string;
  apiKey: string;
}

export interface PricingConfig {
  strategy: "fixed" | "complexity";
  baseRateEth: string;
  maxRateEth: string;
}

export interface PollingConfig {
  intervalMs: number;
  urgentIntervalMs: number;
}

export interface PersonalityConfig {
  tone: "professional" | "casual" | "friendly" | "technical";
  responseStyle: "concise" | "detailed" | "balanced";
  customInstructions?: string;
}

export interface CashClawConfig {
  agentId: string;
  llm: LLMConfig;
  polling: PollingConfig;
  pricing: PricingConfig;
  specialties: string[];
  autoQuote: boolean;
  autoWork: boolean;
  maxConcurrentTasks: number;
  maxLoopTurns?: number;
  declineKeywords: string[];
  personality?: PersonalityConfig;
  learningEnabled: boolean;
  studyIntervalMs: number;
  agentCashEnabled: boolean;
}

const DEFAULT_CONFIG: Omit<CashClawConfig, "agentId" | "llm"> = {
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
  specialties: [],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 3,
  declineKeywords: [],
  learningEnabled: true,
  studyIntervalMs: 1_800_000,
  agentCashEnabled: false,
};

let dbInitialized = false;

async function ensureInit(): Promise<void> {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

export async function loadConfig(): Promise<CashClawConfig | null> {
  await ensureInit();
  const rows = await sql`SELECT data FROM cashclaw_config WHERE id = 'default'`;
  if (rows.length === 0) return null;
  return rows[0].data as CashClawConfig;
}

export async function saveConfig(config: CashClawConfig): Promise<void> {
  await ensureInit();
  await sql`
    INSERT INTO cashclaw_config (id, data, updated_at)
    VALUES ('default', ${JSON.stringify(config)}, NOW())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function savePartialConfig(partial: Partial<CashClawConfig>): Promise<CashClawConfig> {
  const existing = await loadConfig();
  const config: CashClawConfig = {
    ...DEFAULT_CONFIG,
    agentId: "",
    llm: { provider: "anthropic", model: "", apiKey: "" },
    ...existing,
    ...partial,
  };
  await saveConfig(config);
  return config;
}

export async function isConfigured(): Promise<boolean> {
  const config = await loadConfig();
  if (!config) return false;
  return Boolean(config.agentId && config.llm?.apiKey && config.llm?.provider);
}
