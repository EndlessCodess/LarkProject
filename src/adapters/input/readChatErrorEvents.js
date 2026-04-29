import { runLarkCli } from "../lark-cli/runner.js";

export async function readChatErrorEvents(options = {}) {
  const chatId = options.sourceChatId;
  if (!chatId) return [];

  const as = options.sourceChatAs || "bot";
  const limit = Math.max(1, Math.min(Number(options.sourceChatLimit || 20), 50));
  const args = [
    "im",
    "+chat-messages-list",
    "--chat-id",
    chatId,
    "--as",
    as,
    "--limit",
    String(limit),
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
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data?.items) ? payload.data.items : [];

  return items
    .map(normalizeMessageToEvent)
    .filter(Boolean)
    .filter((event) => looksLikeCliError(event.text));
}

function normalizeMessageToEvent(item) {
  const text = extractMessageText(item);
  if (!text) return null;

  return {
    type: "cli_error",
    text,
    source: "lark_chat_poll",
    message_id: item?.message_id || item?.messageId || "",
    chat_id: item?.chat_id || item?.chatId || "",
    create_time: item?.create_time || item?.createTime || "",
  };
}

function extractMessageText(item) {
  if (typeof item?.text === "string" && item.text.trim()) return item.text.trim();
  if (typeof item?.body === "string" && item.body.trim()) return item.body.trim();
  if (typeof item?.content === "string") {
    const parsed = safeParseJson(item.content);
    if (typeof parsed?.text === "string" && parsed.text.trim()) return parsed.text.trim();
    if (typeof parsed?.content === "string" && parsed.content.trim()) return parsed.content.trim();
    return item.content.trim();
  }
  return "";
}

function looksLikeCliError(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return (
    normalized.includes("lark-cli") &&
    (normalized.includes("failed") ||
      normalized.includes("error") ||
      normalized.includes("permission denied") ||
      normalized.includes("unknown flag") ||
      normalized.includes("unknown service") ||
      normalized.includes("scope") ||
      normalized.includes("invalid"))
  );
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
