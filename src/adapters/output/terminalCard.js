export function renderTerminalCard(card) {
  const lines = [];
  const decision = card.decision;
  const action = card.action;
  const outcome = card.outcome;
  const toolPlan = decision?.toolPlan;
  const toolExecution = outcome?.execution;

  lines.push("=".repeat(88));
  lines.push("[CLI Knowledge Card]");

  if (decision) {
    lines.push(`触发模式: ${decision.trigger?.mode || "unknown"}`);
    lines.push(`错误类型: ${decision.match?.category || "unknown"}`);
    lines.push(`严重级别: ${decision.match?.severity || "info"}`);
    lines.push(`匹配信号: ${decision.match?.matchedSignal || "-"}`);
    lines.push(`决策置信度: ${decision.match?.confidence || "unknown"}`);
    lines.push(`风险等级: ${decision.policy?.riskLevel || "unknown"}`);
    lines.push(`诊断: ${decision.diagnosis}`);

    if (decision.guidance?.suggestedActions?.length) {
      lines.push("建议步骤:");
      decision.guidance.suggestedActions.forEach((item, index) => {
        lines.push(`${index + 1}. ${item}`);
      });
    }

    if (decision.guidance?.routeToSkills?.length) {
      lines.push(`关联 Skill: ${decision.guidance.routeToSkills.join(", ")}`);
    }

    if (decision.guidance?.nextCommand) {
      lines.push(`下一步命令: ${decision.guidance.nextCommand}`);
    }

    if (decision.policy?.deliveryTargets?.length) {
      lines.push(`当前分发形态: ${decision.policy.deliveryTargets.join(", ")}`);
    }

    if (decision.policy?.optionalDeliveryTargets?.length) {
      lines.push(`可扩展分发形态: ${decision.policy.optionalDeliveryTargets.join(", ")}`);
    }
  }

  if (action) {
    lines.push("半智能体动作:");
    lines.push(`- 策略: ${action.strategy}`);
    lines.push(`- 执行模式: ${action.executionMode}`);
    lines.push(`- 下一步类型: ${action.reasoning?.nextStepKind || "guidance_only"}`);
  }

  if (toolPlan) {
    lines.push("工具调用计划:");
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
  }

  if (outcome) {
    lines.push("半智能体结果:");
    lines.push(`- 实际状态: ${outcome.actualStatus}`);
    lines.push(`- 归一状态: ${outcome.effectiveStatus}`);
    lines.push(`- 摘要: ${outcome.summary}`);
  }

  if (toolExecution) {
    lines.push("工具执行结果:");

    if (toolExecution.preflight?.summary) {
      lines.push(`- 预检: ${toolExecution.preflight.summary}`);
    }

    if (toolExecution.dataHints?.length) {
      lines.push(`- 数据线索: ${toolExecution.dataHints.join(", ")}`);
    }

    if (toolExecution.analysis?.usage) {
      lines.push(`- 环境实测用法: ${toolExecution.analysis.usage}`);
    }

    if (toolExecution.analysis?.flags?.length) {
      lines.push(`- 环境实测参数: ${toolExecution.analysis.flags.join(", ")}`);
    }

    if (toolExecution.analysis?.paramsFields?.length) {
      lines.push(
        `- Schema 参数(--params): ${toolExecution.analysis.paramsFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}${item.location ? `@${item.location}` : ""}`)
          .join(", ")}`,
      );
    }

    if (toolExecution.analysis?.bodyFields?.length) {
      lines.push(
        `- Schema 体(--data): ${toolExecution.analysis.bodyFields
          .map((item) => `${item.name}${item.required ? "(required)" : ""}`)
          .join(", ")}`,
      );
    }

    if (toolExecution.analysis?.conclusions?.length) {
      lines.push("- 环境实测结论:");
      toolExecution.analysis.conclusions.forEach((item) => {
        lines.push(`  - ${item}`);
      });
    }
  }

  if (card.source) {
    lines.push(`来源: ${card.source}`);
  }

  lines.push(`事件上下文: ${card.context}`);
  lines.push("=".repeat(88));

  console.log(`${lines.join("\n")}\n`);
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
