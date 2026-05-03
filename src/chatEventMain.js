import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runLarkCli } from "./adapters/lark-cli/runner.js";
import { loadKnowledge } from "./core/knowledge/loadKnowledge.js";
import { buildKnowledgeRetriever, buildRetrievedKnowledgeRule, retrieveKnowledge } from "./core/knowledge/retriever.js";
import { matchKnowledge } from "./core/matcher.js";
import { buildToolPlan } from "./core/agent/toolPlanner.js";
import { buildDecision } from "./core/agent/decisionEngine.js";
import { selectAction } from "./core/agent/actionEngine.js";
import { buildLarkCardPayload } from "./adapters/output/larkCardPayload.js";
import { writeLarkCardArtifact } from "./adapters/output/writeLarkCardArtifact.js";
import { sendLarkInteractiveCard } from "./adapters/output/sendLarkInteractiveCard.js";
import { evaluatePushPolicy } from "./adapters/output/pushPolicy.js";

function parseArgs(argv) {
  const args = {
    knowledgeSource: "local",
    knowledge: "knowledge/lark-cli-errors.json",
    debugLarkCli: false,
    pushLarkCard: false,
    pushChatId: "",
    pushAs: "bot",
    pushLevel: "high_only",
    pushDedupeTtlMs: 600000,
    pushDedupeFile: "tmp/push-dedupe-state.json",
    pushBypassPolicy: false,
    pushBypassDedupe: false,
    sourceChatId: "",
    eventType: "im.message.receive_v1",
    subscribeAs: "bot",
    compact: true,
    quiet: true,
    larkCliTimeoutMs: 30000,
    reconcilePoll: true,
    reconcileAs: "user",
    reconcileIntervalMs: 5000,
    reconcileLimit: 20,
    terminalsDir: process.env.CURSOR_TERMINALS_DIR || "",
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
    else if (key === "--debug-lark-cli") args.debugLarkCli = true;
    else if (key === "--push-lark-card") args.pushLarkCard = true;
    else if (key === "--push-chat-id" && value) args.pushChatId = argv[++i];
    else if (key === "--push-as" && value) args.pushAs = argv[++i];
    else if (key === "--push-level" && value) args.pushLevel = argv[++i];
    else if (key === "--push-dedupe-ttl-ms" && value) args.pushDedupeTtlMs = Number(argv[++i]);
    else if (key === "--push-dedupe-file" && value) args.pushDedupeFile = argv[++i];
    else if (key === "--push-bypass-policy") args.pushBypassPolicy = true;
    else if (key === "--push-bypass-dedupe") args.pushBypassDedupe = true;
    else if (key === "--source-chat-id" && value) args.sourceChatId = argv[++i];
    else if (key === "--event-type" && value) args.eventType = argv[++i];
    else if (key === "--subscribe-as" && value) args.subscribeAs = argv[++i];
    else if (key === "--lark-cli-timeout-ms" && value) args.larkCliTimeoutMs = Number(argv[++i]);
    else if (key === "--reconcile-poll") args.reconcilePoll = true;
    else if (key === "--no-reconcile-poll") args.reconcilePoll = false;
    else if (key === "--reconcile-as" && value) args.reconcileAs = argv[++i];
    else if (key === "--reconcile-interval-ms" && value) args.reconcileIntervalMs = Number(argv[++i]);
    else if (key === "--reconcile-limit" && value) args.reconcileLimit = Number(argv[++i]);
    else if (key === "--terminals-dir" && value) args.terminalsDir = argv[++i];
    else if (key === "--compact") args.compact = true;
    else if (key === "--no-compact") args.compact = false;
    else if (key === "--quiet") args.quiet = true;
    else if (key === "--no-quiet") args.quiet = false;
  }

  return args;
}

function normalizeMessageText(item) {
  const directText = item?.text || item?.message?.text;
  if (typeof directText === "string" && directText.trim()) return directText.trim();

  const directBody = item?.body || item?.message?.body;
  if (typeof directBody === "string" && directBody.trim()) return directBody.trim();

  const rawContent = item?.content || item?.message?.content;
  if (typeof rawContent === "string") {
    const parsed = safeParseJson(rawContent);
    if (typeof parsed?.text === "string" && parsed.text.trim()) return parsed.text.trim();
    if (typeof parsed?.content === "string" && parsed.content.trim()) return parsed.content.trim();
    return rawContent.trim();
  }
  return "";
}

function getMessageId(item) {
  return String(item?.message_id || item?.messageId || item?.id || item?.message?.message_id || "");
}

