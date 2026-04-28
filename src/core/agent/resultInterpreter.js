export function interpretToolResult(result, context = {}) {
  const stdout = result?.stdout || "";
  const stderr = result?.stderr || "";
  const text = `${stdout}\n${stderr}`.trim();

  if (result?.error) {
    return classifyThrownError(result.error, context);
  }

  const parsed = parseFirstJson(stdout) || parseFirstJson(stderr);

  if (parsed?.ok === false || parsed?.error) {
    return interpretStructuredError(parsed, text, context);
  }

  if (looksLikeHelpOutput(text)) {
    return {
      status: "command_ok_help_returned",
      summary: summarizeText(text) || "命令存在，当前返回的是 help/usage 输出。",
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (result?.code && result.code !== 0) {
    return classifyTextFailure(text, result.code, context, parsed);
  }

  if (parsed?.ok === true) {
    return {
      status: "ok",
      summary: summarizeSuccess(parsed),
      dataHints: extractDataHints(parsed),
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  return {
    status: "ok",
    summary: summarizeText(text) || "命令已执行，未返回可解析的 JSON 摘要。",
    analysis: analyzeCliText(text, parsed),
    preflight: context.preflight || null,
  };
}

function classifyThrownError(error, context) {
  const message = error?.message || "工具执行失败。";

  if (/timed out/i.test(message)) {
    return {
      status: "command_ok_timeout",
      summary: message,
      preflight: context.preflight || null,
    };
  }

  if (/spawn .*ENOENT|not recognized as an internal or external command|command not found/i.test(message)) {
    return {
      status: "command_invalid",
      summary: message,
      preflight: context.preflight || null,
    };
  }

  return {
    status: "failed",
    summary: message,
    preflight: context.preflight || null,
  };
}

function interpretStructuredError(parsed, fallbackText, context) {
  const error = parsed.error || parsed;
  const type = error.type || error.code || "unknown";
  const message = error.message || error.msg || fallbackText;
  const normalizedType = String(type).toLowerCase();
  const normalizedMessage = String(message || "");

  if (normalizedType === "config" || /not configured/i.test(normalizedMessage)) {
    return {
      status: "needs_config",
      summary: "当前环境中的 lark-cli 尚未配置，需要执行 lark-cli config init --new。",
      preflight: context.preflight || null,
    };
  }

  if (/permission|scope|forbidden|unauthorized/i.test(normalizedMessage)) {
    return {
      status: "permission_required",
      summary: summarizeText(normalizedMessage) || "当前身份缺少权限或授权 scope。",
      preflight: context.preflight || null,
    };
  }

  if (/oauth\/token.*EOF|ECONNRESET|ETIMEDOUT|network|timeout|TLS|socket hang up/i.test(normalizedMessage)) {
    return {
      status: "command_ok_auth_failed",
      summary: summarizeText(normalizedMessage) || "命令已发出，但认证/网络链路失败。",
      analysis: analyzeCliText(fallbackText),
      preflight: context.preflight || null,
    };
  }

  if (/NOTEXIST|not exist|not found/i.test(normalizedMessage)) {
    return {
      status: "command_ok_resource_not_found",
      summary: summarizeText(normalizedMessage) || "命令已发出，但目标资源不存在。",
      analysis: analyzeCliText(fallbackText),
      preflight: context.preflight || null,
    };
  }

  if (
    normalizedType === "validation" ||
    normalizedType === "param_error" ||
    normalizedType === "params_error" ||
    /invalid format|invalid params|missing requestbody|missing required|validation|param/i.test(normalizedMessage)
  ) {
    return {
      status: "command_ok_api_failed",
      summary: summarizeText(normalizedMessage) || `命令已发出，但请求参数校验失败：${type}`,
      analysis: analyzeCliText(fallbackText, parsed),
      preflight: context.preflight || null,
    };
  }

  return {
    status: "command_ok_api_failed",
    summary: summarizeText(normalizedMessage) || `工具返回错误：${type}`,
    analysis: analyzeCliText(fallbackText, parsed),
    preflight: context.preflight || null,
  };
}

function classifyTextFailure(text, code, context, parsed) {
  const summary = summarizeText(text) || `命令退出码为 ${code}。`;

  if (looksLikeHelpOutput(text)) {
    return {
      status: "command_ok_help_returned",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (/Unknown service|unknown command|command not found|not recognized as an internal or external command/i.test(text)) {
    return {
      status: "command_invalid",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (/permission denied|missing scope|permission_violations|scope required/i.test(text)) {
    return {
      status: "permission_required",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (/oauth\/token.*EOF|ECONNRESET|ETIMEDOUT|network|timeout|TLS|socket hang up/i.test(text)) {
    return {
      status: "command_ok_auth_failed",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (/NOTEXIST|not exist|not found/i.test(text)) {
    return {
      status: "command_ok_resource_not_found",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  if (/invalid format|invalid params|missing requestbody|missing required|validation|param/i.test(text)) {
    return {
      status: "command_ok_api_failed",
      summary,
      analysis: analyzeCliText(text, parsed),
      preflight: context.preflight || null,
    };
  }

  return {
    status: "command_ok_api_failed",
    summary,
    analysis: analyzeCliText(text, parsed),
    preflight: context.preflight || null,
  };
}

function summarizeSuccess(parsed) {
  const hints = extractDataHints(parsed);
  if (hints.length) return `只读工具调用成功；${hints.join("；")}。`;
  return "只读工具调用成功。";
}

function extractDataHints(parsed) {
  const data = parsed?.data || parsed;
  const hints = [];
  const node = data?.node || data?.data?.node || data?.item || data;

  if (node?.obj_type) hints.push(`obj_type=${node.obj_type}`);
  if (node?.obj_token) hints.push(`obj_token=${node.obj_token}`);
  if (node?.token) hints.push(`token=${node.token}`);
  if (data?.markdown) hints.push("已读取 markdown 内容");

  return hints;
}

function analyzeCliText(text, parsed = null) {
  if (parsed) {
    const schemaAnalysis = analyzeSchemaJson(parsed);
    if (schemaAnalysis) return schemaAnalysis;
  }

  if (!text?.trim()) return null;

  const analysis = {};
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  const usageLine = lines.find((line) => /^Usage:/i.test(line.trim()));
  if (usageLine) {
    analysis.usage = usageLine.trim();
  }

  const flagLines = collectIndentedBlock(lines, /^Flags:/i);
  const flags = flagLines
    .map((line) => extractFlagName(line))
    .filter(Boolean);
  if (flags.length) {
    analysis.flags = flags;
  }

  const conclusions = [];
  if (analysis.usage) {
    conclusions.push(`环境实测可用法：${analysis.usage.replace(/^Usage:\s*/i, "")}`);
  }
  if (flags.length) {
    conclusions.push(`环境实测包含参数：${flags.slice(0, 8).join(", ")}`);
  }
  if (conclusions.length) {
    analysis.conclusions = conclusions;
  }

  return Object.keys(analysis).length ? analysis : null;
}

function collectIndentedBlock(lines, headerPattern) {
  const start = lines.findIndex((line) => headerPattern.test(line.trim()));
  if (start === -1) return [];

  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^[A-Za-z][A-Za-z\s]+:$/.test(line.trim())) break;
    block.push(line);
  }

  return block;
}

function extractFlagName(line) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(?:-[A-Za-z],\s*)?(--[A-Za-z0-9-]+)/);
  if (match?.[1]) return match[1];
  if (/^-h,\s*--help/.test(trimmed)) return "--help";
  return null;
}

function analyzeSchemaJson(parsed) {
  const root = parsed?.data || parsed;
  const methods = root?.methods || null;
  if (methods && typeof methods === "object") {
    return {
      kind: "schema_resource",
      conclusions: [`该 schema 返回 resource 级 methods：${Object.keys(methods).join(", ")}`],
    };
  }

  const parameters = Array.isArray(root?.parameters)
    ? root.parameters
    : root?.parameters && typeof root.parameters === "object"
      ? Object.entries(root.parameters).map(([name, item]) => ({ name, ...item }))
      : [];
  const requestBody = root?.requestBody || null;

  const paramsFields = parameters.map((item) => ({
    name: item.name,
    location: item.location,
    required: Boolean(item.required),
  }));

  const bodyFields = extractRequestBodyFields(requestBody);

  if (!paramsFields.length && !bodyFields.length) return null;

  const analysis = {
    kind: "schema",
    paramsFields,
    bodyFields,
    conclusions: [],
  };

  if (paramsFields.length) {
    analysis.conclusions.push(
      `应放入 --params：${paramsFields
        .map((item) => `${item.name}${item.required ? "(required)" : ""}${item.location ? `@${item.location}` : ""}`)
        .join(", ")}`,
    );
  }

  if (bodyFields.length) {
    analysis.conclusions.push(
      `应放入 --data：${bodyFields
        .map((item) => `${item.name}${item.required ? "(required)" : ""}`)
        .join(", ")}`,
    );
  }

  return analysis;
}

function extractRequestBodyFields(requestBody) {
  const schema = requestBody?.content?.["application/json"]?.schema || requestBody?.schema || requestBody || null;
  if (!schema || typeof schema !== "object") return [];

  if (!schema.properties && Object.keys(schema).length && !schema.type) {
    return Object.entries(schema).map(([name, item]) => ({
      name,
      required: Boolean(item?.required),
    }));
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties || {};

  return Object.keys(properties).map((name) => ({
    name,
    required: required.includes(name),
  }));
}

function parseFirstJson(text) {
  if (!text?.trim()) return null;

  const direct = tryParseJson(text);
  if (direct) return direct;

  for (const line of String(text)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const parsedLine = tryParseJson(line);
    if (parsedLine) return parsedLine;
  }

  const matches = String(text).match(/\{[\s\S]*\}/g) || [];
  for (const candidate of matches) {
    const parsedCandidate = tryParseJson(candidate);
    if (parsedCandidate) return parsedCandidate;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  return tryParseJson(text.slice(start, end + 1));
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");
}

function looksLikeHelpOutput(text) {
  return /(^|\n)Usage:/i.test(String(text || ""));
}
