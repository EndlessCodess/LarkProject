import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProjectEnv } from "./bootstrap/loadEnv.js";

loadProjectEnv();

function parseArgs(argv) {
  const args = {
    showTop3: false,
    skipLlm: false,
    summaryTable: true,
    llmTimeoutMs: 90000,
    output: "tmp/evaluation-suite-results.json",
    markdown: "tmp/evaluation-suite-report.md",
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--show-top3") args.showTop3 = true;
    else if (key === "--skip-llm") args.skipLlm = true;
    else if (key === "--no-summary-table") args.summaryTable = false;
    else if (key === "--llm-timeout-ms" && value) args.llmTimeoutMs = Number(argv[++i]);
    else if (key === "--output" && value) args.output = argv[++i];
    else if (key === "--markdown" && value) args.markdown = argv[++i];
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv);
  const suites = buildSuites(options);
  const startedAt = Date.now();
  const results = [];

  console.log("[eval:all] running evaluation suite");
  console.log(`[eval:all] suites: ${suites.map((suite) => suite.id).join(", ")}`);
  if (options.showTop3) console.log("[eval:all] Top3 retrieval debug enabled");

  for (const suite of suites) {
    console.log(`\n[eval:all] START ${suite.id}: ${suite.name}`);
    const started = Date.now();
    const code = await runNode(suite.args);
    const report = await readJsonIfExists(suite.output);
    const result = {
      id: suite.id,
      name: suite.name,
      command: ["node", ...suite.args].join(" "),
      output: suite.output,
      markdown: suite.markdown,
      exitCode: code,
      durationMs: Date.now() - started,
      ok: code === 0 && report?.summary?.failed === 0,
      summary: report?.summary || null,
      metrics: report?.metrics || null,
    };
    results.push(result);
    console.log(`[eval:all] ${result.ok ? "PASS" : "FAIL"} ${suite.id}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    totalSuites: results.length,
    passedSuites: results.filter((item) => item.ok).length,
    failedSuites: results.filter((item) => !item.ok).length,
    showTop3: options.showTop3,
    results,
  };

  await writeJson(options.output, payload);
  await writeText(options.markdown, renderMarkdown(payload));

  console.log("\n[eval:all] summary");
  console.log(`- pass: ${payload.passedSuites}/${payload.totalSuites}`);
  console.log(`- report: ${options.markdown}`);
  console.log(`- json: ${options.output}`);

  if (payload.failedSuites > 0) process.exit(1);
}

function buildSuites(options) {
  const debugArgs = [
    "--quiet",
    ...(options.summaryTable ? ["--summary-table"] : []),
    ...(options.showTop3 ? ["--show-top3"] : []),
  ];
  const suites = [
    {
      id: "regression",
      name: "小回归集",
      output: "tmp/evaluation-results.json",
      markdown: "tmp/evaluation-report.md",
      args: [
        "src/evaluateMain.js",
        "--output",
        "tmp/evaluation-results.json",
        "--markdown",
        "tmp/evaluation-report.md",
        ...debugArgs,
      ],
    },
    {
      id: "quality",
      name: "30 条 Agent 质量评测集",
      output: "tmp/evaluation-quality-results.json",
      markdown: "tmp/evaluation-quality-report.md",
      args: [
        "src/evaluateMain.js",
        "--source",
        "examples/evaluation/agent-quality-cases.jsonl",
        "--output",
        "tmp/evaluation-quality-results.json",
        "--markdown",
        "tmp/evaluation-quality-report.md",
        ...debugArgs,
      ],
    },
  ];

  if (!options.skipLlm) {
    suites.push({
      id: "llm",
      name: "10 条 LLM Composer 复杂评测集",
      output: "tmp/evaluation-llm-results.json",
      markdown: "tmp/evaluation-llm-report.md",
      args: [
        "src/evaluateMain.js",
        "--source",
        "examples/evaluation/llm-composer-cases.jsonl",
        "--compose-mode",
        "llm",
        "--llm-timeout-ms",
        String(options.llmTimeoutMs),
        "--output",
        "tmp/evaluation-llm-results.json",
        "--markdown",
        "tmp/evaluation-llm-report.md",
        ...debugArgs,
      ],
    });
  }

  return suites;
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      console.error(`[eval:all][fatal] ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, payload) {
  const outputPath = resolve(filePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  const outputPath = resolve(filePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, "utf8");
}

function renderMarkdown(payload) {
  const lines = [
    "# Evaluation Suite Report",
    "",
    `- Generated at: ${payload.generatedAt}`,
    `- Suites: ${payload.totalSuites}`,
    `- Passed suites: ${payload.passedSuites}`,
    `- Failed suites: ${payload.failedSuites}`,
    `- Top3 debug: ${payload.showTop3 ? "enabled" : "disabled"}`,
    "",
    "| Suite | Result | Cases | Passed | Failed | Match Kind | Route Skill | Source | Compose | Report |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const result of payload.results) {
    lines.push(
      [
        result.id,
        result.ok ? "PASS" : "FAIL",
        result.summary?.total ?? "",
        result.summary?.passed ?? "",
        result.summary?.failed ?? "",
        formatRate(result.metrics?.matchKindAccuracy),
        formatRate(result.metrics?.routeSkillHitRate),
        formatRate(result.metrics?.sourceHitRate),
        formatRate(result.metrics?.composeModeAccuracy),
        result.markdown,
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  lines.push("## Reports");
  lines.push("");
  for (const result of payload.results) {
    lines.push(`- ${result.id}: ${result.markdown}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatRate(value) {
  if (value == null) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

main().catch((error) => {
  console.error("[eval:all][fatal]", error.message);
  process.exit(1);
});
