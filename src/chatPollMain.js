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
    larkCliTimeoutMs: 30000,
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
    sourceChatAs: "bot",
    sourceChatLimit: 20,
    sourceStateFile: "tmp/chat-poll-state.json",
    sourceInitMode: "baseline",
    watch: false,
    intervalMs: 5000,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
    else if (key === "--lark-cli-timeout-ms" && value) args.larkCliTimeoutMs = Number(argv[++i]);
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
    else if (key === "--source-chat-as" && value) args.sourceChatAs = argv[++i];
    else if (key === "--source-chat-limit" && value) args.sourceChatLimit = Number(argv[++i]);
    else if (key === "--source-state-file" && value) args.sourceStateFile = argv[++i];
    else if (key === "--source-init-mode" && value) args.sourceInitMode = argv[++i];
    else if (key === "--watch") args.watch = true;
    else if (key === "--interval-ms" && value) args.intervalMs = Number(argv[++i]);
  }

  return args;
}

async function readChatMessages(options) {
  const args = [
    "im",
    "+chat-messages-list",
    "--chat-id",
    options.sourceChatId,
    "--as",
    options.sourceChatAs || "bot",
    "--page-size",
    String(Math.max(1, Math.min(Number(options.sourceChatLimit || 20), 50))),
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
  const messages = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data?.items)
      ? payload.data.items
      : Array.isArray(payload?.data?.messages)
        ? payload.data.messages
        : [];

  return messages;
}

async function loadChatPollState(options) {
  const stateFile = options.sourceStateFile;
  if (!stateFile) return null;
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    return safeParseJson(raw);
  } catch {
    return null;
  }
}

