import { runDemo } from "./app/runDemo.js";

function parseArgs(argv) {
  const args = {
    source: "examples/lark-cli-error-samples.jsonl",
    knowledgeSource: "local",
    knowledge: "knowledge/lark-cli-errors.json",
    docs: [],
    larkCliTimeoutMs: 30000,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--source" && value) args.source = argv[++i];
    else if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
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
