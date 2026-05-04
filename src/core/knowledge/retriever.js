import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandLarkDocsManifest, fetchLarkDocsDocuments } from "../../adapters/knowledge-source/larkDocsKnowledgeSource.js";

const DEFAULT_SKILL_NAMES = [
  "lark-shared",
  "lark-doc",
  "lark-base",
  "lark-wiki",
  "lark-sheets",
  "lark-im",
  "lark-calendar",
  "lark-drive",
  "lark-task",
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "is",
  "are",
  "a",
  "an",
  "it",
  "for",
  "with",
  "on",
  "this",
  "that",
  "as",
  "be",
  "by",
  "from",
  "我",
  "的",
  "了",
  "是",
  "在",
  "和",
  "或",
  "就",
  "要",
  "用",
  "有",
  "看",
  "帮",
]);

export async function buildKnowledgeRetriever(options = {}, knowledge = {}) {
  const chunks = await buildKnowledgeChunks(options, knowledge);
  return createRetrieverIndex(chunks);
}

export async function buildKnowledgeChunks(options = {}, knowledge = {}) {
  const [ruleChunks, projectSkillChunks, bundledLarkSkillChunks, installedLarkSkillChunks, cloudDocChunks] = await Promise.all([
    buildRuleChunks(knowledge.items || []),
    buildProjectSkillChunks(options),
    buildBundledLarkSkillChunks(options),
    buildInstalledLarkSkillChunks(options),
    buildLarkDocsChunks(options),
  ]);

  return [...ruleChunks, ...projectSkillChunks, ...bundledLarkSkillChunks, ...installedLarkSkillChunks, ...cloudDocChunks];
}

export function retrieveKnowledge(query, index, options = {}) {
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  if (!chunks.length) return [];

  const queryText = typeof query === "string" ? query : query?.text || "";
  const queryTerms = tokenize(queryText);
  if (!queryTerms.length) return [];

  const queryTermSet = new Set(queryTerms);
  const preferredSkills = inferPreferredSkills(queryText);
  const scored = [];

  for (const chunk of chunks) {
    let score = 0;
    const matchedTerms = [];

    for (const term of queryTermSet) {
      const frequency = chunk.termCounts.get(term) || 0;
      if (!frequency) continue;
      const idf = index.idf.get(term) || 1;
      const termScore = (frequency / Math.sqrt(chunk.termTotal || 1)) * idf;
      score += termScore;
      matchedTerms.push(term);
    }

    score += phraseBonus(queryText, chunk.searchText);
    score += sourceTypeBonus(chunk);
    score += skillRouteBonus(chunk, preferredSkills);

    if (score > 0) {
      scored.push({
        source_type: chunk.source_type,
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        score: Number(score.toFixed(4)),
        matched_terms: matchedTerms.sort(),
        metadata: chunk.metadata || {},
      });
    }
  }

  const topK = Number(options.topK || 5);
  const minScore = Number(options.minScore || 0.35);
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score >= minScore)
    .slice(0, Math.max(1, topK));
}

