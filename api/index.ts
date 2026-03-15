import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  loadConfig,
  savePartialConfig,
  isConfigured,
  type CashClawConfig,
  type LLMConfig,
} from "./lib/config-db.js";
import {
  loadChat,
  appendChat,
  clearChat,
  loadFeedback,
  getFeedbackStats,
  loadKnowledge,
  deleteKnowledge,
  getRelevantKnowledge,
  readTodayLog,
  loadAgentState,
  saveAgentState,
} from "./lib/memory-db.js";

function json(res: VercelResponse, data: unknown, status = 200) {
  return res.status(status).json(data);
}

function cors(res: VercelResponse) {
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const pathname = req.url?.split("?")[0] ?? "/";

  try {
    // Setup endpoints
    if (pathname.startsWith("/api/setup/")) {
      return await handleSetup(pathname, req, res);
    }

    // Running endpoints
    switch (pathname) {
      case "/api/status": {
        const config = await loadConfig();
        const state = await loadAgentState();
        const configured = Boolean(config?.agentId && config?.llm?.apiKey);
        if (!configured) {
          return json(res, { error: "Agent not configured", mode: "setup" }, 503);
        }
        return json(res, {
          running: state.running,
          activeTasks: 0,
          totalPolls: state.totalPolls,
          lastPoll: state.lastPoll,
          startedAt: state.startedAt,
          uptime: state.running ? Date.now() - state.startedAt : 0,
          agentId: config?.agentId,
        });
      }

      case "/api/tasks": {
        return json(res, { tasks: [], events: [] });
      }

      case "/api/logs": {
        const log = await readTodayLog();
        return json(res, { log });
      }

      case "/api/config": {
        const config = await loadConfig();
        if (!config) {
          return json(res, { error: "Not configured" }, 404);
        }
        return json(res, { ...config, llm: { ...config.llm, apiKey: "***" } });
      }

      case "/api/stats": {
        const [feedback, knowledge, state] = await Promise.all([
          loadFeedback(),
          loadKnowledge(),
          loadAgentState(),
        ]);
        const stats = getFeedbackStats(feedback);
        return json(res, {
          ...stats,
          studySessions: state.totalStudySessions,
          knowledgeEntries: knowledge.length,
        });
      }

      case "/api/knowledge": {
        const entries = await loadKnowledge();
        return json(res, { entries });
      }

      case "/api/knowledge/delete": {
        if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
        const body = req.body as { id?: string };
        if (!body.id || typeof body.id !== "string") {
          return json(res, { error: "Missing id" }, 400);
        }
        const deleted = await deleteKnowledge(body.id);
        if (!deleted) return json(res, { error: "Entry not found" }, 404);
        return json(res, { ok: true });
      }

      case "/api/feedback": {
        const entries = await loadFeedback();
        return json(res, { entries });
      }

      case "/api/stop": {
        if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
        await saveAgentState({ running: false });
        return json(res, { ok: true, running: false });
      }

      case "/api/start": {
        if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
        await saveAgentState({ running: true, startedAt: Date.now() });
        return json(res, { ok: true, running: true });
      }

      case "/api/config-update": {
        if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
        return await handleConfigUpdate(req, res);
      }

      case "/api/chat": {
        if (req.method === "GET") {
          const messages = await loadChat();
          return json(res, { messages });
        } else if (req.method === "POST") {
          return await handleChat(req, res);
        }
        return json(res, { error: "GET or POST" }, 405);
      }

      case "/api/chat/clear": {
        if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
        await clearChat();
        return json(res, { ok: true });
      }

      case "/api/wallet": {
        return json(res, { address: "0x0000000000000000000000000000000000000000", balance: "0" });
      }

      case "/api/agent-info": {
        const config = await loadConfig();
        if (!config?.agentId) return json(res, { agent: null });
        return json(res, {
          agent: {
            agentId: config.agentId,
            name: config.agentId,
            description: "",
            skills: config.specialties,
            priceEth: config.pricing.baseRateEth,
            owner: "",
          },
        });
      }

      case "/api/agentcash-balance": {
        return json(res, { error: "AgentCash not supported in cloud mode" }, 400);
      }

      case "/api/eth-price": {
        const resp = await fetch(
          "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD",
        );
        const data = (await resp.json()) as { USD?: number };
        if (!data.USD) return json(res, { error: "Failed to fetch ETH price" }, 502);
        return json(res, { price: data.USD });
      }

      default:
        return json(res, { error: "Not found" }, 404);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("API error:", msg, err);
    return json(res, { error: msg }, 500);
  }
}

async function handleSetup(
  pathname: string,
  req: VercelRequest,
  res: VercelResponse,
) {
  const configured = await isConfigured();
  const config = await loadConfig();

  switch (pathname) {
    case "/api/setup/status": {
      const step = !config
        ? "wallet"
        : !config.agentId
          ? "register"
          : !config.llm?.apiKey
            ? "llm"
            : "specialization";
      return json(res, {
        configured,
        mode: configured ? "running" : "setup",
        step,
      });
    }

    case "/api/setup/wallet": {
      // In cloud mode, wallet is managed externally
      return json(res, {
        address: config?.agentId
          ? "managed-externally"
          : "0x0000000000000000000000000000000000000000",
      });
    }

    case "/api/setup/agent-lookup": {
      if (config?.agentId) {
        return json(res, {
          agent: {
            agentId: config.agentId,
            name: config.agentId,
            description: "",
            skills: config.specialties ?? [],
            priceEth: config.pricing?.baseRateEth ?? "0.005",
            owner: "",
          },
        });
      }
      return json(res, { agent: null });
    }

    case "/api/setup/wallet/import": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      // In cloud mode, wallet import is not supported - but we accept agentId directly
      const body = req.body as { privateKey?: string; agentId?: string };
      return json(res, {
        address: "managed-externally",
        note: "Wallet management is done via the moltlaunch CLI. Set agentId directly via /api/setup/register.",
      });
    }

    case "/api/setup/register": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      const body = req.body as {
        agentId?: string;
        name?: string;
        description?: string;
        skills?: string[];
        price?: string;
      };
      if (!body.agentId) {
        return json(res, { error: "agentId is required in cloud mode" }, 400);
      }
      await savePartialConfig({ agentId: body.agentId });
      return json(res, { agentId: body.agentId });
    }

    case "/api/setup/llm": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      const body = req.body as LLMConfig;
      await savePartialConfig({ llm: body });
      return json(res, { ok: true });
    }

    case "/api/setup/llm/test": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      const body = req.body as LLMConfig;
      const testResult = await testLLM(body);
      return json(res, testResult);
    }

    case "/api/setup/specialization": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      const body = req.body as {
        specialties: string[];
        pricing: { strategy: string; baseRateEth: string; maxRateEth: string };
        autoQuote: boolean;
        autoWork: boolean;
        maxConcurrentTasks: number;
        declineKeywords: string[];
      };
      await savePartialConfig({
        specialties: body.specialties,
        pricing: body.pricing as CashClawConfig["pricing"],
        autoQuote: body.autoQuote,
        autoWork: body.autoWork,
        maxConcurrentTasks: body.maxConcurrentTasks,
        declineKeywords: body.declineKeywords,
      });
      return json(res, { ok: true });
    }

    case "/api/setup/complete": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      const nowConfigured = await isConfigured();
      if (!nowConfigured) {
        return json(res, { error: "Configuration incomplete" }, 400);
      }
      await saveAgentState({ running: true, startedAt: Date.now() });
      return json(res, { ok: true, mode: "running" });
    }

    case "/api/setup/reset": {
      if (req.method !== "POST") return json(res, { error: "POST only" }, 405);
      await saveAgentState({ running: false });
      return json(res, { ok: true, mode: "setup" });
    }

    default:
      return json(res, { error: "Not found" }, 404);
  }
}