async function saveChatPollState(options, state) {
  const stateFile = options.sourceStateFile;
  if (!stateFile) return;
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getMessageCursor(item) {
  return String(item?.message_id || item?.messageId || "");
}

function pickLatestCursor(messages) {
  for (const item of messages) {
    const cursor = getMessageCursor(item);
    if (cursor) return cursor;
  }
  return "";
}

function filterNewMessages(messages, state, options) {
  const lastCursor = String(state?.lastMessageId || "");
  if (!lastCursor) {
    const initMode = String(options?.sourceInitMode || "baseline").toLowerCase();
    return {
      messages: initMode === "replay" ? [...messages].reverse() : [],
      latestCursor: pickLatestCursor(messages),
      baselineApplied: initMode !== "replay",
    };
  }

  const collected = [];
  for (const item of messages) {
    const cursor = getMessageCursor(item);
    if (cursor && cursor === lastCursor) break;
    collected.push(item);
  }

  return {
    messages: collected.reverse(),
    latestCursor: pickLatestCursor(messages),
    baselineApplied: false,
  };
}

function getSenderId(item) {
  return String(
    item?.sender?.sender_id?.open_id ||
    item?.sender?.id?.open_id ||
    item?.sender?.open_id ||
    item?.sender_id ||
    ""
  );
}

function isBotSelfMessage(item, options) {
  if ((options?.pushAs || "").toLowerCase() !== "bot") return false;

  const messageType = String(item?.msg_type || item?.message_type || "").toLowerCase();
  const senderType = String(item?.sender?.sender_type || item?.sender?.type || "").toLowerCase();
  const text = normalizeMessageText(item);

  if (senderType === "app" || senderType === "bot") return true;
  if (messageType === "interactive") return true;
  if (text.startsWith("<card title=\"⚠️ CLI 主动知识卡") || text.startsWith("<card title='⚠️ CLI 主动知识卡")) return true;
  return false;
}

function normalizeMessageText(item) {
  if (typeof item?.text === "string" && item.text.trim()) return item.text.trim();
  if (typeof item?.body === "string" && item.body.trim()) return item.body.trim();
  if (typeof item?.content === "string") {
    const parsed = safeParseJson(item.content);
    if (typeof parsed?.text === "string" && parsed.text.trim()) return parsed.text.trim();
    if (typeof parsed?.content === "string" && parsed.content.trim()) return parsed.content.trim();
    if (item.msg_type === "text") return item.content.trim();
    return item.content.trim();
  }
  return "";
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

function toEvent(item, options) {
  if (isBotSelfMessage(item, options)) return null;
  const text = normalizeMessageText(item);
  if (!text || !looksLikeCliError(text)) return null;
  return {
    type: "cli_error",
    text,
    source: "lark_chat_poll",
    message_id: item?.message_id || item?.messageId || "",
    chat_id: item?.chat_id || item?.chatId || "",
    create_time: item?.create_time || item?.createTime || "",
    sender_id: getSenderId(item),
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPollOnce(options) {
  const [messages, kb, state] = await Promise.all([
    readChatMessages(options),
    loadKnowledge(options),
    loadChatPollState(options),
  ]);
  const retriever = await buildKnowledgeRetriever(options, kb);
  const { messages: newMessages, latestCursor, baselineApplied } = filterNewMessages(messages, state, options);
  const selfFilteredCount = newMessages.filter((item) => isBotSelfMessage(item, options)).length;
  const events = newMessages.map((item) => toEvent(item, options)).filter(Boolean);

  console.log(`[chat-poll] fetched messages: ${messages.length}`);
  console.log(`[chat-poll] new messages: ${newMessages.length}`);
  console.log(`[chat-poll] self messages filtered: ${selfFilteredCount}`);
  console.log(`[chat-poll] candidate error events: ${events.length}`);
  if (baselineApplied) {
    console.log("[chat-poll] baseline mode: initialized cursor from latest message, skipped historical backlog.");
  }
  if (events.length) {
    console.log(`[chat-poll] first candidate: ${events[0].text.slice(0, 120)}`);
  }
  console.log(`[chat-poll] knowledge rules: ${kb.items.length}`);
  console.log(`[chat-poll] retriever chunks: ${retriever.meta.chunkCount}`);

  let matchedCount = 0;
  let sentCount = 0;

  for (const event of events) {
    const picked = pickKnowledge(event, kb.items, retriever);
    if (!picked) continue;
    matchedCount += 1;
    if (picked._retrieval) {
      console.log(`[chat-poll] ${event.message_id || "<no-message-id>"} -> retrieved ${picked._retrieval.results.length} knowledge chunk(s)`);
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
        summary: "来自测试群轮询消息，当前仅做知识卡主动触发演示。",
      },
      context: event.text,
    });

    await writeLarkCardArtifact(payload, options);
    const pushResult = await maybePushLarkCard(payload, options, decision, event.text);
    console.log(`[chat-poll] ${event.message_id || "<no-message-id>"} -> ${pushResult.status}: ${pushResult.summary}`);
    if (pushResult.status === "sent") sentCount += 1;
  }

  if (latestCursor) {
    await saveChatPollState(options, {
      chatId: options.sourceChatId,
      identity: options.sourceChatAs,
      lastMessageId: latestCursor,
      updatedAt: new Date().toISOString(),
    });
  }

  console.log(`[chat-poll] matched events: ${matchedCount}`);
  console.log(`[chat-poll] sent cards: ${sentCount}`);
}

function pickKnowledge(event, knowledgeItems, retriever) {
  const direct = matchKnowledge(event, knowledgeItems);
  if (direct) return direct;

  const retrievalResults = retrieveKnowledge(event, retriever, { topK: 5 });
  return buildRetrievedKnowledgeRule(event, retrievalResults);
}

async function main() {
  const options = parseArgs(process.argv);
  if (!options.sourceChatId) {
    throw new Error("缺少 --source-chat-id");
  }

  if (!options.watch) {
    await runPollOnce(options);
    return;
  }

  const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
  console.log(`[chat-poll] watch mode started. interval=${intervalMs}ms`);

  while (true) {
    const startedAt = new Date().toISOString();
    console.log(`[chat-poll] tick ${startedAt}`);
    try {
      await runPollOnce(options);
    } catch (error) {
      console.error(`[chat-poll] tick failed: ${error.message}`);
    }
    await sleep(intervalMs);
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  if (String(err.message || "").includes("Permission denied")) {
    console.error("[hint] 读取测试群消息优先尝试 --source-chat-as user，或为 bot 开通 IM 读消息权限并确认 bot 在群内。");
  }
  process.exit(1);
});
