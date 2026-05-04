import { matchKnowledge } from "../core/matcher.js";
import { buildRetrievedKnowledgeRule, retrieveKnowledge } from "../core/knowledge/retriever.js";
import { buildToolPlan } from "../core/agent/toolPlanner.js";
import { interpretToolResult } from "../core/agent/resultInterpreter.js";
import { buildCompositionInput, composeKnowledge } from "../core/agent/composer.js";
import { collectLiveCliEvidence } from "../core/agent/liveCliEvidence.js";
import { buildDecision } from "../core/agent/decisionEngine.js";
import { selectAction } from "../core/agent/actionEngine.js";
import { buildOutcome } from "../core/agent/outcomeEngine.js";
import { preflightLarkCliCommand, runLarkCli } from "../adapters/lark-cli/runner.js";
import { buildLarkCardPayload } from "../adapters/output/larkCardPayload.js";
import { writeLarkCardArtifact } from "../adapters/output/writeLarkCardArtifact.js";
import { sendLarkInteractiveCard } from "../adapters/output/sendLarkInteractiveCard.js";
import { evaluatePushPolicy } from "../adapters/output/pushPolicy.js";
import { renderTerminalCard, renderNoMatch } from "../adapters/output/terminalCard.js";

export async function processKnowledgeEvent({
  event,
  kb,
  retriever,
  options = {},
  noMatchMode = "render",
  renderTerminal = true,
  outcomeSummary = "No execution summary.",
}) {
  const picked = pickKnowledge(event, kb.items, retriever);

  if (!picked) {
    if (noMatchMode === "render") renderNoMatch(event);
    return { matched: false, event };
  }

  const toolPlan = buildToolPlan(picked, event);
  const liveEvidence = await collectLiveCliEvidence(event, options);
  const compositionInput = buildCompositionInput(event, picked, toolPlan, liveEvidence);
  const composition = await composeKnowledge(compositionInput, options);
  const decision = buildDecision({ event, picked, toolPlan, options, composition });
  const action = selectAction(decision, options);
  const toolExecution = await maybeExecuteToolPlan(action.toolPlan, options, picked);
  const effectiveStatus = inferEffectiveStatus(toolExecution?.status || "not_executed", toolExecution?.plannedStatus);
  const outcomeDraft = {
    actualStatus: toolExecution?.status || "not_executed",
    effectiveStatus,
    summary: toolExecution?.summary || outcomeSummary,
  };
  const larkCardPayload = buildLarkCardPayload({
    decision,
    action,
    outcome: outcomeDraft,
    context: event.text,
  });
  const larkCardArtifactFile = await writeLarkCardArtifact(larkCardPayload, options);
  const pushResult = await maybePushLarkCard(larkCardPayload, options, decision, event.text);
  const outcome = buildOutcome({
    decision,
    action,
    execution: toolExecution || { status: "not_executed", summary: outcomeSummary },
    effectiveStatus,
    larkCardPayload,
    larkCardArtifactFile,
    pushResult,
  });

  if (renderTerminal) {
    renderTerminalCard({ decision, action, outcome, source: picked.source || "", context: event.text });
  }

  return {
    matched: true,
    event,
    picked,
    decision,
    action,
    outcome,
    pushResult,
  };
}

export function pickKnowledge(event, knowledgeItems, retriever) {
  const direct = matchKnowledge(event, knowledgeItems);
  if (direct) return direct;

  const retrievalResults = retrieveKnowledge(event, retriever, { topK: 5 });
  return buildRetrievedKnowledgeRule(event, retrievalResults);
}

async function maybePushLarkCard(payload, options, decision, context) {
  if (!options.pushLarkCard) {
    return { status: "disabled", summary: "未开启飞书卡片推送。" };
  }

  if (!options.pushChatId) {
    return { status: "blocked", summary: "已开启飞书卡片推送，但缺少 --push-chat-id。" };
  }

  const policy = await evaluatePushPolicy({ decision, options, context });
  if (!policy.shouldSend) {
    return { status: policy.policyStatus, summary: policy.summary, policy };
  }

  try {
    const result = await sendLarkInteractiveCard({
      chatId: options.pushChatId,
      payload,
      as: options.pushAs || "bot",
      debug: options.debugLarkCli,
    });
    return { status: "sent", summary: `已发送到飞书群 ${options.pushChatId}。`, transport: result, policy };
  } catch (error) {
    return { status: "failed", summary: error.message, policy };
  }
}

async function maybeExecuteToolPlan(toolPlan, options, picked) {
  if (!toolPlan) return null;

  const plannedStatus = inferPlannedStatus(toolPlan, picked);

  if (!options.autoReadonly) {
    return {
      status: "not_executed",
      summary: "未开启 --auto-readonly，仅展示工具调用计划。",
      plannedStatus,
    };
  }

  if (!toolPlan.executable) {
    return {
      status: "blocked",
      summary: buildBlockedReason(toolPlan),
      plannedStatus,
    };
  }

  const args = toolPlan.commandArgs[0] === "lark-cli" ? toolPlan.commandArgs : ["lark-cli", ...toolPlan.commandArgs];
  const preflight = await preflightLarkCliCommand(args, {
    timeoutMs: options.larkCliTimeoutMs,
    debug: options.debugLarkCli,
  });

  if (!preflight.ok) {
    return {
      status: "command_invalid",
      summary: preflight.summary,
      plannedStatus,
      analysis: {
        kind: "preflight",
        conclusions: [preflight.summary],
      },
    };
  }

  const execArgs = args.slice(1);

  try {
    const result = await runLarkCli(execArgs, { timeoutMs: options.larkCliTimeoutMs, debug: options.debugLarkCli });
    return interpretToolResult(result, { preflight, plannedStatus });
  } catch (error) {
    return interpretToolResult({ error }, { preflight, plannedStatus });
  }
}

function buildBlockedReason(toolPlan) {
  if (toolPlan.requires_confirmation) return "该工具计划需要用户确认，不能自动执行。";
  if (!toolPlan.readonly) return "该工具计划不是只读操作，不能自动执行。";
  if (toolPlan.unresolved?.length) return `命令模板仍有未解析变量：${toolPlan.unresolved.join(", ")}。`;
  return "该工具计划未通过安全门控。";
}

function inferEffectiveStatus(actualStatus, plannedStatus) {
  if (["command_invalid", "command_ok_auth_failed", "command_ok_help_returned", "command_ok_api_failed", "command_ok_resource_not_found", "permission_required"].includes(actualStatus)) {
    return actualStatus;
  }

  if (["blocked", "not_executed", null, undefined].includes(actualStatus)) {
    return plannedStatus || actualStatus || "unknown";
  }

  return plannedStatus || actualStatus;
}

function inferPlannedStatus(toolPlan, picked) {
  if (!toolPlan) return null;

  if (toolPlan.mode === "manual_auth") return "permission_required";
  if (toolPlan.mode === "readonly_help") return "command_ok_help_returned";
  if (toolPlan.mode === "readonly_check") {
    if (picked?.category === "resource_access") return "command_ok_resource_not_found";
    return "command_ok_api_failed";
  }
  return null;
}
