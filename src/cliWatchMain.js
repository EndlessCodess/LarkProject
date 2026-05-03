import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadKnowledge } from "./core/knowledge/loadKnowledge.js";
import { buildKnowledgeRetriever } from "./core/knowledge/retriever.js";
import { processKnowledgeEvent } from "./app/processKnowledgeEvent.js";

function parseArgs(argv) {
  const args = {
    knowledgeSource: "local",
    knowledge: "knowledge/lark-cli-errors.json",
    larkCliTimeoutMs: 30000,
    commandTimeoutMs: 120000,
    debugLarkCli: false,
    autoReadonly: false,
    pushLarkCard: false,
    pushChatId: "",
    pushAs: "bot",
    pushLevel: "high_only",
    pushDedupeTtlMs: 600000,
    pushDedupeFile: "tmp/push-dedupe-state.json",
    pushBypassPolicy: false,
    pushBypassDedupe: false,
    command: "",
    cwd: process.cwd(),
    shell: process.env.SHELL || "/bin/bash",
    triggerAll: false,
    triggerOnSuccess: true,
    preserveExitCode: false,
    stderrTailLines: 80,
    stdoutTailLines: 30,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--") {
      args.command = argv.slice(i + 1).join(" ");
      break;
    } else if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
    else if (key === "--lark-cli-timeout-ms" && value) args.larkCliTimeoutMs = Number(argv[++i]);
    else if (key === "--command-timeout-ms" && value) args.commandTimeoutMs = Number(argv[++i]);
    else if (key === "--debug-lark-cli") args.debugLarkCli = true;
    else if (key === "--auto-readonly") args.autoReadonly = true;
    else if (key === "--push-lark-card") args.pushLarkCard = true;
    else if (key === "--push-chat-id" && value) args.pushChatId = argv[++i];
    else if (key === "--push-as" && value) args.pushAs = argv[++i];
    else if (key === "--push-level" && value) args.pushLevel = argv[++i];
    else if (key === "--push-dedupe-ttl-ms" && value) args.pushDedupeTtlMs = Number(argv[++i]);
    else if (key === "--push-dedupe-file" && value) args.pushDedupeFile = argv[++i];
    else if (key === "--push-bypass-policy") args.pushBypassPolicy = true;
    else if (key === "--push-bypass-dedupe") args.pushBypassDedupe = true;
    else if (key === "--command" && value) args.command = argv[++i];
    else if (key === "--cwd" && value) args.cwd = argv[++i];
    else if (key === "--shell" && value) args.shell = argv[++i];
    else if (key === "--trigger-all") args.triggerAll = true;
    else if (key === "--trigger-on-success") args.triggerOnSuccess = true;
    else if (key === "--no-trigger-on-success") args.triggerOnSuccess = false;
    else if (key === "--preserve-exit-code") args.preserveExitCode = true;
    else if (key === "--stderr-tail-lines" && value) args.stderrTailLines = Number(argv[++i]);
    else if (key === "--stdout-tail-lines" && value) args.stdoutTailLines = Number(argv[++i]);
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv);
  const kb = await loadKnowledge(options);
  const retriever = await buildKnowledgeRetriever(options, kb);

  console.log(`[cli-watch] knowledge rules: ${kb.items.length}`);
  console.log(`[cli-watch] retriever chunks: ${retriever.meta.chunkCount}`);

  if (options.command) {
    const result = await runCommandAndMaybeAnalyze(options.command, { kb, retriever, options });
    process.exit(options.preserveExitCode ? result.exitCode : 0);
  }

  await runInteractiveShell({ kb, retriever, options });
}

async function runInteractiveShell({ kb, retriever, options }) {
  console.log("[cli-watch] Agent shell started. Type a command, or type exit to quit.");
  console.log("[cli-watch] lark-cli commands with failures or watched patterns will trigger knowledge cards.\n");

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const command = (await rl.question("agent-shell$ ")).trim();
      if (!command) continue;
      if (command === "exit" || command === "quit") break;
      await runCommandAndMaybeAnalyze(command, { kb, retriever, options });
    }
  } finally {
    rl.close();
  }
}

