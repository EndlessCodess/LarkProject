export function normalizeCloudKnowledgeItems(documents) {
  const items = [];

  for (const doc of documents) {
    const extracted = extractKnowledgeItemsFromText(doc.content || "", doc);
    items.push(...extracted);
  }

  return {
    version: "0.1.0",
    description: "Knowledge rules extracted from Lark cloud documents",
    items,
    meta: {
      sourceType: "lark-docs",
      documentCount: documents.length,
    },
  };
}

function extractKnowledgeItemsFromText(content, doc) {
  const blocks = splitRuleBlocks(content);

  return blocks.map((block, index) => ({
    id: `${doc.id || doc.url || "doc"}#rule-${index + 1}`,
    category: readField(block, "category") || "cloud_doc_rule",
    severity: readField(block, "severity") || "info",
    priority: Number(readField(block, "priority") || 50),
    when: readListField(block, "when"),
    diagnosis: readField(block, "diagnosis") || firstMeaningfulLine(block),
    route_to_skills: readListField(block, "route_to_skills"),
    suggested_actions: readListField(block, "suggested_actions"),
    next_command_template: readField(block, "next_command_template") || "",
    source: doc.url || doc.source || "lark-doc",
  })).filter((item) => item.when.length > 0 && item.diagnosis);
}

function splitRuleBlocks(content) {
  const blocks = content
    .split(/\n---+\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.length ? blocks : [content.trim()].filter(Boolean);
}

function readField(block, name) {
  const pattern = new RegExp(`^${escapeRegExp(name)}\\s*:\\s*(.+)$`, "im");
  const matched = block.match(pattern);
  return matched?.[1]?.trim() || "";
}

function readListField(block, name) {
  const raw = readField(block, name);
  if (!raw) return [];
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstMeaningfulLine(block) {
  return block.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
