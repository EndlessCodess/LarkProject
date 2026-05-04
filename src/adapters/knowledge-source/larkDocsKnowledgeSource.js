import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { runLarkCli } from "../lark-cli/runner.js";
import { normalizeCloudKnowledgeItems } from "../../core/knowledge/cloudKnowledgeNormalizer.js";

export async function loadLarkDocsKnowledge({ docs, timeoutMs }) {
  const documents = await fetchLarkDocsDocuments({ docs, timeoutMs });
  return normalizeCloudKnowledgeItems(documents);
}

export async function expandLarkDocsManifest({ docs, folders, timeoutMs }) {
  const expandedDocs = [...(docs || [])];

  for (const folder of folders || []) {
    const items = await listLarkDriveFolderDocuments(folder, { timeoutMs });
    expandedDocs.push(...items);
  }

  return dedupeDocs(expandedDocs);
}

export async function fetchLarkDocsDocuments({ docs, timeoutMs }) {
  const documents = [];

  for (const doc of docs || []) {
    try {
      const fetched = await fetchLarkDoc(doc, { timeoutMs });
      documents.push(fetched);
    } catch (error) {
      console.warn(`[cloud-knowledge][warn] skip source ${doc.title || doc.url || doc.token || doc.id}: ${error.message}`);
    }
  }

  return documents;
}

export async function listLarkDriveFolderDocuments(folder, { timeoutMs }) {
  const folderToken = folder.folderToken || extractDriveFolderToken(folder.folderUrl || folder.url || "");
  if (!folderToken) {
    throw new Error("folder entry requires folderToken or folderUrl");
  }

  const cacheOptions = buildCacheOptions(folder);
  const cached = await readCacheEntry(cacheOptions, `folder:${folder.id || folderToken}`);
  if (cached) return cached;

  const files = await listDriveFolderFiles(folderToken, {
    as: folder.as || "user",
    pageSize: Number(folder.pageSize || 200),
    timeoutMs,
  });
  const items = await flattenKnowledgeEntriesFromFolderFiles(files, {
    as: folder.as || "user",
    folderToken,
    folderUrl: folder.folderUrl || folder.url || "",
    timeoutMs,
  });
  await writeCacheEntry(cacheOptions, `folder:${folder.id || folderToken}`, items);
  return items;
}

async function fetchLarkDoc(doc, { timeoutMs }) {
  const cacheOptions = buildCacheOptions(doc);
  const cached = await readCacheEntry(cacheOptions, `doc:${doc.id || doc.url || doc.token}`);
  if (cached) return cached;

  const fetched = doc.kind === "drive_file"
    ? await downloadDriveFileDocument(doc, { timeoutMs })
    : await fetchStructuredDocDocument(doc, { timeoutMs });
  await writeCacheEntry(cacheOptions, `doc:${doc.id || doc.url || doc.token}`, fetched);
  return fetched;
}

async function fetchStructuredDocDocument(doc, { timeoutMs }) {
  const args = buildDocsFetchArgs(doc);
  const result = await runLarkCli(args, { timeoutMs });

  if (result.code !== 0) {
    throw new Error(`lark-cli docs fetch failed (${result.code}): ${result.stderr || result.stdout}`);
  }

  return {
    id: doc.id || doc.url || doc.token,
    title: doc.title || "",
    url: doc.url || doc.token,
    content: extractDocumentText(result.stdout),
    raw: result.stdout,
    source_type: "cloud_doc",
  };
}

async function downloadDriveFileDocument(doc, { timeoutMs }) {
  const token = doc.token;
  if (!token) throw new Error("drive file knowledge entry requires token");

  const downloadPath = path.join("tmp", "lark-doc-downloads", sanitizeFileSegment(doc.id || token), sanitizeFileSegment(doc.title || "file.md"));
  await fs.mkdir(path.dirname(downloadPath), { recursive: true });

  const args = [
    "drive",
    "+download",
    "--file-token",
    token,
    "--as",
    doc.as || "user",
    "--output",
    downloadPath,
    "--overwrite",
  ];
  const result = await retryLarkCli(args, { timeoutMs, attempts: 3, label: `drive download ${doc.title || token}` });

  const content = await fs.readFile(downloadPath, "utf8");
  return {
    id: doc.id || doc.url || doc.token,
    title: doc.title || "",
    url: doc.url || doc.token,
    content,
    raw: content,
    source_type: "cloud_skill_file",
    metadata: {
      path: doc.path || "",
      sourceFolderUrl: doc.sourceFolderUrl || "",
      sourceFolderToken: doc.sourceFolderToken || "",
    },
  };
}