export function buildRetrievedKnowledgeRule(event, retrievalResults, options = {}) {
  const results = retrievalResults || [];
  if (!results.length) return null;

  const primary = results[0];
  const routeToSkills = unique(
    results
      .map((item) => item.metadata?.skillName)
      .filter((name) => typeof name === "string" && name.startsWith("lark-")),
  );
  const sourceList = results
    .slice(0, 3)
    .map((item) => `${item.source}${item.title ? `#${item.title}` : ""}`)
    .join("; ");
  const suggestedActions = buildSuggestedActions(results);

  return {
    id: `retrieved-${sanitizeId(primary.source)}-${sanitizeId(primary.title)}`,
    category: inferRetrievedCategory(event?.text || "", results),
    severity: inferRetrievedSeverity(event?.text || ""),
    priority: 20,
    diagnosis: `结构化规则未直接命中，已从本地知识库召回相关内容：${primary.title || primary.source}。建议结合下方来源继续确认。`,
    route_to_skills: routeToSkills,
    suggested_actions: suggestedActions,
    next_command_template: inferNextCommand(results),
    source: sourceList,
    _matchedSignal: `retriever:${primary.title || primary.source}`,
    _score: primary.score,
    _retrieval: {
      strategy: "local_lightweight_retrieval",
      reason: options.reason || "rule_miss",
      results: results.slice(0, 5),
    },
  };
}

export function createRetrieverIndex(chunks) {
  const normalizedChunks = chunks.map((chunk) => {
    const searchText = normalizeSearchText([chunk.title, chunk.content, chunk.source, chunk.metadata?.skillName].filter(Boolean).join("\n"));
    const terms = tokenize(searchText);
    return {
      ...chunk,
      searchText,
      termCounts: countTerms(terms),
      termTotal: terms.length,
    };
  });
  const docFrequency = new Map();

  for (const chunk of normalizedChunks) {
    for (const term of chunk.termCounts.keys()) {
      docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    }
  }

  const idf = new Map();
  const total = normalizedChunks.length || 1;
  for (const [term, count] of docFrequency.entries()) {
    idf.set(term, Math.log(1 + (total - count + 0.5) / (count + 0.5)) + 1);
  }

  return {
    chunks: normalizedChunks,
    idf,
    meta: {
      chunkCount: normalizedChunks.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function buildRuleChunks(items) {
  return items.map((item) => ({
    id: `rule:${item.id}`,
    source_type: "rule",
    source: item.source || "knowledge/lark-cli-errors.json",
    title: `${item.id} ${item.category || ""}`.trim(),
    content: [
      item.diagnosis,
      ...(item.when || []),
      ...(item.suggested_actions || []),
      item.next_command_template,
      ...(item.route_to_skills || []),
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      ruleId: item.id,
      category: item.category || item.type || "unknown",
      skillName: item.route_to_skills?.[0] || "",
    },
  }));
}

async function buildProjectSkillChunks(options) {
  const skillPath = options.projectSkillPath || path.resolve("skills/lark-cli-knowledge-assistant/SKILL.md");
  const raw = await safeReadFile(skillPath);
  if (!raw) return [];
  return markdownToChunks(raw, {
    source_type: "skill",
    source: relativeSource(skillPath),
    skillName: "lark-cli-knowledge-assistant",
  });
}

async function buildBundledLarkSkillChunks(options) {
  const root = options.bundledSkillRoot || path.resolve("knowledge/skills");
  const names = await listBundledSkillNames(root);
  if (!names.length) return [];

  const chunks = [];
  for (const name of names) {
    const skillRoot = path.join(root, name);
    const markdownFiles = await collectSkillMarkdownFiles(skillRoot);
    for (const filePath of markdownFiles) {
      const raw = await safeReadFile(filePath);
      if (!raw) continue;
      chunks.push(
        ...markdownToChunks(raw, {
          source_type: "skill",
          source: relativeSource(filePath),
          skillName: name,
          docKind: classifySkillDocKind(filePath, skillRoot),
        }),
      );
    }
  }

  return chunks;
}

async function buildInstalledLarkSkillChunks(options) {
  if (options.disableInstalledSkills || process.env.LARK_RETRIEVER_DISABLE_INSTALLED_SKILLS === "1") {
    return [];
  }

  const names = parseListOption(options.retrieverSkillNames || options.skillNames || DEFAULT_SKILL_NAMES.join(","));
  const roots = buildSkillRoots(options);
  const chunks = [];

  for (const name of names) {
    const bundledSkillPath = path.resolve("knowledge/skills", name, "SKILL.md");
    if (await fileExists(bundledSkillPath)) continue;
    const filePath = await findSkillFile(name, roots);
    if (!filePath) continue;
    const raw = await safeReadFile(filePath);
    if (!raw) continue;
    chunks.push(
      ...markdownToChunks(raw, {
        source_type: "skill",
        source: relativeSource(filePath),
        skillName: name,
      }),
    );
  }

  return chunks;
}

async function buildLarkDocsChunks(options) {
  const docs = await resolveRetrieverDocs(options);
  if (!docs.length) return [];

  const documents = await fetchLarkDocsDocuments({
    docs,
    timeoutMs: options.larkCliTimeoutMs,
  });

  const chunks = [];
  for (const doc of documents) {
    if (doc.source_type === "cloud_skill_file") {
      chunks.push(
        ...markdownToChunks(doc.content || "", {
          source_type: "cloud_doc",
          source: doc.url || doc.id || "cloud-skill-file",
          skillName: inferCloudSkillName(doc),
          docKind: "cloud_skill_file",
          cloudDocId: doc.id || "",
          sourceFolderUrl: doc.metadata?.sourceFolderUrl || "",
          sourceFolderToken: doc.metadata?.sourceFolderToken || "",
          path: doc.metadata?.path || "",
        }),
      );
      continue;
    }

    const title = inferCloudDocTitle(doc);
    for (const part of splitDocContent(doc.content || "", 1500)) {
      chunks.push({
        id: `cloud-doc:${sanitizeId(doc.id || doc.url || title)}:${chunks.length}`,
        source_type: "cloud_doc",
        source: doc.url || doc.id || "lark-doc",
        title,
        content: part,
        metadata: {
          skillName: "lark-doc",
          docKind: "cloud_doc",
          cloudDocId: doc.id || "",
        },
      });
    }
  }

  return chunks;
}

function markdownToChunks(raw, metadata) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const title = frontmatter.name || firstHeading(body) || metadata.skillName || metadata.source;
  const description = frontmatter.description || "";
  const sections = splitMarkdownSections(body);
  const chunks = [];

  chunks.push({
    id: `skill:${metadata.skillName}:overview`,
    source_type: metadata.source_type,
    source: metadata.source,
    title: `${title} overview`,
    content: [description, body.slice(0, 1200)].filter(Boolean).join("\n"),
    metadata: { ...metadata, section: "overview", description },
  });

  for (const section of sections) {
    for (const part of splitLongText(section.content, 1600)) {
      chunks.push({
        id: `skill:${metadata.skillName}:${sanitizeId(section.heading)}:${chunks.length}`,
        source_type: metadata.source_type,
        source: metadata.source,
        title: `${title} ${section.heading}`.trim(),
        content: part,
        metadata: { ...metadata, section: section.heading, description },
      });
    }
  }

  return chunks;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const frontmatter = {};

  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return { frontmatter, body };
}

function splitMarkdownSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let current = { heading: firstHeading(body) || "intro", content: "" };

  for (const line of lines) {
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      if (current.content.trim()) sections.push(current);
      current = { heading: heading[2].trim(), content: line };
      continue;
    }
    current.content += `${line}\n`;
  }

  if (current.content.trim()) sections.push(current);
  return sections;
}

function splitLongText(text, maxLength) {
  if (text.length <= maxLength) return [text.trim()];
  const paragraphs = text.split(/\n{2,}/);
  const parts = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current.length + paragraph.length + 2) > maxLength && current.trim()) {
      parts.push(current.trim());
      current = "";
    }
    current += `${paragraph}\n\n`;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function listBundledSkillNames(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("lark-"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function collectSkillMarkdownFiles(skillRoot) {
  const preferred = [
    path.join(skillRoot, "SKILL.md"),
  ];
  const referencesRoot = path.join(skillRoot, "references");
  const referenceFiles = await walkMarkdownFiles(referencesRoot);
  return unique([...preferred, ...referenceFiles]);
}

async function walkMarkdownFiles(root) {
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(nextPath)));
      continue;
    }
    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(nextPath);
    }
  }
  return files.sort();
}

