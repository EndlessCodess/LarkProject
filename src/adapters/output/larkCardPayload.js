function toPlainList(items = []) {
  return items.slice(0, 5).map((item, index) => `${index + 1}. ${item}`);
}

function truncate(value, max = 160) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function buildLarkCardPayload({ decision, action, outcome, context }) {
  const suggestions = toPlainList(decision?.guidance?.suggestedActions || []);
  const skills = decision?.guidance?.routeToSkills?.join(" / ") || "-";
  const nextCommand = decision?.guidance?.nextCommand || "-";
  const matchedSignal = decision?.match?.matchedSignal || "-";
  const diagnosis = decision?.diagnosis || "No diagnosis provided.";
  const riskLevel = decision?.policy?.riskLevel || "unknown";
  const confidence = decision?.match?.confidence || "unknown";
  const effectiveStatus = outcome?.effectiveStatus || "unknown";
  const actualStatus = outcome?.actualStatus || "unknown";
  const summary = outcome?.summary || "No execution summary.";

  const contentLines = [
    `诊断：${diagnosis}`,
    `匹配信号：${matchedSignal}`,
    `决策置信度：${confidence}`,
    `风险等级：${riskLevel}`,
    `执行状态：${actualStatus} / ${effectiveStatus}`,
    `关联 Skill：${skills}`,
    `下一步命令：${nextCommand}`,
    `执行摘要：${summary}`,
  ];

  if (suggestions.length) {
    contentLines.push("建议步骤：");
    contentLines.push(...suggestions);
  }

  contentLines.push(`事件上下文：${truncate(context, 220)}`);

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: mapSeverityToTemplate(decision?.match?.severity),
      title: {
        tag: "plain_text",
        content: `CLI 主动知识卡 · ${decision?.match?.category || "unknown"}`,
      },
      subtitle: {
        tag: "plain_text",
        content: `触发模式: ${decision?.trigger?.mode || "event_driven"}`,
      },
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content: contentLines.join("\n"),
        },
        {
          tag: "hr",
        },
        {
          tag: "markdown",
          content: "此卡片为推送产物预览。下一阶段可接入飞书群聊或私聊发送。",
        },
      ],
    },
  };
}

function mapSeverityToTemplate(severity) {
  if (severity === "error") return "red";
  if (severity === "warning") return "orange";
  if (severity === "info") return "blue";
  return "grey";
}
