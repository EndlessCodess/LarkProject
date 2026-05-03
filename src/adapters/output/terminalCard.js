export function renderTerminalCard(card) {
  const lines = [];
  const decision = card.decision;
  const action = card.action;
  const outcome = card.outcome;
  const toolPlan = decision?.toolPlan;
  const toolExecution = outcome?.execution;
  const retrieval = decision?.match?.retrieval;

  lines.push("=".repeat(100));
  lines.push("[CLI Knowledge Card · Debug View]");
  lines.push(`流水线: ${buildPipelineSummary({ decision, retrieval, toolPlan, action, outcome })}`);

  pushSection(lines, "0", "输入上下文");
  lines.push(`- 事件类型: ${decision?.trigger?.type || "unknown"}`);
  lines.push(`- 触发模式: ${decision?.trigger?.mode || "unknown"}`);
  lines.push(`- 原始文本: ${card.context || decision?.trigger?.text || "-"}`);

  if (decision) {
    pushSection(lines, "1", "知识获取与匹配");
    lines.push(`- 路径: ${retrieval?.results?.length ? "规则未命中 -> 本地轻量 RAG 召回" : "结构化规则直接命中"}`);
    lines.push(`- 错误类型: ${decision.match?.category || "unknown"}`);
    lines.push(`- 严重级别: ${decision.match?.severity || "info"}`);
    lines.push(`- 匹配信号: ${decision.match?.matchedSignal || "-"}`);
    lines.push(`- 决策置信度: ${decision.match?.confidence || "unknown"}`);
    lines.push(`- 风险等级: ${decision.policy?.riskLevel || "unknown"}`);

    if (retrieval?.results?.length) {
      lines.push(`- 召回策略: ${retrieval.strategy || "local_lightweight_retrieval"}`);
      lines.push(`- 召回原因: ${retrieval.reason || "-"}`);
      lines.push(`- 召回数量: ${retrieval.results.length}`);
      lines.push("召回证据 Top3:");
      retrieval.results.slice(0, 3).forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.title}`);
        lines.push(`     来源: ${item.source}`);
        lines.push(`     分数: ${item.score} | 命中词: ${item.matched_terms?.slice(0, 8).join(", ") || "-"}`);
      });
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
    lines.push("- 状态: 未生成 action");
  }

  pushSection(lines, "4", "工具计划");
  if (toolPlan) {
    lines.push(`- 工具: ${toolPlan.tool}`);
    lines.push(`- 模式: ${toolPlan.mode}`);
    lines.push(`- 安全级别: ${toolPlan.safety}`);
    lines.push(`- 只读: ${toolPlan.readonly ? "是" : "否"}`);
    lines.push(`- 需要确认: ${toolPlan.requires_confirmation ? "是" : "否"}`);
    lines.push(`- 可自动执行: ${toolPlan.executable ? "是" : "否"}`);
    lines.push(`- 命令: ${toolPlan.command}`);

    if (toolPlan.reason) {
      lines.push(`- 原因: ${toolPlan.reason}`);
    }

    if (toolPlan.unresolved?.length) {
      lines.push(`- 未解析变量: ${toolPlan.unresolved.join(", ")}`);
    }
  } else {
    lines.push("- 状态: 无工具计划，仅输出知识建议");
  }

  pushSection(lines, "5", "执行结果");
  if (outcome) {
    lines.push(`- 实际状态: ${outcome.actualStatus}`);
    lines.push(`- 归一状态: ${outcome.effectiveStatus}`);
    lines.push(`- 摘要: ${outcome.summary}`);
  } else {
    lines.push("- 状态: 未生成 outcome");
  }

  if (hasToolExecutionDetails(toolExecution)) {
    lines.push("- 工具执行详情:");

    if (toolExecution.preflight?.summary) {
      lines.push(`  - 预检: ${toolExecution.preflight.summary}`);
    }

    if (toolExecution.dataHints?.length) {
      lines.push(`  - 数据线索: ${toolExecution.dataHints.join(", ")}`);
    }

    if (toolExecution.analysis?.usage) {
      lines.push(`  - 环境实测用法: ${toolExecution.analysis.usage}`);
    }

    if (toolExecution.analysis?.flags?.length) {
      lines.push(`  - 环境实测参数: ${toolExecution.analysis.flags.join(", ")}`);
    }

    if (toolExecution.analysis?.paramsFields?.length) {
      lines.push(
        `  - Schema 参数(--params): ${toolExecution.analysis.paramsFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}${item.location ? `@${item.location}` : ""}`)
          .join(", ")}`,
      );
    }

    if (toolExecution.analysis?.bodyFields?.length) {
      lines.push(
        `  - Schema 体(--data): ${toolExecution.analysis.bodyFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}`)
          .join(", ")}`,
      );
    }

    if (toolExecution.analysis?.conclusions?.length) {
      lines.push("  - 环境实测结论:");
      toolExecution.analysis.conclusions.forEach((item) => {
        lines.push(`    - ${item}`);
      });
    }
  }

  pushSection(lines, "6", "分发与来源");
  if (decision?.policy?.deliveryTargets?.length) {
    lines.push(`- 当前分发形态: ${decision.policy.deliveryTargets.join(", ")}`);
  }

  if (decision?.policy?.optionalDeliveryTargets?.length) {
    lines.push(`- 可扩展分发形态: ${decision.policy.optionalDeliveryTargets.join(", ")}`);
  }

  if (card.source) {
    lines.push(`- 来源: ${card.source}`);
  }

  lines.push("=".repeat(100));

  console.log(`${lines.join("\n")}\n`);
}

function pushSection(lines, step, title) {
  lines.push("");
  lines.push(`[${step}] ${title}`);
  lines.push("-".repeat(88));
}

function buildPipelineSummary({ decision, retrieval, toolPlan, action, outcome }) {
  const knowledgeStep = retrieval?.results?.length ? "RAG召回" : "规则命中";
  const planStep = toolPlan ? "工具计划" : "无工具";
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

export function renderNoMatch(event) {
  const lines = [
    "-".repeat(88),
    "[No Match]",
    `事件上下文: ${event.text}`,
    "建议: 当前知识库未命中，可补充新的错误规则。",
    "-".repeat(88),
  ];

  console.log(`${lines.join("\n")}\n`);
}