function classifySkillDocKind(filePath, skillRoot) {
  if (path.resolve(filePath) === path.resolve(skillRoot, "SKILL.md")) return "skill_root";
  const relative = path.relative(skillRoot, filePath).replace(/\\/g, "/");
  if (relative.startsWith("references/")) return "reference";
  return "skill_extra";
}

function buildSkillRoots(options) {
  const configured = parseListOption(options.retrieverSkillRoots || process.env.LARK_SKILL_ROOTS || "");
  const home = os.homedir();
  return unique([
    ...configured,
    path.join(process.cwd(), "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".codex", "skills"),
    "/home/node/.agents/skills",
    "/home/node/.codex/skills",
    "/root/.agents/skills",
    "/root/.codex/skills",
    "C:\\Users\\k4231\\.agents\\skills",
    "C:\\Users\\k4231\\.codex\\skills",
  ]);
}

async function resolveRetrieverDocs(options) {
  if (Array.isArray(options.retrieverDocs) && options.retrieverDocs.length) {
    return options.retrieverDocs;
  }

  const candidateFiles = unique([
    options.retrieverSourcesFile,
    process.env.LARK_RETRIEVER_SOURCES_FILE,
    options.retrieverDocsFile,
    process.env.LARK_RETRIEVER_DOCS_FILE,
    path.resolve("knowledge/lark-cloud-knowledge.json"),
    path.resolve("knowledge/lark-cloud-docs.json"),
  ]);

  for (const filePath of candidateFiles) {
    const raw = await safeReadFile(filePath);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const docs = Array.isArray(parsed?.docs) ? parsed.docs : [];
      const folders = Array.isArray(parsed?.folders) ? parsed.folders : [];
      return await expandLarkDocsManifest({
        docs: docs.filter((doc) => doc && (doc.url || doc.token)),
        folders,
        timeoutMs: options.larkCliTimeoutMs,
      });
    } catch {
      continue;
    }
  }

  return [];
}

