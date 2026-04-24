import { runDemo } from "./app/runDemo.js";

function parseArgs(argv) {
  const args = { source: "examples/events.jsonl", knowledge: "config/knowledge.example.json" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) args.source = argv[++i];
    else if (argv[i] === "--knowledge" && argv[i + 1]) args.knowledge = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
runDemo(args).catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
