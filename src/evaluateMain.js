import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProjectEnv } from "./bootstrap/loadEnv.js";
import { readJsonLines } from "./core/io.js";
import { loadKnowledge } from "./core/knowledge/loadKnowledge.js";
import { buildKnowledgeRetriever } from "./core/knowledge/retriever.js";
import { processKnowledgeEvent } from "./app/processKnowledgeEvent.js";

loadProjectEnv();

function defaultComposeMode() {
  return process.env.LARK_FORCE_LLM_COMPOSE === "1" ? "llm" : process.env.LARK_COMPOSE_MODE || "template";
}


function parseArgs(argv) {
  const args = {
    source: "examples/eval-cli-cases.jsonl",
    knowledgeSource: "local",
    knowledge: "knowledge/lark-cli-errors.json",
    retrieverSourcesFile: process.env.LARK_RETRIEVER_SOURCES_FILE || "knowledge/lark-cloud-knowledge.json",
    output: "tmp/evaluation-results.json",
    markdown: "tmp/evaluation-report.md",
    composeMode: defaultComposeMode(),
    liveHelp: false,
    larkCliTimeoutMs: 30000,
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "",
    llmTimeoutMs: 45000,
    llmTemperature: 0.2,
    showTop3: false,
    summaryTable: false,
    quiet: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--source" && value) args.source = argv[++i];
    else if (key === "--knowledge" && value) args.knowledge = argv[++i];
    else if (key === "--knowledge-source" && value) args.knowledgeSource = argv[++i];
    else if (key === "--retriever-sources-file" && value) args.retrieverSourcesFile = argv[++i];
    else if (key === "--output" && value) args.output = argv[++i];
    else if (key === "--markdown" && value) args.markdown = argv[++i];
    else if (key === "--compose-mode" && value) args.composeMode = argv[++i];
    else if (key === "--force-llm-compose") args.composeMode = "llm";
    else if (key === "--no-compose") args.composeMode = "off";
    else if (key === "--live-help") args.liveHelp = true;
    else if (key === "--no-live-help") args.liveHelp = false;
    else if (key === "--lark-cli-timeout-ms" && value) args.larkCliTimeoutMs = Number(argv[++i]);
    else if (key === "--llm-api-key" && value) args.llmApiKey = argv[++i];
    else if (key === "--llm-base-url" && value) args.llmBaseUrl = argv[++i];
    else if (key === "--llm-model" && value) args.llmModel = argv[++i];
    else if (key === "--llm-timeout-ms" && value) args.llmTimeoutMs = Number(argv[++i]);
    else if (key === "--llm-temperature" && value) args.llmTemperature = Number(argv[++i]);
    else if (key === "--show-top3") args.showTop3 = true;
    else if (key === "--summary-table") args.summaryTable = true;
    else if (key === "--quiet") args.quiet = true;
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv);
  const [cases, kb] = await Promise.all([readJsonLines(options.source), loadKnowledge(options)]);
  const retriever = await buildKnowledgeRetriever(options, kb);
  const startedAt = Date.now();
  const records = [];

  console.log(`[eval] cases: ${cases.length}`);
  console.log(`[eval] knowledge rules: ${kb.items.length}`);
  console.log(`[eval] retriever chunks: ${retriever.meta.chunkCount}`);

  for (const testCase of cases) {
    const start = Date.now();
    const result = await processKnowledgeEvent({
      event: testCase,
      kb,
      retriever,
      options: {
        ...options,
        pushLarkCard: false,
        pushChatId: "",
      },
      noMatchMode: "silent",
      renderTerminal: false,
      outcomeSummary: "Evaluation run; no external action executed.",
    });

    const record = evaluateCase(testCase, result, Date.now() - start);
    records.push(record);
    if (!options.quiet || !record.pass) {
      console.log(`[eval] ${record.pass ? "PASS" : "FAIL"} ${record.id} ${record.summary}`);
    }
    if (options.showTop3) printTop3(record);
  }

  const report = buildReport({ options, cases, records, kb, retriever, durationMs: Date.now() - startedAt });
  await writeJson(options.output, report);
  await writeText(options.markdown, renderMarkdownReport(report));

  if (options.summaryTable) printSummaryTable(report);

  console.log("");
  console.log("[eval] summary");
  console.log(`- pass: ${report.summary.passed}/${report.summary.total}`);
  console.log(`- matchKindAccuracy: ${formatRate(report.metrics.matchKindAccuracy)}`);
  console.log(`- routeSkillHitRate: ${formatRate(report.metrics.routeSkillHitRate)}`);
  console.log(`- sourceHitRate: ${formatRate(report.metrics.sourceHitRate)}`);
  console.log(`- composeModeAccuracy: ${formatRate(report.metrics.composeModeAccuracy)}`);
  console.log(`- report: ${options.markdown}`);
  console.log(`- json: ${options.output}`);
}

