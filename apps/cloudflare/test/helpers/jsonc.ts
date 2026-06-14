// Line-comment + trailing-comma tolerant JSONC parse for the checked-in
// wrangler.jsonc scaffold in tests. Inline trailing comments are not
// supported and fail loudly at JSON.parse.
export function parseJsoncObject(rawConfig: string): Record<string, unknown> {
  return JSON.parse(
    rawConfig
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .replace(/,\s*([}\]])/gu, "$1"),
  ) as Record<string, unknown>;
}
