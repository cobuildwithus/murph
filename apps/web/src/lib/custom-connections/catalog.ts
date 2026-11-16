import { createHash } from "node:crypto";
import { z } from "zod";
import { ConnectionError } from "./errors";

export const toolDefinitionSchema = z.object({
  name: z.string().min(1).max(128), title: z.string().max(512).optional(),
  description: z.string().max(16384).optional(),
  inputSchema: z.object({ type: z.literal("object") }).catchall(z.unknown()),
  annotations: z.object({ readOnlyHint: z.boolean().optional() }).catchall(z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
const storedToolSchema = z.object({
  definition: toolDefinitionSchema, digest: z.string(),
  state: z.enum(["on", "off", "needs_look", "not_allowed"]),
});
export const storedToolsSchema = z.array(storedToolSchema).max(100);
export type StoredTool = z.infer<typeof storedToolSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}
export function approvedSnapshot(tools: StoredTool[]): ToolDefinition[] {
  return tools.filter((tool) => tool.state === "on" && tool.definition.annotations?.readOnlyHint === true)
    .map((tool) => tool.definition).sort((a, b) => a.name.localeCompare(b.name));
}
export function reconcileTools(previous: StoredTool[], definitions: unknown[]): StoredTool[] {
  if (definitions.length > 100) throw new ConnectionError("limit");
  const names = new Set<string>();
  return definitions.map((raw) => {
    // The snapshot owns only protocol tool declaration fields, never provider metadata.
    const parsed = toolDefinitionSchema.strip().safeParse(raw);
    if (!parsed.success || names.has(parsed.data.name)) throw new ConnectionError("not_mcp");
    const definition = parsed.data;
    names.add(definition.name);
    const hash = digest(definition);
    const old = previous.find((tool) => tool.definition.name === definition.name);
    const state = definition.annotations?.readOnlyHint !== true ? "not_allowed"
      : old?.digest === hash ? old.state
      : old?.state === "on" || old?.state === "needs_look" ? "needs_look" : "off";
    return { definition, digest: hash, state };
  });
}
export function approveTools(tools: StoredTool[], choices: Record<string, boolean>): StoredTool[] {
  for (const [name, enabled] of Object.entries(choices)) {
    const tool = tools.find((item) => item.definition.name === name);
    if (!tool || (enabled && tool.definition.annotations?.readOnlyHint !== true)) throw new ConnectionError("not_mcp");
  }
  return tools.map((tool) => Object.hasOwn(choices, tool.definition.name)
    ? { ...tool, state: tool.state === "not_allowed" ? "not_allowed" : choices[tool.definition.name] ? "on" : "off" }
    : tool);
}
