export function matchKnowledge(event, knowledgeItems) {
  const text = (event.text || "").toLowerCase();

  for (const item of knowledgeItems) {
    for (const keyword of item.keywords || []) {
      if (text.includes(String(keyword).toLowerCase())) {
        return { ...item, _matchedKeyword: keyword };
      }
    }
  }

  return null;
}
