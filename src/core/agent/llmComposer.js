const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VOLC_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_TEMPERATURE = 0.2;

export async function composeWithLlm(input, options = {}) {
  const config = resolveLlmConfig(options);
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "missing_api_key",
      summary: `LLM composer 未启用：缺少 ${config.apiKeySource}。`,
      config,
    };
  }

  const requestBody = buildChatCompletionRequest(input, config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        reason: "http_error",
        summary: `LLM composer 请求失败：HTTP ${response.status} ${truncate(rawText, 240)}`,
        config,
      };
    }

    const payload = safeJsonParse(rawText);
    const content = extractAssistantText(payload);
    if (!content) {
      return {
        ok: false,
        reason: "empty_response",
        summary: "LLM composer 未返回可解析内容。",
        config,
      };
    }

    const parsed = safeJsonParse(content);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        reason: "invalid_json",
        summary: `LLM composer 返回了非 JSON 内容：${truncate(content, 160)}`,
        config,
      };
    }

    const normalized = normalizeLlmOutput(parsed, input, config);
    return {
      ok: true,
      output: normalized,
      config,
    };
  } catch (error) {
    const summary =
      error?.name === "AbortError"
        ? `LLM composer 超时：${config.timeoutMs}ms`
        : `LLM composer 调用失败：${error.message}`;
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "timeout" : "request_failed",
      summary,
      config,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function resolveLlmConfig(options = {}) {
  const provider = resolveProvider(options);
  const apiKey =
    options.llmApiKey ||
    process.env.ARK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY ||
    "";
  const baseUrl = stripTrailingSlash(
    options.llmBaseUrl ||
      process.env.ARK_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.LLM_BASE_URL ||
      (provider === "volc-ark" ? DEFAULT_VOLC_BASE_URL : DEFAULT_BASE_URL),
  );
  const model =
    options.llmModel ||
    process.env.ARK_MODEL ||
    process.env.ARK_ENDPOINT_ID ||
    process.env.OPENAI_MODEL ||
    process.env.LLM_MODEL ||
    DEFAULT_MODEL;
  const timeoutMs = normalizeNumber(
    options.llmTimeoutMs ||
      process.env.OPENAI_TIMEOUT_MS ||
      process.env.LLM_TIMEOUT_MS,
    provider === "volc-ark" ? 45000 : DEFAULT_TIMEOUT_MS,
  );
  const temperature = normalizeFloat(
    options.llmTemperature ||
      process.env.OPENAI_TEMPERATURE ||
      process.env.LLM_TEMPERATURE,
    DEFAULT_TEMPERATURE,
  );

  return {
    provider,
    apiKey,
    apiKeySource: options.llmApiKey
      ? "--llm-api-key"
      : process.env.ARK_API_KEY
        ? "ARK_API_KEY"
        : "OPENAI_API_KEY",
    baseUrl,
    model,
    timeoutMs,
    temperature,
    maxTokens: normalizeNumber(
      options.llmMaxTokens ||
        process.env.ARK_MAX_TOKENS ||
        process.env.OPENAI_MAX_TOKENS ||
        process.env.LLM_MAX_TOKENS,
      512,
    ),
  };
}

function buildChatCompletionRequest(input, config) {
  const body = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: JSON.stringify(buildUserPayload(input), null, 2) },
    ],
  };

  if (config.provider !== "volc-ark") {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function buildSystemPrompt() {
  return [
    "你是一个企业办公知识整合与分发 Agent 里的 CLI 知识压缩器。",
    "你的任务是根据规则命中、知识召回结果和动态 help 证据，生成高密度、可执行、低幻觉的知识卡摘要。",
    "请严格输出 JSON 对象，不要输出 Markdown，不要输出额外解释。",
    "JSON 字段要求：",
    "{",
    '  "diagnosis": "一句话诊断，强调当前最可能的问题来源",',
    '  "suggestedActions": ["2到4条建议，尽量可执行"],',
    '  "nextCommand": "建议下一条命令，没有就给空字符串",',
    '  "routeToSkills": ["技能名列表，可为空"],',
    '  "confidence": "high|medium|low",',
    '  "uncertainty": "如果有不确定性，用一句话说明；没有就空字符串"',
    "}",
    "约束：",
    "1. 优先引用输入里的真实证据，不要编造命令。",
    "2. 如果动态 help 已提供 usage，尽量让建议与该 usage 对齐。",
    "3. 如果是规则未命中但召回了知识块，明确说明这是基于召回证据的判断。",
    "4. 如果信息不足，降低 confidence，并在 uncertainty 中说明。",
  ].join("\n");
}

function buildUserPayload(input) {
  return {
    context: input.context || {},
    query: input.query || {},
    rule: input.rule || {},
    toolPlan: summarizeToolPlan(input.toolPlan),
    liveEvidence: input.liveEvidence || null,
    retrieval: summarizeRetrieval(input.retrieval),
  };
}

function summarizeToolPlan(toolPlan) {
  if (!toolPlan) return null;
  return {
    tool: toolPlan.tool,
    mode: toolPlan.mode,
    readonly: toolPlan.readonly,
    executable: toolPlan.executable,
    command: toolPlan.command,
    reason: toolPlan.reason,
  };
}

function summarizeRetrieval(retrieval) {
  if (!retrieval?.results?.length) return null;
  return {
    strategy: retrieval.strategy || "",
    reason: retrieval.reason || "",
    results: retrieval.results.slice(0, 4).map((item) => ({
      title: item.title,
      source: item.source,
      score: item.score,
      matchedTerms: item.matched_terms?.slice(0, 8) || [],
      skillName: item.metadata?.skillName || "",
      snippet: truncate(item.content || "", 320),
    })),
  };
}

function normalizeLlmOutput(parsed, input, config) {
  const routeToSkills = uniqueStrings([
    ...(parsed.routeToSkills || []),
    ...extractRetrievalSkills(input.retrieval),
    ...(input.rule?.routeToSkills || []),
  ]);

  return {
    mode: "llm",
    provider: "openai_compatible",
    model: config.model,
    query: input.query,
    contextSummary: buildContextSummary(input.context || {}),
    liveEvidence: input.liveEvidence || null,
    diagnosis: normalizeSentence(parsed.diagnosis) || fallbackDiagnosis(input),
    suggestedActions: uniqueStrings(parsed.suggestedActions || []).slice(0, 4),
    nextCommand: normalizeSentence(parsed.nextCommand) || input.rule?.nextCommand || "",
    routeToSkills,
    confidence: normalizeConfidence(parsed.confidence),
    uncertainty: normalizeSentence(parsed.uncertainty),
  };
}

function fallbackDiagnosis(input) {
  const command = input.context?.command ? `命令 \`${input.context.command}\`` : "当前问题";
  if (input.retrieval?.results?.length) {
    return `${command} 没有直接命中结构化规则，当前诊断主要基于本地知识召回与动态 help 证据。`;
  }
  return `${command} 命中了已有规则，当前诊断主要基于规则与动态 help 证据。`;
}

function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractRetrievalSkills(retrieval) {
  return (retrieval?.results || [])
    .map((item) => item.metadata?.skillName)
    .filter((item) => typeof item === "string" && item.startsWith("lark-"));
}

function buildContextSummary(context) {
  const lines = [];
  if (context.command) lines.push(`command=${context.command}`);
  if (context.exitCode !== "" && context.exitCode !== undefined) lines.push(`exit=${context.exitCode}`);
  if (context.cwd) lines.push(`cwd=${context.cwd}`);
  if (context.stderr) lines.push(`stderr=${truncate(firstLine(context.stderr), 80)}`);
  if (!context.stderr && context.stdout) lines.push(`stdout=${truncate(firstLine(context.stdout), 80)}`);
  return lines.join(" | ");
}

function normalizeConfidence(value) {
  const lowered = String(value || "").toLowerCase();
  if (["high", "medium", "low"].includes(lowered)) return lowered;
  return "medium";
}

function normalizeSentence(value) {
  return String(value || "").trim();
}

function uniqueStrings(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveProvider(options = {}) {
  const explicit = String(options.llmProvider || process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;

  if (process.env.ARK_API_KEY || process.env.ARK_MODEL || process.env.ARK_BASE_URL || process.env.ARK_ENDPOINT_ID) {
    return "volc-ark";
  }

  return "openai";
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeFloat(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).find(Boolean) || "";
}
