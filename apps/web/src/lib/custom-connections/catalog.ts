import { createHash } from "node:crypto";
import * as z from "@murphai/contracts/zod-runtime";
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

/** Object keys sorted; array order and JSON types kept. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}
// Each approved definition rides in every eligible turn; the member sees only its title and description.
const TOOL_DEFINITION_MAX_BYTES = 24_576;
const APPROVED_SNAPSHOT_MAX_BYTES = 65_536;
function definitionBytes(definition: ToolDefinition): number {
  return Buffer.byteLength(canonical(definition));
}
/**
 * What a definition lets Murph do, derived from the definition every time. A server's `readOnlyHint: true` is
 * trusted as a read; anything else changes things and runs only after the member confirms it.
 */
export function toolKind(definition: ToolDefinition): "read" | "write" | "oversized" {
  if (definitionBytes(definition) > TOOL_DEFINITION_MAX_BYTES) return "oversized";
  return definition.annotations?.readOnlyHint === true ? "read" : "write";
}
/**
 * A stored state as this Web reads it. Older Web locked every write as not_allowed, so an eligible locked tool
 * reads as off, never on; an oversized one stays locked however it was stored.
 */
function currentState(tool: StoredTool): StoredTool["state"] {
  if (toolKind(tool.definition) === "oversized") return "not_allowed";
  return tool.state === "not_allowed" ? "off" : tool.state;
}
export function normalizeTools(tools: StoredTool[]): StoredTool[] {
  return tools.map((tool) => ({ ...tool, state: currentState(tool) }));
}
/** The named tool if the member has it on now. */
export function approvedTool(tools: StoredTool[], name: string): StoredTool | undefined {
  return tools.find((tool) => tool.definition.name === name && currentState(tool) === "on");
}
/**
 * What the gateway serves for an approved tool. Calling a write only asks the member, so its declaration keeps
 * the name and input schema, leads with what calling it does, and drops the remote output schema and execution hints.
 */
function servedDefinition(definition: ToolDefinition, server: string): ToolDefinition {
  if (toolKind(definition) !== "write") return definition;
  const first = `Changes things in ${server}. Calling this doesn't do it yet: it returns a link for the member to confirm on a Murph page. Send them the link and say what it will do. Calling again with the same inputs tells you whether it happened.`;
  return {
    name: definition.name, ...(definition.title === undefined ? {} : { title: definition.title }),
    description: definition.description ? `${first}\n\n${definition.description}` : first, inputSchema: definition.inputSchema,
  };
}
/** Exactly what the gateway serves; the catalog token is its digest. */
export function approvedSnapshot(tools: StoredTool[], server: string): ToolDefinition[] {
  return tools.filter((tool) => currentState(tool) === "on").map((tool) => servedDefinition(tool.definition, server))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    const state = toolKind(definition) === "oversized" ? "not_allowed"
      : old?.digest === hash ? currentState(old)
      : old?.state === "on" || old?.state === "needs_look" ? "needs_look" : "off";
    return { definition, digest: hash, state };
  });
}
export function approveTools(tools: StoredTool[], choices: Record<string, boolean>, server: string): StoredTool[] {
  for (const [name, enabled] of Object.entries(choices)) {
    const tool = tools.find((item) => item.definition.name === name);
    if (!tool || (enabled && toolKind(tool.definition) === "oversized")) throw new ConnectionError("not_mcp");
  }
  const next = normalizeTools(tools).map((tool) => Object.hasOwn(choices, tool.definition.name) && tool.state !== "not_allowed"
    ? { ...tool, state: choices[tool.definition.name] ? "on" as const : "off" as const }
    : tool);
  if (approvedSnapshot(next, server).reduce((total, definition) => total + definitionBytes(definition), 0) > APPROVED_SNAPSHOT_MAX_BYTES) {
    throw new ConnectionError("limit");
  }
  return next;
}