function looksLikeCliError(text) {
  const normalized = String(text || "").toLowerCase();
  const hasCliMention = normalized.includes("lark-cli") || normalized.includes("飞书 cli") || normalized.includes("飞书cli");
  if (!hasCliMention) return false;

  const strongSignals = [
    "failed",
    "error",
    "permission denied",
    "unknown flag",
    "unknown service",
    "scope",
    "invalid",
    "字段值类型不匹配",
    "字段类型不匹配",
    "类型不匹配",
    "readonly",
    "ignored_fields",
    "wiki_token",
    "base_token",
    "api version",
    "not found",
    "access denied",
    "公式",
    "meeting room",
    "room-find",
  ];

  const intentSignals = [
    "告诉我",
    "怎么",
    "如何",
    "为什么",
    "报错",
    "执行",
    "帮我",
    "看下",
    "看看",
    "应该",
    "怎么选",
    "先看",
    "参考",
    "哪类",
    "哪个",
    "还是",
    "是否",
    "建议",
    "规则",
    "说明",
    "流程",
    "选哪",
  ];
  return strongSignals.some((signal) => normalized.includes(signal)) || intentSignals.some((signal) => normalized.includes(signal)) || normalized.includes("?");
}

function isBotSelfMessage(item, options) {
  if ((options?.pushAs || "").toLowerCase() !== "bot") return false;

  const messageType = String(item?.message_type || item?.msg_type || item?.message?.message_type || "").toLowerCase();
  const senderType = String(item?.sender_type || item?.sender?.sender_type || item?.sender?.type || "").toLowerCase();
  const text = normalizeMessageText(item);

  if (senderType === "app" || senderType === "bot") return true;
  if (messageType === "interactive") return true;
  if (text.startsWith("<card title=\"⚠️ CLI 主动知识卡") || text.startsWith("<card title='⚠️ CLI 主动知识卡")) return true;
  return false;
}

function toEvent(item, options) {
  if (isBotSelfMessage(item, options)) return null;
  const text = normalizeMessageText(item);
  if (!text || !looksLikeCliError(text)) return null;
  return {
    type: "cli_error",
    text,
    source: "lark_event_subscribe",
    message_id: getMessageId(item),
    chat_id: item?.chat_id || item?.chatId || item?.message?.chat_id || options?.sourceChatId || "",
    create_time: item?.create_time || item?.timestamp || item?.message?.create_time || "",
    sender_id:
      item?.sender_id ||
      item?.sender?.sender_id?.open_id ||
      item?.sender?.id?.open_id ||
      item?.message?.sender_id ||
      "",
  };
}

async function readRecentChatMessages(options) {
  const args = [
    "im",
    "+chat-messages-list",
    "--chat-id",
    options.sourceChatId,
    "--as",
    options.reconcileAs || "user",
    "--page-size",
    String(Math.max(1, Math.min(Number(options.reconcileLimit || 20), 50))),
    "--sort",
    "desc",
    "--format",
    "json",
  ];

  const result = await runLarkCli(args, {
    timeoutMs: options.larkCliTimeoutMs,
    debug: options.debugLarkCli,
  });

  const payload = safeParseJson(result.stdout);
  if (result.code !== 0 || payload?.ok === false) {
    const detail = payload?.error?.message || result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(detail);
  }

  return Array.isArray(payload?.data?.messages)
    ? payload.data.messages
    : Array.isArray(payload?.data?.items)
      ? payload.data.items
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
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

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractEventPayload(line, expectedEventType) {
  const trimmed = String(line || "").trim();
  const direct = safeParseJson(trimmed);
  if (direct && typeof direct === "object") {
    if (!expectedEventType || direct?.type === expectedEventType || direct?.event_type === expectedEventType) return direct;
    if (direct?.header?.event_type === expectedEventType && direct?.event) {
      return {
        type: direct.header.event_type,
        ...direct.event,
      };
    }
  }

  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    const nested = safeParseJson(trimmed.slice(jsonStart));
    if (nested && typeof nested === "object") {
      if (!expectedEventType || nested?.type === expectedEventType || nested?.event_type === expectedEventType) return nested;
      if (nested?.header?.event_type === expectedEventType && nested?.event) {
        return {
          type: nested.header.event_type,
          ...nested.event,
        };
      }
    }
  }

  return null;
}

function buildSubscribeArgs(options) {
  const args = ["event", "+subscribe", "--as", options.subscribeAs || "bot", "--event-types", options.eventType || "im.message.receive_v1"];
  if (options.compact) args.push("--compact");
  if (options.quiet) args.push("--quiet");
  return args;
}

function killProcessGroup(child, signal) {
  if (child.exitCode != null) return;

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Fall back to killing the direct child below.
  }

  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

function exitCodeFromSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGHUP") return 129;
  if (signal === "SIGTERM") return 143;
  return 1;
}

async function warnOnOtherSubscribers(options) {
  const terminalsDir = String(options.terminalsDir || "").trim();
  if (!terminalsDir) return;

  try {
    const names = await fs.readdir(terminalsDir);
    const candidates = [];

    for (const name of names) {
      if (!name.endsWith(".txt")) continue;
      const filePath = path.join(terminalsDir, name);
      const raw = await fs.readFile(filePath, "utf8");
      if (!raw.includes("lark-cli event +subscribe")) continue;
      const isCurrentCommand = raw.includes("node src/chatEventMain.js") || raw.includes("node ./src/chatEventMain.js") || raw.includes("npm run demo:chat-event");
      candidates.push({ name, isCurrentCommand });
    }

    const others = candidates.filter((item) => !item.isCurrentCommand);
    if (others.length > 0) {
      console.warn(`[chat-event][warn] 检测到其他事件订阅终端仍可能在运行：${others.map((item) => item.name).join(", ")}。多个 bot 订阅连接可能导致事件被分流。`);
    }
  } catch (error) {
    console.warn(`[chat-event][warn] 无法检查其他订阅终端：${error.message}`);
  }
}

async function handleIncomingEvent(item, kb, retriever, options) {
  const resolvedChatId = item?.chat_id || item?.chatId || item?.message?.chat_id || options?.sourceChatId || "";
  const resolvedMessageId = getMessageId(item) || "<no-message-id>";
  const previewText = normalizeMessageText(item).slice(0, 120);

  console.log(`[chat-event] received: ${resolvedMessageId} chat=${resolvedChatId || "<unknown>"} text=${previewText || "<empty>"}`);

  if (options.sourceChatId && resolvedChatId !== options.sourceChatId) {
    console.log(`[chat-event] skip non-target chat: ${resolvedChatId || "<unknown>"}`);
    return;
  }

  if (isBotSelfMessage(item, options)) {
    console.log(`[chat-event] skip self/bot message: ${resolvedMessageId}`);
    return;
  }

  const text = normalizeMessageText(item);
  if (!text) {
    console.log(`[chat-event] skip empty/unreadable message: ${resolvedMessageId}`);
    return;
  }

  if (!looksLikeCliError(text)) {
    console.log(`[chat-event] skip non-cli signal: ${resolvedMessageId} ${text.slice(0, 80)}`);
    return;
  }

  const event = toEvent(item, options);
  if (!event) return;

  console.log(`[chat-event] candidate: ${event.message_id || "<no-message-id>"} ${event.text.slice(0, 120)}`);

  const picked = pickKnowledge(event, kb.items, retriever);
  if (!picked) {
    console.log(`[chat-event] ${event.message_id || "<no-message-id>"} -> no knowledge matched`);
    return;
  }

  if (picked._retrieval) {
    console.log(`[chat-event] ${event.message_id || "<no-message-id>"} -> retrieved ${picked._retrieval.results.length} knowledge chunk(s)`);
  }

  const toolPlan = buildToolPlan(picked, event);
  const decision = buildDecision({ event, picked, toolPlan, options });
  const action = selectAction(decision, options);
  const payload = buildLarkCardPayload({
    decision,
    action,
    outcome: {
      actualStatus: "not_executed",
      effectiveStatus: action?.toolPlan?.mode === "manual_auth" ? "permission_required" : "not_executed",
      summary: "来自事件订阅监听消息，当前仅做知识卡主动触发演示。",
    },
    context: event.text,
  });

  await writeLarkCardArtifact(payload, options);
  const pushResult = await maybePushLarkCard(payload, options, decision, event.text);
  console.log(`[chat-event] ${event.message_id || "<no-message-id>"} -> ${pushResult.status}: ${pushResult.summary}`);
}

function pickKnowledge(event, knowledgeItems, retriever) {
  const direct = matchKnowledge(event, knowledgeItems);
  if (direct) return direct;

  const retrievalResults = retrieveKnowledge(event, retriever, { topK: 5 });
  return buildRetrievedKnowledgeRule(event, retrievalResults);
}

