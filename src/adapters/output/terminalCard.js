export function renderTerminalCard(card) {

  const view = normalizeTerminalView(card.cardView || card.view);
  if (view === "debug") {
    renderDebugTerminalCard(card);
    return;
  }
  renderCompactTerminalCard(card);
}

function renderCompactTerminalCard(card) {
  const decision = card.decision || {};
  const outcome = card.outcome || {};
  const retrieval = decision?.match?.retrieval;
  const skills = decision?.guidance?.routeToSkills || [];
  const nextCommand = decision?.guidance?.nextCommand || "";
  const summary = compactDiagnosis(decision.diagnosis || "");
  const topEvidence = retrieval?.results?.[0];
  const lines = [];

  lines.push("-".repeat(88));
  lines.push(`[CLI Knowledge] ${buildCompactTitle(decision)}`);
  if (summary) lines.push(`结论: ${summary}`);
  if (nextCommand) lines.push(`建议命令: ${nextCommand}`);
  if (skills.length) lines.push(`Skill: ${skills.slice(0, 3).join(", ")}`);
  if (topEvidence) lines.push(`证据: ${topEvidence.title}`);
  if (outcome.summary) lines.push(`状态: ${outcome.summary}`);
  lines.push("-".repeat(88));

  console.log(`${lines.join("\n")}\n`);
}

function renderDebugTerminalCard(card) {
  const lines = [];
  const decision = card.decision;
  const action = card.action;
  const outcome = card.outcome;
  const toolPlan = decision?.toolPlan;
  const toolExecution = outcome?.execution;
  const retrieval = decision?.match?.retrieval;
  const composition = decision?.composition;
  const liveEvidence = decision?.liveEvidence;

  lines.push("=".repeat(100));
  lines.push("[CLI Knowledge Card · Debug View]");
  lines.push(`流水线: ${buildPipelineSummary({ decision, retrieval, toolPlan, action, outcome })}`);

  pushSection(lines, "0", "输入上下文");
  lines.push(`- 事件类型: ${decision?.trigger?.type || "unknown"}`);
  lines.push(`- 触发模式: ${decision?.trigger?.mode || "unknown"}`);
  lines.push(`- 原始文本: ${card.context || decision?.trigger?.text || "-"}`);

  if (decision) {
    pushSection(lines, "1", "知识获取与匹配");
    lines.push(`- 路径: ${retrieval?.results?.length ? "规则未命中 -> RAG 召回" : "结构化规则直达"}`);
    lines.push(`- 错误类型: ${decision.match?.category || "unknown"}`);
    lines.push(`- 严重级别: ${decision.match?.severity || "info"}`);
    lines.push(`- 匹配信号: ${decision.match?.matchedSignal || "-"}`);
    lines.push(`- 决策置信度: ${decision.match?.confidence || "unknown"}`);
    lines.push(`- 风险等级: ${decision.policy?.riskLevel || "unknown"}`);

    if (composition?.mode) lines.push(`- 整理模式: ${composition.mode}`);
    if (composition?.model) lines.push(`- LLM 模型: ${composition.model}`);
    if (composition?.fallbackReason) lines.push(`- LLM 回退原因: ${truncateInline(composition.fallbackReason, 160)}`);
    if (liveEvidence?.usage || liveEvidence?.summary) {
      lines.push(`- 动态 help 证据: ${truncateInline(liveEvidence.usage || liveEvidence.summary, 160)}`);
    }

    if (retrieval?.results?.length) {
      lines.push(`- 召回策略: ${retrieval.strategy || "local_lightweight_retrieval"}`);
      lines.push(`- 检索模式: ${retrieval.retrieverMode || retrieval.results?.[0]?.metadata?.retrieverMode || "keyword"}`);
      lines.push(`- 召回原因: ${retrieval.reason || "-"}`);
      lines.push(`- 用户问题: ${truncateInline(retrieval.queryText || card.context || decision?.trigger?.text || "-", 160)}`);
      if (composition?.query?.text) {
        lines.push(`- LLM 整理查询: ${truncateInline(composition.query.text, 160)}`);
      }
      lines.push(`- 召回数量: ${retrieval.results.length}`);
      lines.push("召回证据 Top3:");
      retrieval.results.slice(0, 3).forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.title}`);
        lines.push(`     来源: ${item.source}`);
        lines.push(`     分数: ${item.score}${formatRetrieverDebug(item)} | 命中词: ${item.matched_terms?.slice(0, 8).join(", ") || "-"}`);
      });
    } else if (composition?.query?.text) {
      lines.push(`- LLM 整理查询: ${truncateInline(composition.query.text, 160)}`);
    }

    if (decision.guidance?.routeToSkills?.length) {
      lines.push(`- 关联 Skill: ${decision.guidance.routeToSkills.join(", ")}`);
    }

    pushSection(lines, "2", "诊断与建议");
    lines.push(`- 诊断: ${decision.diagnosis}`);

    if (decision.guidance?.suggestedActions?.length) {
      lines.push("- 建议步骤:");
      decision.guidance.suggestedActions.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item}`);
      });
    }

    if (decision.guidance?.nextCommand) {
      lines.push(`- 下一步命令: ${decision.guidance.nextCommand}`);
    }
  }

  pushSection(lines, "3", "Agent 动作选择");
  if (action) {
    lines.push(`- 策略: ${action.strategy}`);
    lines.push(`- 执行模式: ${action.executionMode}`);
    lines.push(`- 下一步类型: ${action.reasoning?.nextStepKind || "guidance_only"}`);
  } else {
    lines.push("- 状态: 当前没有 action。");
  }

  pushSection(lines, "4", "工具计划");
  if (toolPlan) {
    lines.push(`- 工具: ${toolPlan.tool}`);
    lines.push(`- 模式: ${toolPlan.mode}`);
    lines.push(`- 安全等级: ${toolPlan.safety}`);
    lines.push(`- 只读: ${toolPlan.readonly ? "是" : "否"}`);
    lines.push(`- 需要确认: ${toolPlan.requires_confirmation ? "是" : "否"}`);
    lines.push(`- 可执行: ${toolPlan.executable ? "是" : "否"}`);
    lines.push(`- 命令: ${toolPlan.command}`);
    if (toolPlan.reason) lines.push(`- 原因: ${toolPlan.reason}`);
    if (toolPlan.unresolved?.length) lines.push(`- 未解决项: ${toolPlan.unresolved.join(", ")}`);
  } else {
    lines.push("- 状态: 无工具计划，仅输出知识建议。");
  }

  pushSection(lines, "5", "执行结果");
  if (outcome) {
    lines.push(`- 实际状态: ${outcome.actualStatus}`);
    lines.push(`- 归一状态: ${outcome.effectiveStatus}`);
    lines.push(`- 摘要: ${outcome.summary}`);
  } else {
    lines.push("- 状态: 当前没有 outcome。");
  }

  if (hasToolExecutionDetails(toolExecution)) {
    lines.push("- 工具执行分析:");
    if (toolExecution.preflight?.summary) lines.push(`  - 预检摘要: ${toolExecution.preflight.summary}`);
    if (toolExecution.dataHints?.length) lines.push(`  - 数据提示: ${toolExecution.dataHints.join(", ")}`);
    if (toolExecution.analysis?.usage) lines.push(`  - 用法判断: ${toolExecution.analysis.usage}`);
    if (toolExecution.analysis?.flags?.length) lines.push(`  - Flags: ${toolExecution.analysis.flags.join(", ")}`);
    if (toolExecution.analysis?.paramsFields?.length) {
      lines.push(
        `  - Schema(--params): ${toolExecution.analysis.paramsFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}${item.location ? `@${item.location}` : ""}`)
          .join(", ")}`,
      );
    }
    if (toolExecution.analysis?.bodyFields?.length) {
      lines.push(
        `  - Schema(--data): ${toolExecution.analysis.bodyFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}`)
          .join(", ")}`,
      );
    }
    if (toolExecution.analysis?.conclusions?.length) {
      lines.push("  - 结论:");
      toolExecution.analysis.conclusions.forEach((item) => lines.push(`    - ${item}`));
    }
  }

  pushSection(lines, "6", "分发与来源");
  if (decision?.policy?.deliveryTargets?.length) lines.push(`- 当前分发形态: ${decision.policy.deliveryTargets.join(", ")}`);
  if (decision?.policy?.optionalDeliveryTargets?.length) lines.push(`- 可扩展分发形态: ${decision.policy.optionalDeliveryTargets.join(", ")}`);
  if (card.source) lines.push(`- 来源: ${card.source}`);

  lines.push("=".repeat(100));
  console.log(`${lines.join("\n")}\n`);
}

