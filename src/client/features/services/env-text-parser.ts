export type ParsedEnvEntry = {
  key: string;
  value: string;
};

function parseEnvValue(input: string) {
  let value = input.trim();
  const quote = value[0];

  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
    if (quote === "\"") {
      value = value.replace(/\\([\\nrt"])/g, (_match, escaped: string) => {
        if (escaped === "n") return "\n";
        if (escaped === "r") return "\r";
        if (escaped === "t") return "\t";
        return escaped;
      });
    }
    return value;
  }

  const inlineComment = value.search(/\s+#/);
  return inlineComment >= 0 ? value.slice(0, inlineComment).trimEnd() : value;
}

export function parseEnvText(input: string): ParsedEnvEntry[] {
  const byKey = new Map<string, string>();

  for (const rawLine of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;

    byKey.set(key, parseEnvValue(normalized.slice(separatorIndex + 1)));
  }

  return Array.from(byKey.entries()).map(([key, value]) => ({ key, value }));
}

export function invalidEnvLineNumbers(input: string) {
  const invalidLines: number[] = [];

  input.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    const key = separatorIndex > 0 ? normalized.slice(0, separatorIndex).trim() : "";
    const value = separatorIndex > 0 ? normalized.slice(separatorIndex + 1).trim() : "";
    const startsWithQuote = value.startsWith("\"") || value.startsWith("'");
    const hasMatchingQuote = !startsWithQuote || value.endsWith(value[0]);
    if (separatorIndex <= 0 || !/^[A-Z_][A-Z0-9_]*$/i.test(key) || !hasMatchingQuote) invalidLines.push(index + 1);
  });

  return invalidLines;
}

function formatEnvValue(value: string) {
  if (!value) return "";
  if (!/[\n\r\t]|^\s|\s$|\s#|^["'].*["']$/.test(value)) return value;

  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

export function formatEnvText(entries: ParsedEnvEntry[]) {
  return entries.map((entry) => `${entry.key}=${formatEnvValue(entry.value)}`).join("\n");
}
