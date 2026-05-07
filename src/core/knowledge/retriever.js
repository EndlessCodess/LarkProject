import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
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
  const index = createRetrieverIndex(chunks);
  if (isVectorRetrieverMode(options.retrieverMode || process.env.LARK_RETRIEVER_MODE)) {
    try {
      await attachVectorStore(index, options);
    } catch (error) {
      index.vector = {
        enabled: false,
        error: error.message,
      };
      index.meta.vector = {
        enabled: false,
        error: error.message,
      };
    }
  }
  return index;
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

export async function retrieveKnowledge(query, index, options = {}) {

  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  if (!chunks.length) return [];

  const queryText = typeof query === "string" ? query : query?.text || "";
  const queryTerms = tokenize(queryText);
  if (!queryTerms.length) return [];

  const queryTermSet = new Set(queryTerms);
  const preferredSkills = inferPreferredSkills(queryText);
  const mode = normalizeRetrieverMode(options.retrieverMode || process.env.LARK_RETRIEVER_MODE || "keyword");
  const queryEmbedding = isVectorRetrieverMode(mode) ? await embedQuery(queryText, index, options) : null;
  const scored = [];

  for (const chunk of chunks) {
    let keywordScore = 0;
    const matchedTerms = [];

    for (const term of queryTermSet) {
      const frequency = chunk.termCounts.get(term) || 0;
      if (!frequency) continue;
      const idf = index.idf.get(term) || 1;
      const termScore = (frequency / Math.sqrt(chunk.termTotal || 1)) * idf;
      keywordScore += termScore;
      matchedTerms.push(term);
    }

    keywordScore += phraseBonus(queryText, chunk.keywordText || chunk.searchText);
    const routeBonus = buildRouteBonus(queryText, chunk, preferredSkills);
    const legacyScore = keywordScore + routeBonus;
    const semanticScore = buildSemanticScore({ mode, queryText, queryTerms, chunk, queryEmbedding });

    if (legacyScore > 0 || semanticScore > 0) {
      scored.push({
        source_type: chunk.source_type,
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        score: Number(legacyScore.toFixed(4)),
        matched_terms: matchedTerms.sort(),
        metadata: chunk.metadata || {},
        _debugScore: {
          mode,
          keywordRaw: Number(keywordScore.toFixed(4)),
          semanticRaw: Number(semanticScore.toFixed(4)),
          routeBonusRaw: Number(routeBonus.toFixed(4)),
        },
      });
    }
  }

  if (isHybridRetrieverMode(mode)) {
    applyHybridScores(scored, queryText, mode);
  }

  const topK = Number(options.topK || 5);
  const minScore = Number(options.minScore || (isHybridRetrieverMode(mode) ? 0.08 : 0.35));
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score >= minScore)
    .slice(0, Math.max(1, topK));
}

export function buildRetrievedKnowledgeRule(event, retrievalResults, options = {}) {
  const results = retrievalResults || [];
  if (!results.length) return null;

  const primary = results[0];
  const retrieverMode = primary?.metadata?.retrieverMode || "keyword";
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
    next_command_template: inferNextCommand(results, event?.text || ""),
    source: sourceList,
    _matchedSignal: `retriever:${primary.title || primary.source}`,
    _score: primary.score,
    _retrieval: {
      strategy: "local_lightweight_retrieval",
      retrieverMode,
      queryText: typeof event === "string" ? event : event?.text || "",
      reason: options.reason || "rule_miss",
      results: results.slice(0, 5),
    },
  };
}