async function handleConfigUpdate(req: VercelRequest, res: VercelResponse) {
  const updates = req.body as Partial<CashClawConfig>;
  const config = await loadConfig();
  if (!config) return json(res, { error: "No config" }, 400);

  if (updates.specialties) config.specialties = updates.specialties;
  if (updates.pricing) {
    const ethPattern = /^\d+(\.\d{1,18})?$/;
    if (
      !ethPattern.test(updates.pricing.baseRateEth) ||
      !ethPattern.test(updates.pricing.maxRateEth)
    ) {
      return json(res, { error: "Invalid ETH amount format" }, 400);
    }
    if (
      parseFloat(updates.pricing.baseRateEth) >
      parseFloat(updates.pricing.maxRateEth)
    ) {
      return json(res, { error: "baseRate cannot exceed maxRate" }, 400);
    }
    config.pricing = updates.pricing;
  }
  if (updates.autoQuote !== undefined) config.autoQuote = updates.autoQuote;
  if (updates.autoWork !== undefined) config.autoWork = updates.autoWork;
  if (updates.maxConcurrentTasks !== undefined) {
    const val = Number(updates.maxConcurrentTasks);
    if (!Number.isInteger(val) || val < 1 || val > 20) {
      return json(res, { error: "maxConcurrentTasks must be 1-20" }, 400);
    }
    config.maxConcurrentTasks = val;
  }
  if (updates.declineKeywords) config.declineKeywords = updates.declineKeywords;
  if (updates.personality) {
    const p = updates.personality;
    if (p.customInstructions && p.customInstructions.length > 2000) {
      return json(
        res,
        { error: "customInstructions must be under 2000 characters" },
        400,
      );
    }
    config.personality = p;
  }
  if (updates.learningEnabled !== undefined)
    config.learningEnabled = updates.learningEnabled;
  if (updates.studyIntervalMs !== undefined) {
    const val = Number(updates.studyIntervalMs);
    if (val < 60_000 || val > 86_400_000) {
      return json(
        res,
        { error: "studyIntervalMs must be 60000-86400000" },
        400,
      );
    }
    config.studyIntervalMs = val;
  }
  if (updates.polling) config.polling = updates.polling;
  if (updates.agentCashEnabled !== undefined)
    config.agentCashEnabled = updates.agentCashEnabled;

  if (updates.llm) {
    const newLlm = { ...updates.llm };
    if (newLlm.apiKey === "***") {
      if (newLlm.provider !== config.llm.provider) {
        return json(
          res,
          { error: "New provider selected — please enter your API key" },
          400,
        );
      }
      newLlm.apiKey = config.llm.apiKey;
    }
    config.llm = newLlm;
  }

  await savePartialConfig(config);
  return json(res, { ok: true });
}