async function retryLarkCli(args, { timeoutMs, attempts = 3, label = "lark-cli request" }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await runLarkCli(args, { timeoutMs });
    if (result.code === 0) return result;
    lastError = new Error(`lark-cli ${label} failed (${result.code}): ${result.stderr || result.stdout}`);
    if (attempt < attempts) {
      await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  throw lastError || new Error(`lark-cli ${label} failed`);
}

function buildDocsFetchArgs(doc) {
  const target = doc.url || doc.token;
  if (!target) {
    throw new Error("lark-docs knowledge source requires doc.url or doc.token");
  }

  const args = [
    "docs",
    "+fetch",
    "--api-version",
    doc.apiVersion || "v2",
    "--doc",
    target,
    "--as",
    doc.as || "user",
    "--format",
    "json",
  ];

  if (doc.limit) args.push("--limit", String(doc.limit));
  if (doc.offset) args.push("--offset", String(doc.offset));

  return args;
}

async function listDriveFolderFiles(folderToken, { as, pageSize, timeoutMs }) {
  const args = [
    "drive",
    "files",
    "list",
    "--as",
    as || "user",
    "--format",
    "json",
    "--params",
    "-",
  ];
  const params = JSON.stringify({
    folder_token: folderToken,
    page_size: Number(pageSize || 200),
  });
  const result = await runLarkCliWithStdin(args, params, { timeoutMs });
  if (result.code !== 0) {
    throw new Error(`lark-cli drive files list failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const parsed = parseJson(result.stdout);
  return Array.isArray(parsed?.data?.files) ? parsed.data.files : Array.isArray(parsed?.files) ? parsed.files : [];
}

async function flattenKnowledgeEntriesFromFolderFiles(files, context) {
  const items = [];
  for (const file of files || []) {
    if (String(file?.type || "").toLowerCase() === "folder") {
      const children = await listDriveFolderFiles(file.token, {
        as: context.as,
        pageSize: 200,
        timeoutMs: context.timeoutMs,
      });
      const childItems = await flattenKnowledgeEntriesFromFolderFiles(children, {
        ...context,
        pathPrefix: joinKnowledgePath(context.pathPrefix, file.name),
      });
      items.push(...childItems);
      continue;
    }

    const type = String(file?.type || "").toLowerCase();
    if (isSupportedKnowledgeDocType(type)) {
      items.push({
        id: file.token || file.url || file.name,
        title: file.name || "",
        token: file.token || "",
        url: file.url || "",
        as: context.as || "user",
        apiVersion: "v2",
        sourceFolderToken: context.folderToken,
        sourceFolderUrl: context.folderUrl,
        kind: "structured_doc",
        path: joinKnowledgePath(context.pathPrefix, file.name),
      });
      continue;
    }

    if (type === "file" && /\.md$/i.test(file?.name || "")) {
      items.push({
        id: file.token || file.url || file.name,
        title: file.name || "",
        token: file.token || "",
        url: file.url || "",
        as: context.as || "user",
        sourceFolderToken: context.folderToken,
        sourceFolderUrl: context.folderUrl,
        kind: "drive_file",
        path: joinKnowledgePath(context.pathPrefix, file.name),
      });
    }
  }
  return items;
}

function dedupeDocs(docs) {
  const seen = new Set();
  const uniqueDocs = [];
  for (const doc of docs || []) {
    const key = doc.url || doc.token || doc.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueDocs.push(doc);
  }
  return uniqueDocs;
}

function extractDocumentText(stdout) {
  const trimmed = stdout.trim();

  try {
    const parsed = JSON.parse(trimmed);
    return findTextContent(parsed) || JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

function findTextContent(value) {
  if (!value || typeof value !== "object") return "";

  const direct = value.content || value.text || value.markdown || value.raw_content || value.xml;
  if (typeof direct === "string" && direct.trim()) return direct;

  const data = value.data;
  if (data && typeof data === "object") {
    const fromData = data.markdown || data.content || data.text || data.raw_content || data.xml;
    if (typeof fromData === "string" && fromData.trim()) return fromData;

    const document = data.document;
    if (document && typeof document === "object") {
      const fromDocument = document.markdown || document.content || document.text || document.raw_content || document.xml;
      if (typeof fromDocument === "string" && fromDocument.trim()) return fromDocument;
    }
  }

  return "";
}

function extractDriveFolderToken(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  const matched = text.match(/\/drive\/folder\/([^/?#]+)/i);
  return matched?.[1] || text;
}

function isSupportedKnowledgeDocType(type) {
  return new Set(["doc", "docx", "wiki"]).has(String(type || "").toLowerCase());
}

function joinKnowledgePath(prefix, name) {
  const normalizedName = String(name || "").trim();
  if (!prefix) return normalizedName;
  if (!normalizedName) return prefix;
  return `${prefix}/${normalizedName}`;
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
}

function buildCacheOptions(entry) {
  return {
    cacheFile: entry.cacheFile || process.env.LARK_DOCS_CACHE_FILE || path.resolve("tmp/lark-docs-cache.json"),
    cacheTtlMs: Number(entry.cacheTtlMs || process.env.LARK_DOCS_CACHE_TTL_MS || 3600000),
  };
}

async function readCacheEntry(options, key) {
  const cache = await readCacheFile(options.cacheFile);
  const entry = cache[key];
  if (!entry) return null;
  if ((Date.now() - Number(entry.savedAt || 0)) > Math.max(0, Number(options.cacheTtlMs || 0))) return null;
  return entry.value ?? null;
}

async function writeCacheEntry(options, key, value) {
  const cacheFile = options.cacheFile;
  const cache = await readCacheFile(cacheFile);
  cache[key] = {
    savedAt: Date.now(),
    value,
  };
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf8");
}

async function readCacheFile(cacheFile) {
  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeFileSegment(value) {
  return String(value || "unknown").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runLarkCliWithStdin(args, stdinText, options = {}) {
  const { timeoutMs = 30000, cwd = process.cwd(), windowsHide = true } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? process.execPath : "lark-cli", process.platform === "win32" ? resolveWindowsArgs(args) : args, {
      cwd,
      shell: false,
      windowsHide,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`lark-cli timed out after ${timeoutMs}ms: ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(String(stdinText || ""));
    child.stdin.end();
  });
}

function resolveWindowsArgs(args) {
  const appData = process.env.APPDATA || "";
  const userProfile = process.env.USERPROFILE || "";
  const candidates = [
    appData ? path.join(appData, "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js") : "",
    userProfile ? path.join(userProfile, "AppData", "Roaming", "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js") : "",
  ].filter(Boolean);
  const runJs = candidates.find((file) => fsSync.existsSync(file));
  return runJs ? [runJs, ...args] : ["-e", "process.exit(1)"];
}
