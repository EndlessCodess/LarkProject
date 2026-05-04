import { composeWithLlm } from "./llmComposer.js";

function truncate(value, max = 120) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function buildCompositionInput(event, picked, toolPlan, liveEvidence = null) {
  const context = normalizeEventContext(event);
  return {
    query: buildSearchQuery(context, picked),
    context,
    retrieval: picked?._retrieval || null,
    toolPlan: toolPlan || null,
    liveEvidence,
    rule: {
      id: picked?.id || "",
      category: picked?.category || picked?.type || "unknown",
      severity: picked?.severity || "info",
      diagnosis: picked?.diagnosis || "",
      suggestedActions: picked?.suggested_actions || [picked?.suggestion].filter(Boolean),
      nextCommand: picked?.next_command_template || "",
      routeToSkills: picked?.route_to_skills || [],
    },
  };
}

export async function composeKnowledge(input, options = {}) {
  const mode = options.composeMode || "template";
  if (mode === "off") return null;

  if (mode === "llm") {
    const llmResult = await composeWithLlm(input, options);
    if (llmResult.ok) return llmResult.output;

    const fallback = composeTemplate(input);
    fallback.mode = "template_fallback";
    fallback.fallbackReason = llmResult.summary;
    fallback.llmAttempt = {
      reason: llmResult.reason,
      summary: llmResult.summary,
      model: llmResult.config?.model || "",
      baseUrl: llmResult.config?.baseUrl || "",
    };
    return fallback;
  }

  return composeTemplate(input);
}

function composeTemplate(input) {
  const context = input.context || {};
  const rule = input.rule || {};
  const retrieval = input.retrieval;
  const liveEvidence = input.liveEvidence;
  const routeToSkills = [...new Set([...(rule.routeToSkills || []), ...extractRetrievalSkills(retrieval)])];

  const diagnosis = retrieval?.results?.length
    ? composeRetrievalDiagnosis(context, retrieval, routeToSkills, liveEvidence)
    : composeRuleDiagnosis(context, rule, liveEvidence);

  const suggestedActions = retrieval?.results?.length
    ? composeRetrievalActions(context, retrieval, routeToSkills, rule, liveEvidence)
    : composeRuleActions(context, rule, liveEvidence);

  return {
    mode: "template",
    query: input.query,
    contextSummary: buildContextSummary(context),
    liveEvidence,
    diagnosis,
    suggestedActions,
    nextCommand: rule.nextCommand || inferNextCommand(context, routeToSkills),
    routeToSkills,
  };
}

function normalizeEventContext(event = {}) {
  return {
    source: event.source || "",
    triggerMode: event.trigger_mode || event.triggerMode || "",
    text: String(event.text || "").trim(),
    command: String(event.command || extractCommandFromText(event.text || "")).trim(),
    exitCode: event.exit_code ?? event.exitCode ?? "",
    stderr: String(event.stderr_preview || extractBlock(event.text || "", "stderr")).trim(),
    stdout: String(event.stdout_preview || extractBlock(event.text || "", "stdout")).trim(),
    cwd: String(event.cwd || "").trim(),
  };
}

function buildSearchQuery(context, picked) {
  const parts = [];
  if (context.command) parts.push(context.command);
  if (context.stderr) parts.push(truncate(context.stderr, 220));
  if (!context.stderr && context.stdout) parts.push(truncate(context.stdout, 220));
  if (picked?._matchedSignal) parts.push(`signal:${picked._matchedSignal}`);
  if (picked?.category || picked?.type) parts.push(`category:${picked.category || picked.type}`);
  return {
    text: parts.join("\n"),
    facets: {
      service: extractService(context.command),
      command: context.command,
      exitCode: context.exitCode,
      source: context.source,
    },
  };
}

function composeRuleDiagnosis(context, rule, liveEvidence) {
  const commandLine = context.command ? `命令 \`${context.command}\`` : "当前命令";
  const exitNote = context.exitCode !== "" ? `（exit=${context.exitCode}）` : "";
  const liveHint = buildLiveEvidenceHint(liveEvidence);
  if (rule.diagnosis) {
    return `${commandLine}${exitNote} 命中了已有规则：${rule.diagnosis}${liveHint}`;
  }
  return `${commandLine}${exitNote} 命中了已知的 ${rule.category || "CLI"} 规则，建议按下方步骤继续排查。${liveHint}`;
}