function evaluateCase(testCase, result, durationMs) {
  const picked = result.picked || null;
  const decision = result.decision || null;
  const retrievalResults = picked?._retrieval?.results || [];
  const routeSkills = unique([
    ...(decision?.guidance?.routeToSkills || []),
    ...(picked?.route_to_skills || []),
    ...retrievalResults.map((item) => item.metadata?.skillName).filter(Boolean),
  ]);
  const sources = unique([
    picked?.source,
    ...retrievalResults.map((item) => item.source),
  ].filter(Boolean));
  const matchKind = !result.matched ? "no_match" : picked?._retrieval ? "retrieval" : "rule";

  const checks = [];
  checks.push(check("matched", result.matched, true));
  if (testCase.expected_match_kind) checks.push(check("match_kind", matchKind, testCase.expected_match_kind));
  if (testCase.expected_rule_id) checks.push(check("rule_id", picked?.id || "", testCase.expected_rule_id));
  if (testCase.expected_category) checks.push(check("category", decision?.match?.category || "", testCase.expected_category));
  if (testCase.expected_trigger_mode) checks.push(check("trigger_mode", decision?.trigger?.mode || testCase.trigger_mode || "", testCase.expected_trigger_mode));
  if (testCase.expected_compose_mode) checks.push(check("compose_mode", decision?.composition?.mode || "", testCase.expected_compose_mode));
  if (Array.isArray(testCase.expected_skills) && testCase.expected_skills.length) {
    checks.push(checkAny("route_skill", routeSkills, testCase.expected_skills));
  }
  if (Array.isArray(testCase.expected_source_contains) && testCase.expected_source_contains.length) {
    checks.push(checkSourceContains("source", sources, testCase.expected_source_contains));
  }

  const failed = checks.filter((item) => !item.pass);
  return {
    id: testCase.id || "",
    group: testCase.group || "default",
    text: testCase.text,
    durationMs,
    pass: failed.length === 0,
    summary: failed.length ? failed.map((item) => `${item.name}: expected ${item.expected}, actual ${item.actual}`).join("; ") : "all checks passed",
    actual: {
      matched: Boolean(result.matched),
      matchKind,
      ruleId: picked?.id || "",
      category: decision?.match?.category || "",
      triggerMode: decision?.trigger?.mode || testCase.trigger_mode || "",
      routeSkills,
      topSources: sources.slice(0, 5),
      topRetrieval: retrievalResults.slice(0, 3).map((item) => ({
        title: item.title,
        source: item.source,
        score: item.score,
        skillName: item.metadata?.skillName || "",
      })),
      composeMode: decision?.composition?.mode || "",
      composeModel: decision?.composition?.model || decision?.composition?.llmAttempt?.model || "",
      diagnosis: decision?.guidance?.diagnosis || "",
      pushStatus: result.pushResult?.status || "",
    },
    expected: {
      matchKind: testCase.expected_match_kind || "",
      ruleId: testCase.expected_rule_id || "",
      category: testCase.expected_category || "",
      triggerMode: testCase.expected_trigger_mode || "",
      skills: testCase.expected_skills || [],
      sourceContains: testCase.expected_source_contains || [],
      composeMode: testCase.expected_compose_mode || "",
    },
    checks,
  };
}

function check(name, actual, expected) {
  return { name, actual, expected, pass: actual === expected };
}

function checkAny(name, actualValues, expectedValues) {
  const actual = actualValues.join(", ");
  const pass = expectedValues.some((expected) => actualValues.includes(expected));
  return { name, actual, expected: expectedValues.join(" OR "), pass };
}