async function startReconcilePolling(kb, retriever, options, seenMessageIds) {
  if (!options.reconcilePoll) return null;

  const intervalMs = Math.max(1000, Number(options.reconcileIntervalMs || 5000));

  async function baseline() {
    try {
      const messages = await readRecentChatMessages(options);
      for (const item of messages) {
        const messageId = getMessageId(item);
        if (messageId) seenMessageIds.add(messageId);
      }
      console.log(`[chat-event] reconcile baseline: ${messages.length} recent messages marked as seen`);
      return true;
    } catch (error) {
      console.warn(`[chat-event][warn] reconcile poll disabled: ${error.message}`);
      return false;
    }
  }

  async function tick() {
    let messages;
    try {
      messages = await readRecentChatMessages(options);
    } catch (error) {
      console.warn(`[chat-event][warn] reconcile poll failed: ${error.message}`);
      return;
    }

    const missed = [];
    for (const item of messages) {
      const messageId = getMessageId(item);
      if (!messageId || seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
      missed.push(item);
    }

    if (!missed.length) return;

    console.warn(`[chat-event][warn] reconcile found ${missed.length} message(s) not delivered by event stream`);
    for (const item of missed.reverse()) {
      await handleIncomingEvent(item, kb, retriever, options);
    }
  }

  const enabled = await baseline();
  if (!enabled) return null;

  const timer = setInterval(() => {
    tick().catch((error) => {
      console.warn(`[chat-event][warn] reconcile poll failed: ${error.message}`);
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!options.sourceChatId) throw new Error("缺少 --source-chat-id");

  const kb = await loadKnowledge(options);
  const retriever = await buildKnowledgeRetriever(options, kb);
  console.log(`[chat-event] knowledge rules: ${kb.items.length}`);
  console.log(`[chat-event] retriever chunks: ${retriever.meta.chunkCount}`);

  await warnOnOtherSubscribers(options);

  const args = buildSubscribeArgs(options);
  console.log(`[chat-event] subscribe: lark-cli ${args.join(" ")}`);

  const child = spawn("lark-cli", args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });

  let cleanupStarted = false;
  let requestedExitCode = null;
  const seenMessageIds = new Set();
  const reconcileTimer = await startReconcilePolling(kb, retriever, options, seenMessageIds);

  function cleanupChild(reason, exitCode = null) {
    if (cleanupStarted) return;
    cleanupStarted = true;
    requestedExitCode = exitCode;
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (!child.killed && child.exitCode == null) {
      console.log(`[chat-event] cleaning up subscriber (${reason})`);
      killProcessGroup(child, "SIGINT");
      setTimeout(() => {
        if (child.exitCode == null) {
          killProcessGroup(child, "SIGTERM");
        }
      }, 800).unref();
      setTimeout(() => {
        if (child.exitCode == null) {
          killProcessGroup(child, "SIGKILL");
        }
        if (exitCode != null) process.exit(exitCode);
      }, 2500).unref();
    } else if (exitCode != null) {
      process.exit(exitCode);
    }
  }

  process.on("SIGINT", () => {
    cleanupChild("SIGINT", 130);
  });

  process.on("SIGTERM", () => {
    cleanupChild("SIGTERM", 143);
  });

  process.on("SIGHUP", () => {
    cleanupChild("SIGHUP", 129);
  });

  if (process.stdin?.isTTY) {
    process.stdin.on("close", () => {
      cleanupChild("stdin_close", 0);
    });
  }

  process.on("exit", () => {
    if (child.exitCode == null) killProcessGroup(child, "SIGTERM");
  });

  const streamBuffers = {
    stdout: "",
    stderr: "",
  };

  function handleStreamLine(source, line) {
    const payload = extractEventPayload(line, options.eventType);
    if (payload) {
      const messageId = getMessageId(payload);
      if (messageId) {
        if (seenMessageIds.has(messageId)) return;
        seenMessageIds.add(messageId);
      }
      handleIncomingEvent(payload, kb, retriever, options).catch((error) => {
        console.error(`[chat-event] handler failed: ${error.message}`);
      });
      return;
    }

    const trimmed = String(line || "").trim();
    if (trimmed) {
      console.log(`[chat-event][${source}] ${trimmed}`);
    }
  }

  function attachLineReader(stream, source) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      streamBuffers[source] += chunk;
      let idx = streamBuffers[source].indexOf("\n");
      while (idx >= 0) {
        const line = streamBuffers[source].slice(0, idx);
        streamBuffers[source] = streamBuffers[source].slice(idx + 1);
        handleStreamLine(source, line);
        idx = streamBuffers[source].indexOf("\n");
      }
    });
  }

  attachLineReader(child.stdout, "stdout");
  attachLineReader(child.stderr, "stderr");

  child.on("error", (error) => {
    console.error(`[chat-event] failed to start subscriber: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    cleanupStarted = true;
    console.error(`[chat-event] subscription exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    process.exit(code ?? requestedExitCode ?? exitCodeFromSignal(signal));
  });
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
