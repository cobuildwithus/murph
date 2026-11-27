import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { getPrisma } from "../../src/lib/prisma";
import { buildClinicalRetrievalWakeEventId } from "../../src/lib/clinical-records/retrieval";
import { readHostedMailboxItemByDedupeKey, readHostedMailboxWakeByDedupeKey } from "../../src/lib/hosted-mailbox/store";
import { ensureHostedWorkspace } from "../../src/lib/hosted-workspace/store";
import { claimHostedRuntime } from "../../src/lib/hosted-execution/runtime-owner";
import { checkpointHostedRuntimeWorkspace } from "../../src/lib/hosted-workspace/runtime-publication";
import { createClinicalRuntimeRoutePort } from "../../test/support/clinical-runtime-routes";
import { parseHostedExecutionBundleRef } from "@murphai/runtime-state/node";
import { check, cleanEnv, safeCounts } from "./policy";

export async function importGeneration(memberId: string, dir: string, generation: number, capture = false) {
  const prisma = getPrisma();
  const run = await prisma.clinicalRecordRetrievalRun.findFirstOrThrow({ where: { memberId, generation } });
  const lookup = { userId: memberId, dedupeKey: buildClinicalRetrievalWakeEventId({ runId: run.id, generation }) };
  const item = await readHostedMailboxItemByDedupeKey(lookup);
  const wake = await readHostedMailboxWakeByDedupeKey(lookup);
  check(item && wake?.kind === "clinical-records.sync-requested");
  const current = await ensureHostedWorkspace({ userId: memberId });
  const lease = await claimHostedRuntime({ prisma, userId: memberId, processingMode: "default" });
  check(lease.status !== "blocked" && lease.owner.attemptId);
  const runtimeAuthority = { attemptId: lease.owner.attemptId, generation: String(lease.owner.generation), workspaceVersion: String(current.version) };
  const port = await createClinicalRuntimeRoutePort(memberId, runtimeAuthority, (k, v) => { process.env[k] = v; });
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "null");
      let result;
      switch (req.url) {
        case "/wake": result = { item, wake, connection: run.connectionId }; break;
        case "/readRun": result = await port.readRun(body); break;
        case "/fetchPage": result = await port.fetchPage(body); break;
        case "/fetchDocument": result = await port.fetchDocument(body); break;
        case "/recordOutcome": await port.recordOutcome(body); result = true; break;
        case "/publish": {
          const snapshotRef = parseHostedExecutionBundleRef(body);
          check(snapshotRef && !((await prisma.clinicalRecordRetrievalRun.findUniqueOrThrow({ where: { id: run.id } })).completedAt));
          const published = await checkpointHostedRuntimeWorkspace({ userId: memberId, runtimeAuthority,
            expectedVersion: current.version, reason: "system_mailbox_receipt", snapshotRef });
          check(published.status === "updated");
          result = parseHostedExecutionBundleRef((await ensureHostedWorkspace({ userId: memberId })).snapshotRef);
          break;
        }
        default: throw new Error("Unknown proof operation.");
      }
      res.end(JSON.stringify(result));
    } catch { res.writeHead(500).end(); }
  });
  // Darwin limits sockaddr_un to 104 bytes, including the directory.
  const socketDir = await mkdtemp("/tmp/clinical-port-");
  const socket = join(socketDir, "runtime.sock");
  try {
    server.listen(socket);
    await once(server, "listening");
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const worker = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config",
      "apps/web/scripts/epic-proof/vitest.config.ts", "--maxWorkers=1", "--no-file-parallelism", "runtime.scenario.ts"], { cwd: root,
      env: { ...cleanEnv(), MURPH_E2E_ASSISTANT_PROVIDER_MODE: "stub", NODE_ENV: "test", PROOF_DIR: dir,
        PROOF_SOCKET: socket, PROOF_CAPTURE: capture ? "1" : "0", PROOF_GENERATION: String(generation) }, timeout: Math.max(1, Number(process.env.PROOF_DEADLINE ?? Date.now() + 120_000) - Date.now()), stdio: "ignore" });
    const stop = () => { worker.kill(); };
    process.once("exit", stop);
    process.once("SIGTERM", stop);
    try { check((await once(worker, "exit"))[0] === 0); } finally { process.off("exit", stop); process.off("SIGTERM", stop); }
    const saved = await prisma.clinicalRecordRetrievalRun.findUniqueOrThrow({ where: { id: run.id } });
    check(saved.completedAt);
    return { saved, counts: safeCounts(JSON.parse(await readFile(join(dir, "counts.json"), "utf8"))) };
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(socketDir, { recursive: true, force: true }); }
}