function checkSourceContains(name, sources, expectedSubstrings) {
  const actual = sources.join(" | ");
  const pass = expectedSubstrings.every((expected) => sources.some((source) => String(source).includes(expected)));
  return { name, actual, expected: expectedSubstrings.join(" AND "), pass };
}

function buildReport({ options, cases, records, kb, retriever, durationMs }) {
  const total = records.length;
  const passed = records.filter((item) => item.pass).length;
  const grouped = groupRecords(records);
  const matchKindChecks = records.flatMap((item) => item.checks.filter((checkItem) => checkItem.name === "match_kind"));
  const routeSkillChecks = records.flatMap((item) => item.checks.filter((checkItem) => checkItem.name === "route_skill"));
  const sourceChecks = records.flatMap((item) => item.checks.filter((checkItem) => checkItem.name === "source"));
  const ruleChecks = records.flatMap((item) => item.checks.filter((checkItem) => checkItem.name === "rule_id"));
  const composeModeChecks = records.flatMap((item) => item.checks.filter((checkItem) => checkItem.name === "compose_mode"));

  return {
    generatedAt: new Date().toISOString(),
    options: {
      source: options.source,
      composeMode: options.composeMode,
      liveHelp: options.liveHelp,
      retrieverSourcesFile: options.retrieverSourcesFile,
      showTop3: Boolean(options.showTop3),
    },
    inventory: {
      cases: cases.length,
      knowledgeRules: kb.items.length,
      retrieverChunks: retriever.meta.chunkCount,
    },
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: rate(passed, total),
      durationMs,
    },
    metrics: {
      matchKindAccuracy: rate(countPass(matchKindChecks), matchKindChecks.length),
      ruleHitAccuracy: rate(countPass(ruleChecks), ruleChecks.length),
      routeSkillHitRate: rate(countPass(routeSkillChecks), routeSkillChecks.length),
      sourceHitRate: rate(countPass(sourceChecks), sourceChecks.length),
      composeModeAccuracy: rate(countPass(composeModeChecks), composeModeChecks.length),
      averageLatencyMs: Math.round(records.reduce((sum, item) => sum + item.durationMs, 0) / Math.max(records.length, 1)),
    },
    groups: grouped,
    records,
  };
}

function groupRecords(records) {
  const groups = {};
  for (const record of records) {
    const group = record.group || "default";
    if (!groups[group]) groups[group] = { total: 0, passed: 0, failed: 0, passRate: 0 };
    groups[group].total += 1;
    if (record.pass) groups[group].passed += 1;
    else groups[group].failed += 1;
  }
  for (const group of Object.values(groups)) {
    group.passRate = rate(group.passed, group.total);
  }
  return groups;
}

