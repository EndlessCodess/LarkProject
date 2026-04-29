import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readJsonLines } from "../core/io.js";
import { matchKnowledge } from "../core/matcher.js";
import { loadKnowledge } from "../core/knowledge/loadKnowledge.js";
import { buildToolPlan } from "../core/agent/toolPlanner.js";
import { interpretToolResult } from "../core/agent/resultInterpreter.js";
import { buildDecision } from "../core/agent/decisionEngine.js";
import { selectAction } from "../core/agent/actionEngine.js";
import { buildOutcome } from "../core/agent/outcomeEngine.js";
import { preflightLarkCliCommand, runLarkCli } from "../adapters/lark-cli/runner.js";
import { buildLarkCardPayload } from "../adapters/output/larkCardPayload.js";
import { writeLarkCardArtifact } from "../adapters/output/writeLarkCardArtifact.js";
import { sendLarkInteractiveCard } from "../adapters/output/sendLarkInteractiveCard.js";
import { evaluatePushPolicy } from "../adapters/output/pushPolicy.js";
import { renderTerminalCard, renderNoMatch } from "../adapters/output/terminalCard.js";

export async function runDemo(options) {
  const [events, kb] = await Promise.all([readJsonLines(options.source), loadKnowledge(options)]);
  const regression = [];

  console.log(`Loaded ${events.length} events, ${kb.items.length} knowledge rules.`);
  console.log(`Knowledge source: ${kb.meta?.sourceType || options.knowledgeSource}`);
  console.log(`Auto readonly execution: ${options.autoReadonly ? "enabled" : "disabled"}`);
  console.log(`Lark card push: ${options.pushLarkCard ? `enabled -> ${options.pushChatId || "<missing chat_id>"}` : "disabled"}\n`);

  for (const event of events) {
    const picked = matchKnowledge(event, kb.items);

    if (!picked) {
      renderNoMatch(event);
      regression.push({
        event: event.text,
        matched: false,
        executionStatus: "no_match",
        effectiveStatus: "no_match",
        expectedStatus: event.expected_status || null,
        expectedRuleId: event.expected_rule_id || null,
        pass: !event.expected_status || event.expected_status === "no_match",
      });
      continue;
    }

    const toolPlan = buildToolPlan(picked, event);
    const decision = buildDecision({ event, picked, toolPlan, options });
    const action = selectAction(decision, options);
    const toolExecution = await maybeExecuteToolPlan(action.toolPlan, options, picked);
    const effectiveStatus = inferEffectiveStatus(toolExecution?.status || "not_executed", toolExecution?.plannedStatus);
    const larkCardPayload = buildLarkCardPayload({ decision, action, outcome: { actualStatus: toolExecution?.status || "not_executed", effectiveStatus, summary: toolExecution?.summary || "No execution summary." }, context: event.text });
    const larkCardArtifactFile = await writeLarkCardArtifact(larkCardPayload, options);
    const pushResult = await maybePushLarkCard(larkCardPayload, options, decision, event.text);
    const outcome = buildOutcome({
      decision,
      action,
      execution: toolExecution,
      effectiveStatus,
      larkCardPayload,
      larkCardArtifactFile,
      pushResult,
    });

    renderTerminalCard({ decision, action, outcome, source: picked.source || "", context: event.text });
    regression.push(buildRegressionRecord(event, picked, action.toolPlan, toolExecution));
  }

  if (options.showRegressionSummary) {
    await renderRegressionSummary(regression, kb.items, options);
  }
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
    return {
      status: policy.policyStatus,
      summary: policy.summary,
      policy,
    };
  }

  try {
    const result = await sendLarkInteractiveCard({
      chatId: options.pushChatId,
      payload,
      as: options.pushAs || "bot",
      debug: options.debugLarkCli,
    });

    return {
      status: "sent",
      summary: `已发送到飞书群 ${options.pushChatId}。`,
      transport: result,
      policy,
    };
  } catch (error) {
    return {
      status: "failed",
      summary: error.message,
      policy,
    };
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

function buildRegressionRecord(event, picked, toolPlan, toolExecution) {
  const actualStatus = toolExecution?.status || "not_executed";
  const effectiveStatus = inferEffectiveStatus(actualStatus, toolExecution?.plannedStatus);
  const expectedStatus = event.expected_status || null;
  const expectedRuleId = event.expected_rule_id || null;

  return {
    event: event.text,
    matched: true,
    ruleId: picked.id,
    expectedRuleId,
    category: picked.category || picked.type || "unknown",
    matchedSignal: picked._matchedSignal,
    command: toolPlan?.command || "",
    executable: Boolean(toolPlan?.executable),
    executionStatus: actualStatus,
    effectiveStatus,
    expectedStatus,
    pass: !expectedStatus || expectedStatus === effectiveStatus,
    rulePass: !expectedRuleId || expectedRuleId === picked.id,
  };
}

async function renderRegressionSummary(records, rules, options = {}) {
  const total = records.length;
  const matched = records.filter((item) => item.matched).length;
  const executable = records.filter((item) => item.executable).length;
  const byStatus = countBy(records.map((item) => item.executionStatus || "unknown"));
  const byEffectiveStatus = countBy(records.map((item) => item.effectiveStatus || item.executionStatus || "unknown"));
  const withExpectation = records.filter((item) => item.expectedStatus);
  const passed = withExpectation.filter((item) => item.pass).length;
  const failed = withExpectation.filter((item) => item.pass === false);

  console.log("[Regression Summary]");
  console.log(`- total: ${total}`);
  console.log(`- matched: ${matched}`);
  console.log(`- executable: ${executable}`);
  console.log(`- assertions: ${withExpectation.length}`);
  if (withExpectation.length) {
    console.log(`- assertions.passed: ${passed}`);
    console.log(`- assertions.failed: ${failed.length}`);
  }
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`- status.${status}: ${count}`);
  });
  Object.entries(byEffectiveStatus).forEach(([status, count]) => {
    console.log(`- effectiveStatus.${status}: ${count}`);
  });

  let failurePath = null;
  if (failed.length) {
    failurePath = await writeRegressionFailureReport(failed, options);
    console.log("- assertion failures:");
    failed.slice(0, 5).forEach((item, index) => {
      console.log(
        `  ${index + 1}. expected=${item.expectedStatus} actual=${item.executionStatus} effective=${item.effectiveStatus} rule=${item.ruleId || "<no-rule>"} :: ${truncate(item.event, 120)}`,
      );
    });
    if (failed.length > 5) {
      console.log(`  ... and ${failed.length - 5} more failures in file`);
    }
    console.log(`- failureDetailsFile: ${failurePath}`);
  }

  const qualityReport = buildQualityReport(records, rules, failurePath);
  if (options.showQualityReport !== false) {
    await renderQualityReport(qualityReport, options);
  }

  console.log("");
}