async function runCommandAndMaybeAnalyze(command, { kb, retriever, options }) {
  console.log(`[cli-watch] run: ${command}`);
  const execution = await runShellCommand(command, options);
  const shouldAnalyze = shouldAnalyzeCommand({ command, execution, options });

  if (!shouldAnalyze) {
    console.log(`[cli-watch] skip: command is not a lark-cli knowledge signal (exit=${execution.exitCode}).`);
    return execution;
  }

  const event = buildCliEvent({ command, execution, options });
  console.log(`[cli-watch] candidate: exit=${execution.exitCode} ${command.slice(0, 120)}`);
  const result = await processKnowledgeEvent({
    event,
    kb,
    retriever,
    options,
    outcomeSummary: "来自 CLI 终端监听，已完成主动知识卡触发。",
  });

  if (result.matched && result.picked?._retrieval) {
    console.log(`[cli-watch] retrieved ${result.picked._retrieval.results.length} knowledge chunk(s)`);
  }

  if (result.pushResult) {
    console.log(`[cli-watch] push -> ${result.pushResult.status}: ${result.pushResult.summary}`);
  }

  return execution;
}

function runShellCommand(command, options) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      shell: options.shell || true,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    const timeoutMs = Math.max(1000, Number(options.commandTimeoutMs || 120000));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: 127,
        signal: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: stdoutChunks.join(""),
        stderr: [stderrChunks.join(""), error.message].filter(Boolean).join("\n"),
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? 124 : (code ?? 1),
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
    });
  });
}

function shouldAnalyzeCommand({ command, execution, options }) {
  const combined = [command, execution.stderr, execution.stdout].join("\n").toLowerCase();
  const hasCliMention = combined.includes("lark-cli") || combined.includes("飞书 cli") || combined.includes("飞书cli");
  if (!hasCliMention) return false;
  if (options.triggerAll) return true;
  if (execution.exitCode !== 0) return true;
  if (hasStrongSignal(combined)) return true;
  return Boolean(options.triggerOnSuccess && hasWatchedSuccessPattern(command));
}

function hasStrongSignal(text) {
  return [
    "unknown flag",
    "unknown command",
    "unknown service",
    "permission denied",
    "missing scope",
    "invalid",
    "not configured",
    "not found",
    "access denied",
    "error",
    "failed",
  ].some((signal) => text.includes(signal));
}

function hasWatchedSuccessPattern(command) {
  const normalized = String(command || "").toLowerCase();
  return [
    /lark-cli\s+auth\b/,
    /lark-cli\s+config\s+init\b/,
    /lark-cli\s+schema\b/,
    /lark-cli\s+[a-z0-9_-]+\s+--help\b/,
    /lark-cli\s+[a-z0-9_-]+\s+\+[a-z0-9_-]+\s+--help\b/,
  ].some((pattern) => pattern.test(normalized));
}

function buildCliEvent({ command, execution, options }) {
  const stderrPreview = tailLines(execution.stderr, options.stderrTailLines);
  const stdoutPreview = tailLines(execution.stdout, options.stdoutTailLines);
  const text = [
    `terminal command: ${command}`,
    `exit_code=${execution.exitCode}`,
    execution.timedOut ? "status=timeout" : "",
    stderrPreview ? `stderr:\n${stderrPreview}` : "",
    !stderrPreview && stdoutPreview ? `stdout:\n${stdoutPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    type: "cli_command",
    trigger_mode: "cli_watch",
    source: "cli_watch",
    text,
    command,
    exit_code: execution.exitCode,
    signal: execution.signal || "",
    cwd: options.cwd || process.cwd(),
    duration_ms: execution.durationMs,
    stderr_preview: stderrPreview,
    stdout_preview: stdoutPreview,
    create_time: new Date().toISOString(),
  };
}

function tailLines(text, maxLines) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return "";
  return lines.slice(-Math.max(1, Number(maxLines || 50))).join("\n");
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
