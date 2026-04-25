import { runLarkCli } from "../lark-cli/runner.js";
import { normalizeCloudKnowledgeItems } from "../../core/knowledge/cloudKnowledgeNormalizer.js";

export async function loadLarkDocsKnowledge({ docs, timeoutMs }) {
  const documents = [];

  for (const doc of docs) {
    const fetched = await fetchLarkDoc(doc, { timeoutMs });
    documents.push(fetched);
  }

  return normalizeCloudKnowledgeItems(documents);
}

async function fetchLarkDoc(doc, { timeoutMs }) {
  const args = buildDocsFetchArgs(doc);
  const result = await runLarkCli(args, { timeoutMs });

  if (result.code !== 0) {
    throw new Error(`lark-cli docs fetch failed (${result.code}): ${result.stderr || result.stdout}`);
  }

  return {
    id: doc.id || doc.url || doc.token,
    url: doc.url || doc.token,
    content: extractDocumentText(result.stdout),
    raw: result.stdout,
  };
}

function buildDocsFetchArgs(doc) {
  const target = doc.url || doc.token;
  if (!target) {
    throw new Error("lark-docs knowledge source requires doc.url or doc.token");
  }

  const args = [
    "docs",
    "+fetch",
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
