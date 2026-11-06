# Preserve new device wakes during restored completion replay

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariant

Outcome: restore prompt wearable imports after a fresh device wake.
Reaches: system-mailbox and default invocations restoring a recording journal,
including empty acknowledgements and retained future provider jobs.
Proof: replay the old completion, run one bounded new pass, persist canonical
sleep records, then acknowledge the new payload after exactly one idle snapshot.

## Cause and correction

Restored completion retention reused the old admission to defer and retire new
webhook hints. Default mode also tried admission before replay without retrying
after the recording owner stopped blocking it. Existing mailbox owners remain
canonical; mark replay at the existing preparation boundary, restrict hint
transfer to fresh recording, and kick ordinary admission after initial replay. Join that bounded work with
the existing foreground-interruptible wait before idle shutdown can cancel it.
No schema, dependency, external API, scheduler, or new durable state is needed.
Future job retry times, foreground priority, and durable-before-ack ordering
remain protected. Failed replay remains pending under the existing retry owner.

## Scope and verification

Local fix and commit only; no push, PR, deployment, or production mutation.
Use synthetic fixtures; read-only production evidence stays outside artifacts.
Run the single-snapshot regression first on unchanged origin/main, then with the
fix. Preserve all nine original cases and add both-mode new-wake cases covering
empty/staged acks and retained future jobs. Run the requested wake convergence,
concurrent import, interrupted recording, projection, workspace-entrypoint,
idle retirement, device-sync runtime and cold-ingest suites. Also run direct
mailbox retention coverage, runtime typecheck and complexity diff.
Review the final diff and archive this plan before scripts/committer.

## Delivery and product review

No model prompt, tool, interpretation, or reply changes; deterministic runtime
proof is the acceptance boundary. Public changelog and external PR review are
outside this local, unshipped candidate. Existing wire and snapshot formats
remain compatible in either deployment order. Deploy verification must check
new wakes produce passes and dirty payloads drain; no deployment is authorized.

## Results

Final regression against unchanged origin/main: five new cases failed because
only the old completion was recorded; the fresh pass never started. All 17
single-snapshot cases pass with the fix, preserving the original nine. Synthetic
provider I/O outlives the idle floor to prove the default-mode completion wait.
The full requested suite set plus continuation, hint-coverage and direct mailbox
coverage passed: 31 files, 1,002 tests. Prepared runtime build, assistant-runtime
typecheck, complexity diff against origin/main, and git diff --check passed.
Source change: 27 added, 11 deleted, net +16 lines across two files. Complexity
debt is unchanged. Parent review confirms replay cannot transfer new hints,
retained future jobs keep their deadlines, and the bounded pass stays interruptible
for foreground work. No schema changes or extra idle snapshots. Product UX: Ready.
Authored-content privacy scan passed; no task-owned friction entry was needed.
Completed: 2026-11-02
