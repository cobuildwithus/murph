export function readHostedOpenAiImageRequest(
  data: ArrayBuffer | string,
): "image" | "other" | "invalid" {
  let value: unknown;
  try {
    value = JSON.parse(typeof data === "string"
      ? data
      : new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    return "invalid";
  }
  if (!isObject(value)) return "invalid";
  const tools = Array.isArray(value.tools) ? value.tools : [];
  return tools.some(isImageTool) || isImageTool(value.tool_choice)
    ? "image"
    : "other";
}

function isImageTool(value: unknown): boolean {
  return isObject(value) && value.type === "image_generation";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
