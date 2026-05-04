import { spawn } from "node:child_process";
import { loadProjectEnv } from "./bootstrap/loadEnv.js";

loadProjectEnv();

function parseArgs(argv) {
  const args = {
    command: 'lark-cli wiki --unknown-flag',
    pushChatId: process.env.LARK_DEMO_PUSH_CHAT_ID || "",
    pushAs: process.env.LARK_DEMO_PUSH_AS || "bot",
    pushLevel: "all",
    llmTimeoutMs: Number(process.env.LARK_DEMO_LLM_TIMEOUT_MS || 45000),
    liveHelp: false,
    retrieverSourcesFile: process.env.LARK_RETRIEVER_SOURCES_FILE || "",
    retrieverDocsFile: process.env.LARK_RETRIEVER_DOCS_FILE || "",
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--command" && value) args.command = argv[++i];
    else if (key === "--push-chat-id" && value) args.pushChatId = argv[++i];
    else if (key === "--push-as" && value) args.pushAs = argv[++i];
    else if (key === "--push-level" && value) args.pushLevel = argv[++i];
    else if (key === "--llm-timeout-ms" && value) args.llmTimeoutMs = Number(argv[++i]);
    else if (key === "--retriever-sources-file" && value) args.retrieverSourcesFile = argv[++i];
    else if (key === "--retriever-docs-file" && value) args.retrieverDocsFile = argv[++i];
    else if (key === "--live-help") args.liveHelp = true;
    else if (key === "--no-live-help") args.liveHelp = false;
  }

  return args;
}

function main() {
  const options = parseArgs(process.argv);
  const cliWatchArgs = buildCliWatchArgs(options);

  console.log("[demo:cli-watch-llm] running end-to-end demo");
  console.log(`[demo:cli-watch-llm] command: ${options.command}`);
  if (options.pushChatId) {
    console.log(`[demo:cli-watch-llm] push chat: ${options.pushChatId} (${options.pushAs})`);
  } else {
    console.log("[demo:cli-watch-llm] push chat not configured; will render terminal card only");
  }

  const child = spawn(process.execPath, cliWatchArgs, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[fatal] ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function buildCliWatchArgs(options) {
  const args = [
    "src/cliWatchMain.js",
    "--command",
    options.command,
    "--compose-mode",
    "llm",
    "--llm-timeout-ms",
    String(Math.max(1000, Number(options.llmTimeoutMs || 45000))),
    "--push-level",
    options.pushLevel || "all",
    "--push-bypass-dedupe",
  ];

  if (options.liveHelp) args.push("--live-help");
  else args.push("--no-live-help");

  if (options.retrieverSourcesFile) {
    args.push("--retriever-sources-file", options.retrieverSourcesFile);
  }

  if (options.retrieverDocsFile) {
    args.push("--retriever-docs-file", options.retrieverDocsFile);
  }

  if (options.pushChatId) {
    args.push("--push-lark-card", "--push-chat-id", options.pushChatId, "--push-as", options.pushAs || "bot");
  }

  return args;
}

main();
