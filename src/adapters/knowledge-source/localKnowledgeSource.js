import { readJsonFile } from "../../core/io.js";

export async function loadLocalKnowledge({ path }) {
  const kb = await readJsonFile(path);
  return normalizeKnowledgeBase(kb, { sourceType: "local", sourcePath: path });
}

function normalizeKnowledgeBase(kb, meta) {
  return {
    version: kb.version || "0.1.0",
    description: kb.description || "Local knowledge rules",
    items: kb.items || [],
    meta,
  };
}
