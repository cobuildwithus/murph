// Node-only probe of the candidate's own Codex request serializer. Bodies are
// synthetic and transient. Only the digest leaves the container.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { DEPLOY_MODEL_ADMISSION_PROBES, readDeployLiveModelTurnSmokeRequest, type DeployAdmissionTier } from "./deploy-smoke-live-model.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

function normalizeClientMetadata(metadata: Record<string, unknown>) {
  for (const field of ["root_turn_id", "session_id", "thread_id", "turn_id", "x-codex-installation-id", "x-codex-window-id",
    "installation_id", "window_id", "context_window_id"]) {
    const value = metadata[field];
    if (typeof value === "string") metadata[field] = value.replace(uuid, "UUID");
  }
  if (typeof metadata.turn_started_at_unix_ms === "number") metadata.turn_started_at_unix_ms = 0;
  const turn = metadata["x-codex-turn-metadata"];
  if (typeof turn === "string") {
    const data = JSON.parse(turn);
    normalizeClientMetadata(data);
    metadata["x-codex-turn-metadata"] = data;
  }
}

export function modelRequestDigest(raw: string, probe: { model: string; serviceTier: DeployAdmissionTier }): string {
  const parsed = readDeployLiveModelTurnSmokeRequest(raw);
  if (!parsed?.web || parsed.model !== probe.model || parsed.serviceTier !== probe.serviceTier
    || (probe.serviceTier === "default" && !parsed.image)) throw new Error("Unexpected local admission request.");
  const request = JSON.parse(raw);
  // Keep the entire model/tool configuration, every tool schema, image and
  // message. Normalize only per-launch provenance from the synthetic harness.
  if (request.client_metadata) normalizeClientMetadata(request.client_metadata);
  if (typeof request.prompt_cache_key === "string") request.prompt_cache_key = request.prompt_cache_key.replace(uuid, "UUID");
  for (const item of request.input) {
    if (typeof item.id === "string") item.id = item.id.replace(uuid, "UUID");
    if (item.internal_chat_message_metadata_passthrough) {
      normalizeClientMetadata(item.internal_chat_message_metadata_passthrough);
      if (typeof item.internal_chat_message_metadata_passthrough.create_time === "number") item.internal_chat_message_metadata_passthrough.create_time = 0;
    }
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === "input_text" && typeof content.text === "string") {
          content.text = content.text.replace(/hosted-codex-shell-smoke-[a-zA-Z0-9]{6}(?=\/)/gu, "hosted-codex-shell-smoke-TEMP");
        }
      }
    }
  }
  return digest(JSON.stringify(request, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
}

export async function measureModelRequestContract(run: (probe: typeof DEPLOY_MODEL_ADMISSION_PROBES[number], baseUrl: string) => Promise<unknown>): Promise<string> {
  let observed: string | null = null;
  let probe = DEPLOY_MODEL_ADMISSION_PROBES[0]!;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/v1/responses" || observed) throw new Error("Unexpected capture");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error("Capture exceeds request limit");
        chunks.push(chunk);
      }
      observed = modelRequestDigest(Buffer.concat(chunks).toString("utf8"), probe);
    } catch { observed = "invalid"; }
    // Terminal local response. A captured request is never a live admission.
    res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":{"message":"local shape check"}}');
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const samples: string[] = [];
    for (probe of DEPLOY_MODEL_ADMISSION_PROBES) {
      observed = null;
      try { await run(probe, url); } catch { /* The local endpoint always rejects. */ }
      if (!observed || observed === "invalid") throw new Error("Incomplete native admission capture.");
      samples.push(observed);
    }
    return digest(JSON.stringify(samples));
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
