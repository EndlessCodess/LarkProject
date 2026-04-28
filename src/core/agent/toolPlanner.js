export function buildToolPlan(rule, event) {
  if (!rule?.tool_plan) return null;

  const variables = extractVariables(event?.text || "");
  const unresolved = [];
  const command = interpolateTemplate(rule.tool_plan.command_template || "", variables, unresolved);

  return {
    ...rule.tool_plan,
    command,
    commandArgs: splitCommand(command),
    variables,
    unresolved,
    executable: isExecutable(rule.tool_plan, unresolved, command),
    safety: classifySafety(rule.tool_plan),
  };
}

function extractVariables(text) {
  const serviceResourceMethod = extractServiceResourceMethod(text);
  return {
    missing_scope: extractMissingScope(text),
    wiki_token: extractToken(text, /\/wiki\/([A-Za-z0-9_-]+)/),
    doc_url_or_token: extractToken(text, /(https?:\/\/\S+\/docx\/[A-Za-z0-9_-]+)/),
    base_token: extractToken(text, /(?:base[_-]?token|app_token)[=:"'\s]+([A-Za-z0-9_-]+)/i),
    table_id: extractToken(text, /(?:table[_-]?id|tbl)[=:"'\s]+([A-Za-z0-9_-]+)/i),
    service_resource_method: serviceResourceMethod,
    service_resource: serviceResourceMethod ? serviceResourceMethod.split(".").slice(0, 2).join(".") : "",
    service: extractServiceVerb(text).service,
    verb: extractServiceVerb(text).verb,
  };
}

function extractMissingScope(text) {
  const patterns = [
    /(?:missing scope|scope required|scope)[:=\s"']+([A-Za-z0-9_:.-]+)/i,
    /permission_violations[^A-Za-z0-9_:.-]+([A-Za-z0-9_:.-]+:[A-Za-z0-9_:.-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function extractToken(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.replace(/[),.;'"`]+$/, "") || "";
}

function extractServiceResourceMethod(text) {
  const direct = text.match(/\b([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\b/i);
  if (direct?.[1]) return direct[1];

  const cliTriplet = text.match(/lark-cli\s+([a-z][a-z0-9_-]*)\s+([a-z][a-z0-9_.-]*)\s+([a-z][a-z0-9_-]*)/i);
  if (cliTriplet?.[1] && cliTriplet?.[2] && cliTriplet?.[3] && !cliTriplet[2].startsWith("+")) {
    return `${cliTriplet[1]}.${cliTriplet[2].replace(/-/g, "_")}.${cliTriplet[3].replace(/-/g, "_")}`;
  }

  return "";
}

function extractServiceVerb(text) {
  const shortcut = text.match(/lark-cli\s+([a-z][a-z0-9_-]*)\s+(\+[a-z][a-z0-9_-]*)/i);
  if (shortcut) return { service: shortcut[1], verb: shortcut[2] };

  const service = text.match(/lark-cli\s+([a-z][a-z0-9_-]*)\b/i)?.[1] || "";
  return { service, verb: "" };
}

function interpolateTemplate(template, variables, unresolved) {
  return template.replace(/<([a-zA-Z0-9_.-]+)>/g, (placeholder, key) => {
    const normalizedKey = key.replace(/\./g, "_").replace(/-/g, "_");
    const value = variables[normalizedKey] || variables[key] || "";

    if (!value) {
      unresolved.push(key);
      return placeholder;
    }

    return value;
  });
}

function isExecutable(toolPlan, unresolved, command) {
  if (!toolPlan?.readonly || toolPlan?.requires_confirmation) return false;

  if (!unresolved.length) return true;

  return !hasUnresolvedPlaceholder(command);
}

function classifySafety(toolPlan) {
  if (!toolPlan) return "unknown";
  if (toolPlan.readonly && !toolPlan.requires_confirmation) return "readonly";
  if (toolPlan.requires_confirmation) return "confirmation_required";
  return "manual_review";
}

function hasUnresolvedPlaceholder(command) {
  return /<[a-zA-Z0-9_.-]+>/.test(command || "");
}

export function splitCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      if (quote) {
        current += "\\";
      }
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += "\\";
  if (current) parts.push(current);
  return parts;
}
