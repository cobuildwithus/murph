import { assessCheckpointRecovery } from "./checkpoint-recovery-assessment.ts";

try {
  const partial = process.env.RECOVERY_MODE === "prepare-partial" || process.env.RECOVERY_MODE === "recover-partial";
  const result = partial ? await (await import("./checkpoint-recovery-publish.ts")).publishPartialCheckpointRecovery(process.env)
    : await assessCheckpointRecovery(process.env, fetch, progress => console.log(JSON.stringify(progress)));
  console.log(JSON.stringify(result));
} catch {
  // Remote errors can contain private content, paths or signed URLs.
  console.error(JSON.stringify({ ok: false, reason: "checkpoint_recovery_failed", runtimeProgressVerified: false }));
  process.exitCode = 1;
}
