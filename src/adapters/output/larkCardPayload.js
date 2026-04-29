function toActionList(items = []) {
  return items.slice(0, 3).map((item, index) => `${index + 1}. ${item}`);
}

function truncate(value, max = 120) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function formatSeverityLabel(severity) {
  if (severity === "error") return "高优先级";
  if (severity === "warning") return "中优先级";
  if (severity === "info") return "低优先级";
  return "未知优先级";
}

function formatSeverityIcon(severity) {
  if (severity === "error") return "🚨";
  if (severity === "warning") return "⚠️";
  if (severity === "info") return "💡";
  return "📌";
}

function formatStatus(actualStatus, effectiveStatus) {
  if (actualStatus === effectiveStatus) return actualStatus;
  return `${actualStatus} → ${effectiveStatus}`;
}

function buildCategoryMeta(category) {
  const metaMap = {
    command_existence: {
      title: "命令存在性检查",
      shortTag: "命令检查",
      focus: "先确认命令/子命令/shortcut 真实存在，再继续执行。",
      icon: "🔎",
    },
    permission_scope: {
      title: "权限与授权处理",
      shortTag: "权限授权",
      focus: "优先区分 user / bot 身份，再补 scope 或发起授权。",
      icon: "🔐",
    },
    resource_access: {
      title: "资源访问与链接解析",
      shortTag: "资源访问",
      focus: "优先确认 token 类型、资源可见性和访问权限。",
      icon: "📎",
    },
    token_type: {
      title: "Token 类型校验",
      shortTag: "Token 校验",
      focus: "避免把 wiki / base / doc token 混用。",
      icon: "🧩",
    },
    shortcut_usage: {
      title: "Shortcut 使用规范",
      shortTag: "Shortcut 规范",
      focus: "先看 shortcut 帮助，再补齐 flags 和参数。",
      icon: "🛠️",
    },
  };

  return (
    metaMap[category] || {
      title: "通用 CLI 诊断",
      shortTag: "通用诊断",
      focus: "先确认命令、权限和上下文，再继续执行。",
      icon: "💡",
    }
  );
}

function buildPriorityBanner(severity, diagnosis) {
  if (severity !== "error") return null;
  return {
    tag: "markdown",
    content: `**🚨 优先处理**\n${truncate(diagnosis, 72)}`,
  };
}

function buildSummaryBlock({ riskLevel, confidence, actualStatus, effectiveStatus, matchedSignal }) {
  return [
    `- 风险：${riskLevel}`,
    `- 置信度：${confidence}`,
    `- 状态：${formatStatus(actualStatus, effectiveStatus)}`,
    `- 信号：\`${truncate(matchedSignal, 72)}\``,
  ].join("\n");
}

function buildActionBlock(suggestions) {
  if (!suggestions.length) {
    return "1. 先检查命令与参数是否真实存在。\n2. 再决定是否继续调用 API。";
  }
  return suggestions.join("\n");
}

function buildMetaLine(skills = [], mode = "event_driven") {
  return `Skill：${skills.length ? skills.join(", ") : "-"} | 模式：${mode}`;
}

export function buildLarkCardPayload({ decision, outcome, context }) {
  const category = decision?.match?.category || "unknown";
  const categoryMeta = buildCategoryMeta(category);
  const suggestions = toActionList(decision?.guidance?.suggestedActions || []);
  const skills = decision?.guidance?.routeToSkills || [];
  const nextCommand = decision?.guidance?.nextCommand || "-";
  const matchedSignal = decision?.match?.matchedSignal || "-";
  const diagnosis = decision?.diagnosis || "No diagnosis provided.";
  const riskLevel = decision?.policy?.riskLevel || "unknown";
  const confidence = decision?.match?.confidence || "unknown";
  const effectiveStatus = outcome?.effectiveStatus || "unknown";
  const actualStatus = outcome?.actualStatus || "unknown";
  const summary = outcome?.summary || "No execution summary.";
  const severity = decision?.match?.severity || "unknown";
  const mode = decision?.trigger?.mode || "event_driven";

  const elements = [
    {
      tag: "markdown",
      content: `**${categoryMeta.icon} ${categoryMeta.title}**\n${categoryMeta.focus}`,
    },
    {
      tag: "markdown",
      content: `**概览**\n${buildSummaryBlock({ riskLevel, confidence, actualStatus, effectiveStatus, matchedSignal })}`,
    },
  ];

  const priorityBanner = buildPriorityBanner(severity, diagnosis);
  if (priorityBanner) {
    elements.push(priorityBanner);
  }

  elements.push(
    {
      tag: "markdown",
      content: `**结论与处理**\n${diagnosis}\n\n${buildActionBlock(suggestions)}`,
    },
    {
      tag: "markdown",
      content: `**建议命令**\n\`\`\`bash\n${nextCommand}\n\`\`\``,
    },
    {
      tag: "markdown",
      content: `**执行摘要**\n${truncate(summary, 120)}`,
    },
    {
      tag: "hr",
    },
    {
      tag: "markdown",
      content: `**上下文（节选）**\n\`\`\`\n${truncate(context, 140)}\n\`\`\``,
    },
    {
      tag: "markdown",
      content: buildMetaLine(skills, mode),
    },
  );

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: mapSeverityToTemplate(severity),
      title: {
        tag: "plain_text",
        content: `${formatSeverityIcon(severity)} CLI 主动知识卡 · ${categoryMeta.shortTag}`,
      },
      subtitle: {
        tag: "plain_text",
        content: `${formatSeverityLabel(severity)} · ${mode}`,
      },
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements,
    },
  };
}

function mapSeverityToTemplate(severity) {
  if (severity === "error") return "red";
  if (severity === "warning") return "orange";
  if (severity === "info") return "blue";
  return "grey";
}