function buildCompactTitle(decision) {
  const category = decision?.match?.category || "knowledge";
  const signal = decision?.match?.matchedSignal || "";
  if (category === "command_existence") return "命令纠错";
  if (category === "permission_scope") return "权限提示";
  if (category === "resource_access") return "资源访问";
  if (signal.startsWith("retriever:")) return "知识建议";
  return "CLI 结论";
}

function compactDiagnosis(text) {
  return truncateInline(String(text || "").replace(/\s+/g, " "), 90);
}

function normalizeTerminalView(view) {
  return String(view || "release").toLowerCase() === "debug" ? "debug" : "release";
}

function pushSection(lines, step, title) {
  lines.push("");
  lines.push(`[${step}] ${title}`);
  lines.push("-".repeat(88));
}

function buildPipelineSummary({ decision, retrieval, toolPlan, action, outcome }) {
  const knowledgeStep = retrieval?.results?.length ? "RAG召回" : "规则直达";
  const planStep = toolPlan ? "有工具计划" : "无工具";
  const actionStep = action?.executionMode || "no_action";
  const resultStep = outcome?.effectiveStatus || outcome?.actualStatus || "no_outcome";
  const category = decision?.match?.category || "unknown";
  return `${knowledgeStep} -> ${category} -> ${planStep} -> ${actionStep} -> ${resultStep}`;
}

function hasToolExecutionDetails(toolExecution) {
  if (!toolExecution) return false;
  return Boolean(
    toolExecution.preflight?.summary ||
      toolExecution.dataHints?.length ||
      toolExecution.analysis?.usage ||
      toolExecution.analysis?.flags?.length ||
      toolExecution.analysis?.paramsFields?.length ||
      toolExecution.analysis?.bodyFields?.length ||
      toolExecution.analysis?.conclusions?.length,
  );
}

function truncateInline(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function formatRetrieverDebug(item) {
  const mode = item?.metadata?.retrieverMode;
  const score = item?.metadata?.retrieverScore;
  if (!mode || !score) return "";
  return ` | ${mode} k=${formatScore(score.keyword)} s=${formatScore(score.semantic)} r=${formatScore(score.routeBonus)}`;
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(4);
}

export function renderNoMatch(event) {
  const lines = [
    "-".repeat(88),
    "[No Match]",
    `输入文本: ${event.text}`,
    "处理结果: 当前没有命中结构化规则，也没有召回到可用知识，请补充规则或知识源后再试。",
    "-".repeat(88),
  ];

  console.log(`${lines.join("\n")}\n`);
}