async function handleChat(req: VercelRequest, res: VercelResponse) {
  const body = req.body as { message?: string };
  if (!body.message?.trim()) {
    return json(res, { error: "Message required" }, 400);
  }

  const config = await loadConfig();
  if (!config) return json(res, { error: "Not configured" }, 400);

  const userMsg = body.message.trim();
  await appendChat({ role: "user", content: userMsg, timestamp: Date.now() });

  const [allKnowledge, feedback, history] = await Promise.all([
    loadKnowledge(),
    loadFeedback(),
    loadChat(),
  ]);
  const relevantKnowledge = getRelevantKnowledge(allKnowledge, config.specialties, 5);
  const stats = getFeedbackStats(feedback);

  const specialties =
    config.specialties.length > 0
      ? config.specialties.join(", ")
      : "general tasks";

  const knowledgeSection =
    relevantKnowledge.length > 0
      ? `\n\nYou've learned these insights from self-study:\n${relevantKnowledge.map((k) => `- ${k.insight.slice(0, 200)}`).join("\n")}`
      : "";

  const personalitySection = config.personality
    ? `\nYour personality: tone=${config.personality.tone}, style=${config.personality.responseStyle}.${config.personality.customInstructions ? ` Custom instructions: ${config.personality.customInstructions}` : ""}`
    : "";

  const systemPrompt = `You are CashClaw (agent "${config.agentId}"), an autonomous work agent on the moltlaunch marketplace.
Your specialties: ${specialties}. These are your ONLY areas of expertise.

## Self-awareness
- Learning: ${config.learningEnabled ? "ACTIVE" : "DISABLED"}
- Knowledge entries: ${allKnowledge.length}
- Tasks completed: ${stats.totalTasks}, avg score: ${stats.avgScore}/5
- Note: Running in cloud mode (Vercel). The polling heartbeat runs externally.${personalitySection}

You're chatting with your operator. Be helpful, concise, and direct.${knowledgeSection}`;

  const llmResponse = await callLLM(config.llm, systemPrompt, history.slice(-20));

  await appendChat({ role: "assistant", content: llmResponse, timestamp: Date.now() });
  return json(res, { reply: llmResponse });
}

async function testLLM(
  llm: LLMConfig,
): Promise<{ ok: boolean; response?: string; error?: string }> {
  try {
    const response = await callLLM(
      llm,
      "You are a helpful assistant.",
      [{ role: "user", content: "Say hello in one sentence.", timestamp: 0 }],
    );
    return { ok: true, response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function callLLM(
  llm: LLMConfig,
  systemPrompt: string,
  history: { role: string; content: string; timestamp: number }[],
): Promise<string> {
  const messages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  if (llm.provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": llm.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: llm.model || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API error: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      content: { type: string; text: string }[];
    };
    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  if (llm.provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: llm.model || "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0].message.content;
  }

  if (llm.provider === "openrouter") {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: llm.model || "anthropic/claude-sonnet-4-20250514",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
    if (!resp.ok) {
      throw new Error(`OpenRouter API error: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0].message.content;
  }

  throw new Error(`Unknown LLM provider: ${llm.provider}`);
}
