export function matchKnowledge(event, knowledgeItems) {
  const text = (event.text || "").toLowerCase();
  const matches = [];

  for (const item of knowledgeItems) {
    for (const signal of item.when || item.keywords || []) {
      const normalizedSignal = String(signal).toLowerCase();
      if (normalizedSignal && text.includes(normalizedSignal)) {
        matches.push({ ...item, _matchedSignal: signal, _score: scoreMatch(item, signal, text) });
        break;
      }
    }
  }

  matches.sort((a, b) => b._score - a._score);
  return matches[0] || null;
}

function scoreMatch(item, signal, text) {
  const normalizedSignal = String(signal).toLowerCase();
  let score = Number(item.priority || 0) * 100;

  score += normalizedSignal.length;
  if (text.includes(normalizedSignal)) score += 10;
  if (normalizedSignal.includes(" ")) score += 5;
  if (normalizedSignal.includes("/") || normalizedSignal.includes("+")) score += 3;

  return score;
}