function renderMarkdownReport(report) {
  const failures = report.records.filter((item) => !item.pass);
  const lines = [
    "# Evaluation Report",
    "",
    "This report is generated by `npm run eval`.",
    "",
    "## Summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Cases: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Pass rate: ${formatRate(report.summary.passRate)}`,
    `- Average latency: ${report.metrics.averageLatencyMs} ms`,
    `- Retriever chunks: ${report.inventory.retrieverChunks}`,
    "",
    "## Metrics",
    "",
    `- Match kind accuracy: ${formatRate(report.metrics.matchKindAccuracy)}`,
    `- Rule hit accuracy: ${formatRate(report.metrics.ruleHitAccuracy)}`,
    `- Route skill hit rate: ${formatRate(report.metrics.routeSkillHitRate)}`,
    `- Source hit rate: ${formatRate(report.metrics.sourceHitRate)}`,
    `- Compose mode accuracy: ${formatRate(report.metrics.composeModeAccuracy)}`,
    "",
    "## Groups",
    "",
    "| Group | Passed | Total | Pass Rate |",
    "|---|---:|---:|---:|",
    ...Object.entries(report.groups).map(([name, group]) => `| ${name} | ${group.passed} | ${group.total} | ${formatRate(group.passRate)} |`),
    "",
    "## Failures",
    "",
  ];

  if (!failures.length) {
    lines.push("No failures.");
  } else {
    for (const item of failures) {
      lines.push(`- ${item.id}: ${item.summary}`);
    }
  }

  lines.push("", "## Case Details", "");
  for (const item of report.records) {
    lines.push(`- ${item.pass ? "PASS" : "FAIL"} ${item.id}: ${item.actual.matchKind}, ${item.actual.ruleId || item.actual.category || "no-rule"}, compose=${item.actual.composeMode || "n/a"}`);
    if (report.options.showTop3 && item.actual.topRetrieval.length) {
      for (const [index, hit] of item.actual.topRetrieval.entries()) {
        lines.push(`  - Top${index + 1}: ${hit.title} | ${hit.skillName || "unknown"} | score=${formatScore(hit.score)} | ${hit.source}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
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

function countPass(checks) {
  return checks.filter((item) => item.pass).length;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function formatRate(value) {
  if (value == null) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function printTop3(record) {
  if (!record.actual.topRetrieval.length) {
    console.log("[eval][top3] no retrieval evidence");
    return;
  }

  for (const [index, hit] of record.actual.topRetrieval.entries()) {
    console.log(
      `[eval][top${index + 1}] ${record.id} ${hit.title} | skill=${hit.skillName || "unknown"} | score=${formatScore(hit.score)} | source=${hit.source}`,
    );
  }
}

function printSummaryTable(report) {
  const rows = report.records.map((record) => {
    const top1 = record.actual.topRetrieval[0] || null;
    const expected = record.expected.ruleId || record.expected.skills?.join(", ") || record.expected.matchKind || "";
    return {
      result: record.pass ? "PASS" : "FAIL",
      caseId: record.id,
      group: record.group,
      match: record.actual.matchKind,
      expected,
      signal: record.actual.matchKind === "retrieval" ? top1?.title || record.actual.category : record.actual.ruleId || record.actual.category || "no-rule",
      skill: top1?.skillName || record.actual.routeSkills?.[0] || "",
      source: compactSource(top1?.source || record.actual.topSources?.[0] || ""),
      compose: record.actual.composeMode || "n/a",
      latency: `${record.durationMs}ms`,
    };
  });

  console.log("");
  console.log(`[eval] case summary table: ${report.options.source}`);
  printTable(
    [
      ["Result", "Case", "Group", "Match", "Expected", "Rule / Top1 Evidence", "Hit Skill", "Source", "Compose", "Time"],
      ...rows.map((row) => [
        row.result,
        row.caseId,
        row.group,
        row.match,
        row.expected,
        row.signal,
        row.skill,
        row.source,
        row.compose,
        row.latency,
      ]),
    ],
    {
      maxWidths: [6, 30, 18, 9, 24, 34, 16, 26, 10, 8],
    },
  );
}

function printTable(rows, { maxWidths = [] } = {}) {
  const normalized = rows.map((row) => row.map((cell, index) => truncateCell(cell, maxWidths[index] || 24)));
  const widths = normalized[0].map((_, columnIndex) => {
    return Math.max(...normalized.map((row) => displayWidth(row[columnIndex])));
  });
  const separator = `+-${widths.map((width) => "-".repeat(width)).join("-+-")}-+`;

  console.log(separator);
  normalized.forEach((row, rowIndex) => {
    console.log(`| ${row.map((cell, index) => padRight(cell, widths[index])).join(" | ")} |`);
    if (rowIndex === 0) console.log(separator);
  });
  console.log(separator);
}

function truncateCell(value, maxWidth) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (displayWidth(text) <= maxWidth) return text;

  let output = "";
  for (const char of text) {
    if (displayWidth(`${output}${char}...`) > maxWidth) break;
    output += char;
  }
  return `${output}...`;
}

function padRight(value, width) {
  const text = String(value ?? "");
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

function displayWidth(value) {
  let width = 0;
  for (const char of String(value ?? "")) {
    width += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char) ? 2 : 1;
  }
  return width;
}

function compactSource(source) {
  const text = String(source || "");
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return `${url.hostname}${url.pathname.split("/").slice(0, 3).join("/")}`;
    } catch {
      return text;
    }
  }
  return text.replace(/\\/g, "/").replace(/^.*?(knowledge\/skills\/|skills\/)/, "$1");
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(4);
}

main().catch((error) => {
  console.error("[fatal]", error.message);
  process.exit(1);
});