export function createRetrieverIndex(chunks) {
  const normalizedChunks = chunks.map((chunk) => {
    const searchText = normalizeSearchText([chunk.title, chunk.content, chunk.source, chunk.metadata?.skillName].filter(Boolean).join("\n"));
    const keywordText = normalizeSearchText(buildChunkKeywordText(chunk));
    const terms = tokenize(keywordText);
    return {
      ...chunk,
      searchText,
      keywordText,
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
    for (const part of splitLongText(section.content, 1600, { overlapParagraphs: 1 })) {
      chunks.push({
        id: `skill:${metadata.skillName}:${sanitizeId(section.headingPath || section.heading)}:${chunks.length}`,
        source_type: metadata.source_type,
        source: metadata.source,
        title: `${title} ${section.headingPath || section.heading}`.trim(),
        content: part,
        metadata: {
          ...metadata,
          section: section.heading,
          sectionPath: section.headingPath || section.heading,
          headingLevel: section.level || null,
          description,
        },
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
  const headingStack = [];
  let current = {
    heading: firstHeading(body) || "intro",
    headingPath: firstHeading(body) || "intro",
    level: 1,
    content: "",
  };

  for (const line of lines) {
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      if (current.content.trim()) sections.push(current);
      const level = heading[1].length;
      const title = heading[2].trim();

      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });

      current = {
        heading: title,
        headingPath: headingStack.map((item) => item.title).join(" > "),
        level,
        content: line,
      };
      continue;
    }
    current.content += `${line}\n`;
  }

  if (current.content.trim()) sections.push(current);
  return sections;
}

function splitLongText(text, maxLength, options = {}) {
  if (text.length <= maxLength) return [text.trim()];
  const paragraphs = text.split(/\n{2,}/);
  const parts = [];
  let current = "";
  const overlapParagraphs = Math.max(0, Number(options.overlapParagraphs || 0));
  let currentParagraphs = [];

  for (const paragraph of paragraphs) {
    if ((current.length + paragraph.length + 2) > maxLength && current.trim()) {
      parts.push(current.trim());
      const overlap = overlapParagraphs > 0 ? currentParagraphs.slice(-overlapParagraphs) : [];
      currentParagraphs = [...overlap];
      current = overlap.length ? `${overlap.join("\n\n")}\n\n` : "";
    }
    current += `${paragraph}\n\n`;
    currentParagraphs.push(paragraph);
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

  // Preferred cloud knowledge entrypoint is knowledge/lark-cloud-knowledge.json.
  // Legacy docs names stay here only so older demo commands do not break.
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
  const asciiTerms = normalized.match(/[a-z0-9_:+.-]+/g) || [];
  const chineseTerms = extractChineseKeywordTerms(normalized);
  return [...asciiTerms, ...chineseTerms]
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .filter((term) => !STOP_WORDS.has(term));
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/@_user_\d+/g, " ")
    .replace(/<at\b[^>]*>.*?<\/at>/g, " ")
    .replace(/[`"'“”‘’]/g, " ")
    .replace(/[(){}[\],;，。！？、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildChunkKeywordText(chunk) {
  const sourceBase = path.basename(chunk.source || "", path.extname(chunk.source || ""));
  const commands = extractCandidateCommands(chunk.content || "");
  return [
    chunk.metadata?.skillName,
    chunk.title,
    chunk.metadata?.section,
    sourceBase,
    commands.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractChineseKeywordTerms(text) {
  const runs = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const terms = [];

  for (const run of runs) {
    if (run.length <= 4) terms.push(run);
    const maxGram = Math.min(4, run.length);
    for (let size = 2; size <= maxGram; size++) {
      for (let i = 0; i <= run.length - size; i++) {
        terms.push(run.slice(i, i + size));
      }
    }
  }

  return unique(terms);
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

function extractCandidateCommands(text) {
  const raw = String(text || "");
  const commands = [
    ...(raw.match(/lark-cli\s+[a-z0-9_+-]+(?:\s+[a-z0-9_+.-]+){0,6}/gi) || []),
    ...(raw.match(/\+[a-z0-9_-]+/gi) || []),
  ];
  return unique(commands.map((item) => item.trim()));
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
  // Cloud docs are an explicit enterprise knowledge entrypoint. When cloud
  // content duplicates an installed Skill, prefer exposing at least one cloud
  // source in the evidence list so demos can prove cloud knowledge integration.
  if (chunk.source_type === "cloud_doc") return 3;
  return 0;
}

function skillRouteBonus(chunk, preferredSkills) {
  const skillName = chunk.metadata?.skillName || "";
  if (!skillName || !preferredSkills.has(skillName)) return 0;
  return 2.5;
}

function nonPreferredSkillPenalty(chunk, preferredSkills) {
  if (!preferredSkills?.size) return 0;
  const skillName = chunk.metadata?.skillName || "";
  if (!skillName || preferredSkills.has(skillName)) return 0;
  return -0.8;
}

function commandIntentBonus(queryText, chunk) {
  if (!hasSendMessageIntent(queryText)) return 0;
  const skillName = chunk.metadata?.skillName || "";
  const haystack = [chunk.title, chunk.source, chunk.keywordText || chunk.searchText].filter(Boolean).join("\n").toLowerCase();
  if (skillName === "lark-im" && /messages-send|\+messages-send|send a message/.test(haystack)) return 8;
  if (skillName === "lark-im" && /message|messages|reply|chat|im\s/.test(haystack)) return 4.5;
  if (skillName === "lark-base" && /workflow|schema|trigger/.test(haystack)) return -3.5;
  if (skillName && skillName !== "lark-im") return -2.2;
  return 0;
}

function driveImportIntentBonus(queryText, chunk) {
  if (!hasDriveImportIntent(queryText)) return 0;
  const skillName = chunk.metadata?.skillName || "";
  const haystack = [chunk.title, chunk.source, chunk.keywordText || chunk.searchText].filter(Boolean).join("\n").toLowerCase();
  if (skillName === "lark-drive" && /drive|import|\+import|upload|file|folder|cloud/.test(haystack)) return 8;
  if (skillName === "lark-drive") return 4;
  if (["lark-doc", "lark-base", "lark-sheets"].includes(skillName)) return -2;
  return 0;
}

function buildRouteBonus(queryText, chunk, preferredSkills) {
  return (
    sourceTypeBonus(chunk) +
    skillRouteBonus(chunk, preferredSkills) +
    nonPreferredSkillPenalty(chunk, preferredSkills) +
    chatMessageIntentBonus(queryText, chunk) +
    commandIntentBonus(queryText, chunk) +
    driveImportIntentBonus(queryText, chunk)
  );
}

function normalizeRetrieverMode(value) {
  const normalized = String(value || "").toLowerCase();
  if (["hybrid-vector", "vector", "embedding", "embeddings"].includes(normalized)) return "hybrid-vector";
  if (normalized === "hybrid") return "hybrid";
  return "keyword";
}

function isHybridRetrieverMode(mode) {
  return mode === "hybrid" || mode === "hybrid-vector";
}

function isVectorRetrieverMode(mode) {
  return normalizeRetrieverMode(mode) === "hybrid-vector";
}

function applyHybridScores(scored, queryText, mode) {

  const weights = inferHybridWeights(queryText);
  const maxKeyword = maxDebugScore(scored, "keywordRaw");
  const maxSemantic = maxDebugScore(scored, "semanticRaw");

  for (const item of scored) {
    const keywordNorm = normalizePositive(item._debugScore.keywordRaw, maxKeyword);
    const semanticNorm = normalizePositive(item._debugScore.semanticRaw, maxSemantic);
    const routeBonusNorm = normalizeRouteBonus(item._debugScore.routeBonusRaw);
    const finalScore = (keywordNorm * weights.keyword) + (semanticNorm * weights.semantic) + routeBonusNorm;

    item.score = Number(finalScore.toFixed(4));
    item.metadata = {
      ...(item.metadata || {}),
      retrieverMode: mode,
      retrieverScore: {
        keyword: Number(keywordNorm.toFixed(4)),
        semantic: Number(semanticNorm.toFixed(4)),
        routeBonus: Number(routeBonusNorm.toFixed(4)),
        keywordWeight: weights.keyword,
        semanticWeight: weights.semantic,
      },
    };
  }
}

function buildSemanticScore({ mode, queryText, queryTerms, chunk, queryEmbedding }) {
  if (mode === "hybrid-vector" && queryEmbedding && Array.isArray(chunk._embedding)) {
    return cosineSimilarity(queryEmbedding, chunk._embedding);
  }
  if (isHybridRetrieverMode(mode)) return semanticLiteScore(queryText, queryTerms, chunk);
  return 0;
}

async function attachVectorStore(index, options = {}) {
  
  const config = resolveEmbeddingConfig(options);
  index.vector = {
    enabled: false,
    provider: config.provider,
    model: config.model,
    storeFile: config.storeFile,
    queryCache: new Map(),
    error: "",
  };

  if (!config.apiKey) {
    index.vector.error = "missing embedding api key";
    index.meta.vector = {
      enabled: false,
      provider: config.provider,
      model: config.model,
      storeFile: config.storeFile,
      embeddedCount: 0,
      chunkCount: index.chunks.length,
      error: index.vector.error,
    };
    return;
  }

  const store = await readVectorStore(config);
  let changed = false;
  const missing = [];

  for (const chunk of index.chunks) {
    const vectorKey = buildVectorKey(chunk, config);
    chunk._vectorKey = vectorKey;
    const cached = store.items?.[vectorKey];
    if (Array.isArray(cached?.embedding) && cached.embedding.length) {
      chunk._embedding = cached.embedding;
      continue;
    }
    missing.push({ chunk, vectorKey });
  }

  const batchSize = Math.max(1, Number(options.embeddingBatchSize || process.env.ARK_EMBEDDING_BATCH_SIZE || config.batchSize));
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const texts = batch.map(({ chunk }) => buildEmbeddingText(chunk));
    const embeddings = await embedTexts(texts, config);

    embeddings.forEach((embedding, indexInBatch) => {
      const target = batch[indexInBatch];
      if (!Array.isArray(embedding) || !embedding.length) return;
      target.chunk._embedding = embedding;
      store.items[target.vectorKey] = {
        embedding,
        source: target.chunk.source,
        title: target.chunk.title,
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    });
  }

  if (changed) await writeVectorStore(config, store);

  const embeddedCount = index.chunks.filter((chunk) => Array.isArray(chunk._embedding)).length;
  index.vector.enabled = embeddedCount > 0;
  index.vector.embeddedCount = embeddedCount;
  index.meta.vector = {
    enabled: index.vector.enabled,
    provider: config.provider,
    model: config.model,
    storeFile: config.storeFile,
    embeddedCount,
    chunkCount: index.chunks.length,
  };
}

async function embedQuery(queryText, index, options = {}) {

  if (!index?.vector?.enabled) return null;
  const config = resolveEmbeddingConfig(options);
  if (!config.apiKey) return null;

  const queryInput = buildEmbeddingQueryText(queryText, config);
  const cacheKey = stableHash(`${config.model}\nquery\n${queryInput}`);
  if (index.vector.queryCache?.has(cacheKey)) return index.vector.queryCache.get(cacheKey);

  try {
    const [embedding] = await embedTexts([queryInput], config);
    if (!Array.isArray(embedding) || !embedding.length) return null;
    index.vector.queryCache?.set(cacheKey, embedding);
    return embedding;
  } catch {
    return null;
  }
}

function resolveEmbeddingConfig(options = {}) {
  const baseUrl = String(options.embeddingBaseUrl || process.env.ARK_EMBEDDING_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
  const model = options.embeddingModel || process.env.ARK_EMBEDDING_MODEL || "doubao-embedding-vision-250615";
  const mode = inferEmbeddingRequestMode({ model, url: options.embeddingUrl || process.env.ARK_EMBEDDING_URL || "" });
  const defaultUrl = mode === "multimodal" ? `${baseUrl}/embeddings/multimodal` : `${baseUrl}/embeddings`;
  return {
    provider: "ark",
    apiKey: options.embeddingApiKey || process.env.ARK_EMBEDDING_API_KEY || process.env.ARK_API_KEY || "",
    model,
    mode,
    url: options.embeddingUrl || process.env.ARK_EMBEDDING_URL || defaultUrl,
    batchSize: mode === "multimodal" ? 1 : 16,
    storeFile: path.resolve(options.vectorStoreFile || process.env.LARK_RETRIEVER_VECTOR_STORE_FILE || "tmp/retriever-vector-store.json"),
    timeoutMs: Number(options.embeddingTimeoutMs || process.env.ARK_EMBEDDING_TIMEOUT_MS || 60000),
    encodingFormat: options.embeddingEncodingFormat || process.env.ARK_EMBEDDING_ENCODING_FORMAT || "float",
    queryInstruction:
      options.embeddingQueryInstruction ||
      process.env.ARK_EMBEDDING_QUERY_INSTRUCTION ||
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ",
  };
}

function inferEmbeddingRequestMode({ model, url }) {
  const text = `${model || ""} ${url || ""}`.toLowerCase();
  if (/multimodal|vision/.test(text)) return "multimodal";
  return "text";
}

async function readVectorStore(config) {
  try {
    const parsed = JSON.parse(await fs.readFile(config.storeFile, "utf8"));
    if (parsed?.model === config.model && parsed?.provider === config.provider && parsed?.items && typeof parsed.items === "object") {
      return parsed;
    }
  } catch {
    // Missing or stale vector store is expected on first run.
  }

  return {
    version: 1,
    provider: config.provider,
    model: config.model,
    generatedAt: new Date().toISOString(),
    items: {},
  };
}

async function writeVectorStore(config, store) {
  await fs.mkdir(path.dirname(config.storeFile), { recursive: true });
  await fs.writeFile(config.storeFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function embedTexts(texts, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildEmbeddingRequestBody(texts, config)),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || body?.message || `embedding request failed: ${response.status}`);
    }
    const embeddings = parseEmbeddingResponse(body);
    if (embeddings.length !== texts.length) {
      throw new Error(`embedding response count mismatch: expected ${texts.length}, actual ${embeddings.length}`);
    }
    return embeddings;
  } finally {
    clearTimeout(timer);
  }
}

function buildEmbeddingRequestBody(texts, config) {
  if (config.mode === "multimodal") {
    return {
      model: config.model,
      input: texts.map((text) => ({ type: "text", text })),
    };
  }

  return {
    model: config.model,
    input: texts,
    encoding_format: config.encodingFormat,
  };
}

function buildEmbeddingQueryText(queryText, config) {
  if (config.mode === "multimodal") return queryText;
  const instruction = String(config.queryInstruction || "");
  if (!instruction) return queryText;
  return `${instruction}${queryText}`;
}

function parseEmbeddingResponse(body) {
  if (Array.isArray(body?.data)) {
    return body.data.map((item) => item.embedding || item?.embeddings?.[0]).filter(Boolean);
  }
  if (Array.isArray(body?.data?.embedding)) return [body.data.embedding];
  if (Array.isArray(body?.embedding)) return [body.embedding];
  if (Array.isArray(body?.embeddings)) return body.embeddings;
  return [];
}

function buildVectorKey(chunk, config) {
  return stableHash([config.provider, config.model, chunk.id, chunk.source, chunk.title, chunk.content].join("\n"));
}

function buildEmbeddingText(chunk) {
  return [chunk.metadata?.skillName, chunk.title, chunk.source, chunk.content]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const a = Number(left[i]) || 0;
    const b = Number(right[i]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function inferHybridWeights(queryText) {
  const normalized = normalizeSearchText(queryText);
  const hasExplicitCommand = /\blark-cli\s+[a-z0-9_-]+|\s--[a-z0-9_-]+|\+[a-z0-9_-]+/.test(normalized);
  if (hasExplicitCommand) return { keyword: 0.7, semantic: 0.3 };

  const hasCliDomainToken = /\b(api|schema|event|websocket|bot|user|chat_id|open_id|obj_token|tenant_access_token)\b/.test(normalized);
  if (hasCliDomainToken) return { keyword: 0.6, semantic: 0.4 };

  return { keyword: 0.5, semantic: 0.5 };
}

function maxDebugScore(scored, key) {
  return Math.max(0, ...scored.map((item) => Number(item._debugScore?.[key] || 0)));
}

function normalizePositive(value, maxValue) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || maxValue <= 0) return 0;
  return Math.min(1, number / maxValue);
}

function normalizeRouteBonus(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 0;
  if (number > 0) return Math.min(0.16, number / 30);
  return Math.max(-0.08, number / 20);
}

function semanticLiteScore(queryText, queryTerms, chunk) {
  const queryTermSet = new Set(queryTerms);
  if (!queryTermSet.size) return 0;

  let coveredTerms = 0;
  for (const term of queryTermSet) {
    if (chunk.termCounts.has(term)) coveredTerms += 1;
  }

  const coverage = coveredTerms / queryTermSet.size;
  const phraseCoverage = semanticPhraseCoverage(queryText, chunk.searchText);
  const titleCoverage = semanticTitleCoverage(queryTermSet, chunk.title);
  return (coverage * 0.65) + (phraseCoverage * 0.25) + (titleCoverage * 0.1) + skillIntentSemanticBoost(queryText, chunk);
}

function skillIntentSemanticBoost(queryText, chunk) {
  const skillName = chunk.metadata?.skillName || "";
  if (hasReadChatMessageIntent(queryText) && skillName === "lark-im") return 1;
  if (hasSendMessageIntent(queryText) && skillName === "lark-im") return 1;
  return 0;
}

function semanticPhraseCoverage(queryText, searchText) {
  const phrases = extractPhrases(queryText).filter((phrase) => phrase.length >= 4);
  if (!phrases.length) return 0;
  const hits = phrases.filter((phrase) => searchText.includes(normalizeSearchText(phrase))).length;
  return hits / phrases.length;
}

function semanticTitleCoverage(queryTermSet, title) {
  const titleTerms = new Set(tokenize(title));
  if (!titleTerms.size) return 0;

  let hits = 0;
  for (const term of queryTermSet) {
    if (titleTerms.has(term)) hits += 1;
  }
  return hits / Math.max(1, Math.min(queryTermSet.size, titleTerms.size));
}

function inferPreferredSkills(text) {
  const normalized = normalizeSearchText(text);
  const tokenSet = new Set(tokenize(normalized));
  const skills = new Set();

  if (/im|message|messages|chat|chat_id|open_id/.test(normalized) || hasAny(normalized, IM_HINTS) || hasTokenHint(tokenSet, IM_HINTS)) {
    skills.add("lark-im");
  }
  if (/event|websocket|wsclient/.test(normalized) || hasAny(normalized, EVENT_HINTS) || hasTokenHint(tokenSet, EVENT_HINTS)) {
    skills.add("lark-event");
  }
  if (/permission|scope|auth|--as|user|bot/.test(normalized) || hasAny(normalized, SHARED_HINTS) || hasTokenHint(tokenSet, SHARED_HINTS)) skills.add("lark-shared");
  if (/wiki|space|obj_token/.test(normalized) || hasAny(normalized, WIKI_HINTS) || hasTokenHint(tokenSet, WIKI_HINTS)) skills.add("lark-wiki");
  if (/base|bitable|table|record|field/.test(normalized) || hasAny(normalized, BASE_HINTS) || hasTokenHint(tokenSet, BASE_HINTS)) skills.add("lark-base");
  if (/doc|docs|docx/.test(normalized) || hasAny(normalized, DOC_HINTS) || hasTokenHint(tokenSet, DOC_HINTS)) skills.add("lark-doc");
  if (/sheet|sheets|spreadsheet/.test(normalized) || hasAny(normalized, SHEETS_HINTS) || hasTokenHint(tokenSet, SHEETS_HINTS)) skills.add("lark-sheets");
  if (/calendar|meeting|room|freebusy/.test(normalized) || hasAny(normalized, CALENDAR_HINTS) || hasTokenHint(tokenSet, CALENDAR_HINTS)) skills.add("lark-calendar");
  if (/drive|file|folder|upload|download|import|markdown|word|excel|xlsx|csv/.test(normalized) || hasAny(normalized, DRIVE_HINTS) || hasTokenHint(tokenSet, DRIVE_HINTS)) skills.add("lark-drive");
  if (/task|todo/.test(normalized) || hasAny(normalized, TASK_HINTS) || hasTokenHint(tokenSet, TASK_HINTS)) skills.add("lark-task");

  return skills;
}

const IM_HINTS = [
  "\u7fa4\u804a",
  "\u7fa4\u6d88\u606f",
  "\u7fa4\u91cc",
  "\u7fa4\u7684\u4fe1\u606f",
  "\u7fa4\u91cc\u7684\u4fe1\u606f",
  "\u8bfb\u53d6\u7fa4",
  "\u8bfb\u7fa4",
  "\u6d88\u606f",
  "\u804a\u5929\u8bb0\u5f55",
  "\u5386\u53f2\u6d88\u606f",
  "\u53d1\u6d88\u606f",
  "\u56de\u590d",
];

const SEND_MESSAGE_HINTS = [
  "\u53d1\u6d88\u606f",
  "\u53d1\u9001\u6d88\u606f",
  "\u7ed9\u7fa4\u804a\u53d1\u6d88\u606f",
  "\u7fa4\u91cc\u53d1\u6d88\u606f",
  "\u7fa4\u91cc\u9762\u53d1\u6d88\u606f",
  "\u5728\u7fa4\u91cc\u53d1\u6d88\u606f",
];

const READ_CHAT_MESSAGE_HINTS = [
  "\u8bfb\u53d6\u7fa4",
  "\u8bfb\u7fa4",
  "\u7fa4\u7684\u4fe1\u606f",
  "\u7fa4\u91cc\u7684\u4fe1\u606f",
  "\u7fa4\u91cc\u4fe1\u606f",
  "\u7fa4\u804a\u8bb0\u5f55",
  "\u804a\u5929\u8bb0\u5f55",
  "\u5386\u53f2\u6d88\u606f",
  "\u641c\u7d22\u6d88\u606f",
];

const EVENT_HINTS = [
  "\u957f\u8fde\u63a5",
  "\u4e8b\u4ef6",
  "\u76d1\u542c",
  "\u8ba2\u9605",
  "\u5b9e\u65f6\u6d88\u606f",
  "\u4e3b\u52a8\u6d88\u606f",
  "\u63a5\u6536\u4e8b\u4ef6",
  "\u6d88\u606f\u4e8b\u4ef6",
];

const SHARED_HINTS = ["\u6743\u9650", "\u6388\u6743", "\u8eab\u4efd"];
const WIKI_HINTS = ["\u77e5\u8bc6\u5e93", "\u8282\u70b9"];
const BASE_HINTS = ["\u591a\u7ef4", "\u5b57\u6bb5", "\u8bb0\u5f55", "\u8868\u683c"];
const DOC_HINTS = ["\u6587\u6863", "\u4e91\u6587\u6863"];
const SHEETS_HINTS = ["\u516c\u5f0f", "\u5355\u5143\u683c", "\u7535\u5b50\u8868\u683c"];
const CALENDAR_HINTS = ["\u65e5\u5386", "\u4f1a\u8bae", "\u4f1a\u8bae\u5ba4", "\u65e5\u7a0b"];
const DRIVE_HINTS = ["\u4e91\u7a7a\u95f4", "\u6587\u4ef6", "\u6587\u4ef6\u5939", "\u4e0a\u4f20", "\u4e0b\u8f7d", "\u5bfc\u5165"];
const DRIVE_IMPORT_HINTS = [
  "\u5bfc\u5165",
  "\u4e0a\u4f20",
  "\u672c\u5730\u6587\u4ef6",
  "\u672c\u5730",
  "\u6587\u4ef6\u5bfc\u5165",
  "\u6587\u4ef6\u8f6c",
  "\u4e91\u7a7a\u95f4",
];
const TASK_HINTS = ["\u5f85\u529e", "\u4efb\u52a1"];

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function hasTokenHint(tokenSet, terms) {
  return terms.some((term) => tokenSet.has(term));
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

function inferNextCommand(results, queryText = "") {
  if (hasSendMessageIntent(queryText) && results.some((item) => item.metadata?.skillName === "lark-im")) {
    return 'lark-cli im +messages-send --chat-id <oc_xxx> --text "<消息内容>" --as bot';
  }
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

function hasSendMessageIntent(text) {
  const normalized = normalizeSearchText(text);
  const tokenSet = new Set(tokenize(normalized));
  return (
    /send|messages-send|\+messages-send|\+send/.test(normalized) ||
    /发.{0,6}消息|发送.{0,6}消息|群.{0,6}发.{0,6}消息/.test(normalized) ||
    hasAny(normalized, SEND_MESSAGE_HINTS) ||
    hasTokenHint(tokenSet, ["消息", "发送消息", "发消息", "群发", "群聊", "飞书群"])
  );
}

function chatMessageIntentBonus(queryText, chunk) {
  if (!hasReadChatMessageIntent(queryText)) return 0;
  const skillName = chunk.metadata?.skillName || "";
  const haystack = [chunk.title, chunk.source, chunk.searchText].filter(Boolean).join("\n").toLowerCase();

  if (skillName === "lark-im" && /chat|message|messages|history|search|im\s/.test(haystack)) return 4;
  if (skillName === "lark-event" && /event|subscribe|websocket|receive/.test(haystack)) return 1.2;
  if (skillName === "lark-contact") return -3;
  return 0;
}

function hasReadChatMessageIntent(text) {
  const normalized = normalizeSearchText(text);
  const tokenSet = new Set(tokenize(normalized));
  return (
    /read.*chat|chat.*message|message.*history|search.*message/.test(normalized) ||
    hasAny(normalized, READ_CHAT_MESSAGE_HINTS) ||
    hasTokenHint(tokenSet, ["消息", "历史消息", "聊天记录", "群聊", "群消息"])
  );
}

function hasDriveImportIntent(text) {
  const normalized = normalizeSearchText(text);
  const tokenSet = new Set(tokenize(normalized));
  return (
    /drive|import|upload|markdown|word|excel|xlsx|csv/.test(normalized) ||
    hasAny(normalized, DRIVE_IMPORT_HINTS) ||
    hasTokenHint(tokenSet, DRIVE_IMPORT_HINTS)
  );
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
  if (!sections.length) return splitLongText(raw, maxLength, { overlapParagraphs: 1 });

  const parts = [];
  for (const section of sections) {
    parts.push(...splitLongText(section, maxLength, { overlapParagraphs: 1 }));
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
