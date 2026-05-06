import { loadProjectEnv } from "./bootstrap/loadEnv.js";
import { runDemo } from "./app/runDemo.js";

loadProjectEnv();

function defaultComposeMode() {
  return process.env.LARK_FORCE_LLM_COMPOSE === "1" ? "llm" : process.env.LARK_COMPOSE_MODE || "template";
}


function parseArgs(argv) {
  const args = {
    source: "examples/lark-cli-error-samples.jsonl",
    knowledgeSource: "local",
    knowledge: "knowledge/lark-cli-errors.json",
    docs: [],
    retrieverSourcesFile: "",
    retrieverDocsFile: "",
    larkCliTimeoutMs: 30000,
    autoReadonly: false,
    debugLarkCli: false,
    regressionFailuresFile: "tmp/regression-failures.json",
    qualityReportFile: "tmp/rule-quality-report.json",
    showQualityReport: true,
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
    composeMode: defaultComposeMode(),
    liveHelp: true,
    liveHelpTimeoutMs: 8000,
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    llmTimeoutMs: 20000,
    llmTemperature: 0.2,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--source" && value) args.source = argv[++i];
    else if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
    else if (key === "--retriever-sources-file" && value) args.retrieverSourcesFile = argv[++i];
    else if (key === "--retriever-docs-file" && value) args.retrieverDocsFile = argv[++i];
    else if (key === "--lark-doc" && value) {
      args.docs.push({ url: argv[++i], apiVersion: "v2", mode: "full", as: "user" });
    } else if (key === "--lark-doc-mode" && value) {
      ensureLastDoc(args).mode = argv[++i];
    } else if (key === "--lark-doc-keyword" && value) {
      ensureLastDoc(args).mode = "keyword";
      ensureLastDoc(args).keyword = argv[++i];
    } else if (key === "--lark-doc-as" && value) {
      ensureLastDoc(args).as = argv[++i];
    } else if (key === "--lark-cli-timeout-ms" && value) args.larkCliTimeoutMs = Number(argv[++i]);
    else if (key === "--auto-readonly") args.autoReadonly = true;
    else if (key === "--debug-lark-cli") args.debugLarkCli = true;
    else if (key === "--show-regression-summary") args.showRegressionSummary = true;
    else if (key === "--regression-failures-file" && value) args.regressionFailuresFile = argv[++i];
    else if (key === "--quality-report-file" && value) args.qualityReportFile = argv[++i];
    else if (key === "--no-quality-report") args.showQualityReport = false;
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
    else if (key === "--compose-mode" && value) args.composeMode = argv[++i];
    else if (key === "--force-llm-compose") args.composeMode = "llm";
    else if (key === "--no-compose") args.composeMode = "off";
    else if (key === "--live-help") args.liveHelp = true;
    else if (key === "--no-live-help") args.liveHelp = false;
    else if (key === "--live-help-timeout-ms" && value) args.liveHelpTimeoutMs = Number(argv[++i]);
    else if (key === "--llm-api-key" && value) args.llmApiKey = argv[++i];
    else if (key === "--llm-base-url" && value) args.llmBaseUrl = argv[++i];
    else if (key === "--llm-model" && value) args.llmModel = argv[++i];
    else if (key === "--llm-timeout-ms" && value) args.llmTimeoutMs = Number(argv[++i]);
    else if (key === "--llm-temperature" && value) args.llmTemperature = Number(argv[++i]);
  }

  return args;
}

function ensureLastDoc(args) {
  if (!args.docs.length) {
    args.docs.push({ apiVersion: "v2", mode: "full", as: "user" });
  }

  return args.docs[args.docs.length - 1];
}

const args = parseArgs(process.argv);
runDemo(args).catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