async function findSkillFile(name, roots) {
  for (const root of roots) {
    const filePath = path.join(root, name, "SKILL.md");
    if (await fileExists(filePath)) return filePath;
  }
  return null;
}

async function safeReadFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function tokenize(text) {
  const normalized = normalizeSearchText(text);
  return (normalized.match(/[a-z0-9_:+.-]+|[\u4e00-\u9fff]/g) || [])
    .map((term) => term.trim())
    .filter((term) => term.length > 1 || /[\u4e00-\u9fff]/.test(term))
    .filter((term) => !STOP_WORDS.has(term));
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, " ")
    .replace(/[(){}[\],;，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countTerms(terms) {
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  return counts;
}

function phraseBonus(queryText, searchText) {
  const query = normalizeSearchText(queryText);
  if (!query) return 0;

  let bonus = 0;
  for (const phrase of extractPhrases(query)) {
    if (phrase.length >= 4 && searchText.includes(phrase)) bonus += Math.min(2, phrase.length / 20);
  }
  return bonus;
}

function extractPhrases(text) {
  const phrases = [];
  const commandMatches = text.match(/lark-cli\s+[a-z0-9_+-]+(?:\s+[a-z0-9_+.-]+){0,3}/g) || [];
  phrases.push(...commandMatches);
  const tokenMatches = text.match(/[a-z0-9_:+.-]{4,}/g) || [];
  phrases.push(...tokenMatches.slice(0, 12));
  return unique(phrases);
}

function sourceTypeBonus(chunk) {
  if (chunk.source_type === "rule") return 0.15;
  if (chunk.source_type === "skill") return 0.08;
  if (chunk.source_type === "cloud_doc") return 0.18;
  return 0;
}

function skillRouteBonus(chunk, preferredSkills) {
  const skillName = chunk.metadata?.skillName || "";
  if (!skillName || !preferredSkills.has(skillName)) return 0;
  return 2.5;
}

function inferPreferredSkills(text) {
  const normalized = normalizeSearchText(text);
  const skills = new Set();

  if (/im|message|messages|chat|chat_id|open_id|群聊|消息|发消息|回复/.test(normalized)) skills.add("lark-im");
  if (/permission|scope|auth|--as|user|bot|权限|授权|身份/.test(normalized)) skills.add("lark-shared");
  if (/wiki|知识库|节点|space|obj_token/.test(normalized)) skills.add("lark-wiki");
  if (/base|bitable|table|record|field|多维|字段|记录|表格/.test(normalized)) skills.add("lark-base");
  if (/doc|docs|docx|文档|云文档/.test(normalized)) skills.add("lark-doc");
  if (/sheet|sheets|spreadsheet|公式|单元格|电子表格/.test(normalized)) skills.add("lark-sheets");
  if (/calendar|meeting|room|freebusy|日历|会议|会议室|日程/.test(normalized)) skills.add("lark-calendar");
  if (/drive|file|folder|upload|download|云空间|文件|文件夹|上传|下载/.test(normalized)) skills.add("lark-drive");
  if (/task|todo|待办|任务/.test(normalized)) skills.add("lark-task");

  return skills;
}

function buildSuggestedActions(results) {
  const actions = [
    "优先阅读召回来源中的相关段落，确认该问题属于哪个 lark-* Skill 或 CLI 命令族。",
    "如果涉及真实命令参数，先用对应命令的 --help 或 schema 做只读确认，再继续执行。",
  ];
  const skills = unique(results.map((item) => item.metadata?.skillName).filter(Boolean));
  if (skills.length) actions.unshift(`优先路由到 ${skills.slice(0, 3).join(", ")} 的操作规则。`);
  return actions;
}

function inferNextCommand(results) {
  for (const item of results) {
    const command = extractLarkCliCommand(item.content);
    if (command) return command.trim();
  }
  const firstSkill = results.find((item) => item.metadata?.skillName)?.metadata?.skillName;
  if (firstSkill?.startsWith("lark-")) {
    return `lark-cli ${firstSkill.replace(/^lark-/, "")} --help`;
  }
  return "lark-cli <service> --help";
}

function inferCloudDocTitle(doc) {
  const content = String(doc.content || "").trim();
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return firstHeading || firstLine.slice(0, 80) || doc.url || doc.id || "cloud-doc";
}

function inferCloudSkillName(doc) {
  const title = String(doc.title || "").trim();
  if (/^lark-[a-z0-9-]+/i.test(title)) {
    return title.replace(/\.md$/i, "");
  }
  const firstLine = String(doc.content || "").match(/^name:\s*([A-Za-z0-9_-]+)/m)?.[1];
  if (firstLine) return firstLine;
  return "lark-cloud-skill";
}

function splitDocContent(text, maxLength) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const sections = raw.split(/\n(?=#{1,3}\s)|\n---+\n/g).map((part) => part.trim()).filter(Boolean);
  if (!sections.length) return splitLongText(raw, maxLength);

  const parts = [];
  for (const section of sections) {
    parts.push(...splitLongText(section, maxLength));
  }
  return parts;
}

function extractLarkCliCommand(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("lark-cli")) continue;
    const cleaned = line.replace(/^[\s>*#-]+/, "").trim();
    const match = cleaned.match(/\b(lark-cli(?:\s+(?:"[^"]+"|'[^']+'|[^\s`，。；、\u4e00-\u9fff#]+)){1,10})/);
    if (!match) continue;
    const command = match[1].trim().replace(/[.;,，。；、]+$/, "");
    if (/[\u4e00-\u9fff，。；、]/.test(command)) continue;
    if (!isPlausibleLarkCliCommand(command)) continue;
    return command;
  }
  return "";
}

function isPlausibleLarkCliCommand(command) {
  const parts = command.split(/\s+/);
  if (parts[0] !== "lark-cli") return false;
  if (!parts[1]) return false;
  if (parts.length > 2) return true;

  const knownSecondTokens = new Set([
    "api",
    "auth",
    "base",
    "calendar",
    "config",
    "docs",
    "drive",
    "im",
    "mail",
    "schema",
    "sheets",
    "task",
    "wiki",
  ]);
  return knownSecondTokens.has(parts[1]);
}

function inferRetrievedCategory(text, results) {
  const normalized = normalizeSearchText(text);
  if (/permission|scope|权限|授权/.test(normalized)) return "permission_scope";
  if (/wiki|token|base|obj_token/.test(normalized)) return "token_type";
  if (/schema|params|data|requestbody|参数/.test(normalized)) return "schema_params_data";
  if (/unknown|flag|command|service/.test(normalized)) return "command_existence";
  return results[0]?.metadata?.category || "knowledge_retrieval";
}

function inferRetrievedSeverity(text) {
  const normalized = normalizeSearchText(text);
  if (/failed|error|permission denied|unknown|invalid|报错|失败/.test(normalized)) return "warning";
  return "info";
}

function firstHeading(body) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function sanitizeId(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function relativeSource(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function parseListOption(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
