import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export async function evaluatePushPolicy({ decision, options, context }) {
  const level = options.pushLevel || "high_only";
  const severity = decision?.match?.severity || "info";
  const riskLevel = decision?.policy?.riskLevel || "unknown";
  const eventText = context || "";
  const matchedSignal = decision?.match?.matchedSignal || "-";
  const ruleId = decision?.match?.ruleId || "unknown";
  const chatId = options.pushChatId || "";
  const key = buildDedupeKey({ ruleId, matchedSignal, chatId, eventText, level });
  const dedupeFile = resolve(options.pushDedupeFile || "tmp/push-dedupe-state.json");
  const dedupeTtlMs = Number(options.pushDedupeTtlMs || DEFAULT_TTL_MS);

  if (!isAllowedByLevel({ level, severity, riskLevel })) {
    return {
      shouldSend: false,
      policyStatus: "policy_blocked",
      summary: `当前推送级别 ${level} 不允许该事件推群（severity=${severity}, risk=${riskLevel}）。`,
      dedupe: { key, ttlMs: dedupeTtlMs, file: dedupeFile },
    };
  }

  const dedupeState = await loadDedupeState(dedupeFile);
  const now = Date.now();
  cleanupExpired(dedupeState, now);
  const previous = dedupeState[key];

  if (previous && now - previous.sentAt < dedupeTtlMs) {
    const remainingMs = dedupeTtlMs - (now - previous.sentAt);
    return {
      shouldSend: false,
      policyStatus: "deduped",
      summary: `命中去重窗口，${Math.ceil(remainingMs / 1000)} 秒后才会再次推送。`,
      dedupe: { key, ttlMs: dedupeTtlMs, file: dedupeFile, previous },
    };
  }

  dedupeState[key] = {
    sentAt: now,
    ruleId,
    matchedSignal,
    severity,
    riskLevel,
    chatId,
  };
  await persistDedupeState(dedupeFile, dedupeState);

  return {
    shouldSend: true,
    policyStatus: "allowed",
    summary: `符合推送策略 ${level}，且未命中去重窗口。`,
    dedupe: { key, ttlMs: dedupeTtlMs, file: dedupeFile },
  };
}

function isAllowedByLevel({ level, severity, riskLevel }) {
  if (level === "all") return true;
  if (level === "none") return false;
  if (level === "high_only") {
    return severity === "error" || riskLevel === "high";
  }
  if (level === "warning_and_above") {
    return ["error", "warning"].includes(severity) || ["high", "medium"].includes(riskLevel);
  }
  return severity === "error" || riskLevel === "high";
}

function buildDedupeKey({ ruleId, matchedSignal, chatId, eventText, level }) {
  const base = `${chatId}::${level}::${ruleId}::${matchedSignal}::${eventText.trim()}`;
  return createHash("sha1").update(base).digest("hex");
}

async function loadDedupeState(file) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function cleanupExpired(state, now) {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  for (const [key, value] of Object.entries(state)) {
    if (!value?.sentAt || now - value.sentAt > maxAgeMs) {
      delete state[key];
    }
  }
}

async function persistDedupeState(file, state) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