function composeRetrievalDiagnosis(context, retrieval, routeToSkills, liveEvidence) {
  const primary = retrieval.results?.[0];
  const commandLine = context.command ? `命令 \`${context.command}\`` : "当前命令";
  const exitNote = context.exitCode !== "" ? `（exit=${context.exitCode}）` : "";
  const skillHint = routeToSkills.length ? `当前更接近 ${routeToSkills.slice(0, 3).join(", ")} 这类知识域。` : "";
  const liveHint = buildLiveEvidenceHint(liveEvidence);
  return `${commandLine}${exitNote} 没有直接命中结构化规则，已从本地知识库召回与“${primary?.title || primary?.source || "当前问题"}”最相关的证据。${skillHint}${liveHint}`.trim();
}

function composeRuleActions(context, rule, liveEvidence) {
  const actions = [];
  if (context.command) actions.push(`先围绕 \`${context.command}\` 复查命令层级、身份和参数。`);
  if (liveEvidence?.usage) actions.push(`当前环境的 help 已确认可用写法：${truncate(liveEvidence.usage, 90)}。`);
  actions.push(...(rule.suggestedActions || []));
  if (context.stderr) actions.push(`重点关注报错里的关键信号：${truncate(firstLine(context.stderr), 80)}。`);
  return uniqueTrimmed(actions).slice(0, 4);
}

function composeRetrievalActions(context, retrieval, routeToSkills, rule, liveEvidence) {
  const actions = [];
  if (routeToSkills.length) actions.push(`优先查看 ${routeToSkills.slice(0, 3).join(", ")} 对应的 Skill 说明。`);
  if (context.command) actions.push(`以 \`${context.command}\` 为主线，对照召回证据确认该命令属于哪个 service、shortcut 或 API 层级。`);
  if (liveEvidence?.usage) actions.push(`结合当前环境 help：${truncate(liveEvidence.usage, 90)}。`);
  if (context.stderr) actions.push(`先根据报错摘要定位问题：${truncate(firstLine(context.stderr), 80)}。`);
  actions.push("如果命令形态仍不确定，再用当前环境的 `--help` 或 `schema` 做只读验证。");
  actions.push(...(rule.suggestedActions || []));
  return uniqueTrimmed(actions).slice(0, 4);
}

function inferNextCommand(context, routeToSkills) {
  const service = extractService(context.command);
  if (service) return `lark-cli ${service} --help`;
  const firstSkill = routeToSkills.find((item) => item.startsWith("lark-"));
  if (firstSkill) return `lark-cli ${firstSkill.replace(/^lark-/, "")} --help`;
  return "lark-cli --help";
}

function extractRetrievalSkills(retrieval) {
  return (retrieval?.results || [])
    .map((item) => item.metadata?.skillName)
    .filter((item) => typeof item === "string" && item.startsWith("lark-"));
}

function buildContextSummary(context) {
  const lines = [];
  if (context.command) lines.push(`command=${context.command}`);
  if (context.exitCode !== "") lines.push(`exit=${context.exitCode}`);
  if (context.cwd) lines.push(`cwd=${context.cwd}`);
  if (context.stderr) lines.push(`stderr=${truncate(firstLine(context.stderr), 80)}`);
  if (!context.stderr && context.stdout) lines.push(`stdout=${truncate(firstLine(context.stdout), 80)}`);
  return lines.join(" | ");
}

function buildLiveEvidenceHint(liveEvidence) {
  if (!liveEvidence) return "";
  if (liveEvidence.status === "command_ok_help_returned" && liveEvidence.usage) {
    return ` 当前环境 help 也给出了可用写法：${truncate(liveEvidence.usage, 90)}。`;
  }
  if (liveEvidence.status === "failed") {
    return ` 当前环境 help 未成功返回：${truncate(liveEvidence.summary, 80)}。`;
  }
  return "";
}

function extractCommandFromText(text) {
  const match = String(text || "").match(/(?:terminal command:\s*)?(lark-cli[^\n]+)/i);
  return match?.[1] || "";
}

function extractBlock(text, label) {
  const pattern = new RegExp(`${label}:\\n([\\s\\S]+)$`, "i");
  const match = String(text || "").match(pattern);
  return match?.[1] || "";
}

function extractService(command) {
  const match = String(command || "").match(/^lark-cli\s+([a-z0-9_-]+)/i);
  return match?.[1] || "";
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).find(Boolean) || "";
}

function uniqueTrimmed(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}
