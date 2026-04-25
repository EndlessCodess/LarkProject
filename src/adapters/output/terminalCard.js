export function renderTerminalCard(card) {
  const lines = [];

  lines.push("=".repeat(88));
  lines.push("[CLI Knowledge Card]");
  lines.push(`错误类型: ${card.category}`);
  lines.push(`严重级别: ${card.severity}`);
  lines.push(`匹配信号: ${card.matchedSignal}`);
  lines.push(`诊断: ${card.diagnosis}`);

  if (card.suggestedActions?.length) {
    lines.push("建议步骤:");
    card.suggestedActions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action}`);
    });
  }

  if (card.routeToSkills?.length) {
    lines.push(`关联 Skill: ${card.routeToSkills.join(", ")}`);
  }

  if (card.nextCommand) {
    lines.push(`下一步命令: ${card.nextCommand}`);
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