function buildQualityReport(records, rules, failurePath) {
  const matchedRecords = records.filter((item) => item.matched && item.ruleId);
  const unmatchedRecords = records.filter((item) => !item.matched);
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const hitsByRule = countBy(matchedRecords.map((item) => item.ruleId));
  const rulesWithHits = Object.keys(hitsByRule).length;
  const zeroHitRules = rules
    .map((rule) => rule.id)
    .filter((ruleId) => !hitsByRule[ruleId])
    .sort();
  const topRules = Object.entries(hitsByRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ruleId, hits]) => ({
      ruleId,
      hits,
      category: rulesById.get(ruleId)?.category || "unknown",
    }));
  const ruleExpectationFailures = records.filter((item) => item.expectedRuleId && item.rulePass === false);
  const ruleExpectationMismatchTop = Object.entries(
    countBy(ruleExpectationFailures.map((item) => `${item.expectedRuleId}=>${item.ruleId || "<no-match>"}`)),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([pair, count]) => ({ pair, count }));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      rules: rules.length,
      rulesWithHits,
      zeroHitRules: zeroHitRules.length,
      events: records.length,
      matched: matchedRecords.length,
      unmatched: unmatchedRecords.length,
      assertionFailures: records.filter((item) => item.pass === false).length,
      ruleExpectationFailures: ruleExpectationFailures.length,
    },
    topRules,
    zeroHitRules,
    unmatchedSamples: unmatchedRecords.slice(0, 10).map((item) => item.event),
    ruleExpectationMismatchTop,
    failureDetailsFile: failurePath,
  };
}

async function renderQualityReport(report, options = {}) {
  const outputPath = await writeQualityReport(report, options);

  console.log("[Rule Quality Report]");
  console.log(`- rules.total: ${report.totals.rules}`);
  console.log(`- rules.withHits: ${report.totals.rulesWithHits}`);
  console.log(`- rules.zeroHit: ${report.totals.zeroHitRules}`);
  console.log(`- records.unmatched: ${report.totals.unmatched}`);
  console.log(`- ruleExpectationFailures: ${report.totals.ruleExpectationFailures}`);
  if (report.topRules.length) {
    console.log("- topRules:");
    report.topRules.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.ruleId} (${item.category}) -> ${item.hits}`);
    });
  }
  if (report.zeroHitRules.length) {
    console.log(`- zeroHitRules.sample: ${report.zeroHitRules.slice(0, 8).join(", ")}`);
  }
  if (report.ruleExpectationMismatchTop.length) {
    console.log("- ruleExpectationMismatchTop:");
    report.ruleExpectationMismatchTop.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.pair} -> ${item.count}`);
    });
  }
  console.log(`- qualityReportFile: ${outputPath}`);
}

async function writeRegressionFailureReport(failed, options = {}) {
  const outputPath = resolve(options.regressionFailuresFile || "tmp/regression-failures.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(failed, null, 2)}\n`, "utf8");
  return outputPath;
}

async function writeQualityReport(report, options = {}) {
  const outputPath = resolve(options.qualityReportFile || "tmp/rule-quality-report.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function truncate(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
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
