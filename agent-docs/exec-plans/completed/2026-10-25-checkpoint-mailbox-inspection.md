# Protected read-only mailbox checkpoint inspection

## Outcome and invariant
Inspect bounded acknowledgement metadata in one authenticated accepted snapshot without running the assistant, waking a runtime, replaying work or changing product state. Private content and keys stay in protected temporary storage; only fixed metadata leaves the job. This is diagnosis, not historical recovery.

## Evidence and owner
A synthetic false acknowledgement floor can retire a terminal input from the current pending index; later correcting the floor does not restore it. Existing protected assessment inspects canonical artifacts, not this pending/terminal state. Extend its sealed assessment request and reuse the existing snapshot decrypt/restore, input, mapping and terminal-evidence readers. No new credential, endpoint or workflow authority.

## Design
Optional sealed mailbox inspection binds the distinct sealed request schema, workspace version, exact snapshot fingerprint and at most twelve exact item/input selectors. A missing input selector is explicitly uninspectable. Read the current workspace, resolve its existing runtime root, fetch only the exact immutable snapshot, inspect exact records in private scratch, and recheck unchanged workspace/fingerprint and request expiry before returning. No member identifiers or record contents in output. Bound archive, file and group reads; clean scratch and keys on every exit. Keep ordinary assess/validate/recovery behavior unchanged.

## Verification and release
Synthetic sealed-request, authenticated archive, exact-record, missing/incomplete evidence, source movement, expiry, malicious path/size and cleanup tests; existing recovery regression tests and relevant typecheck. Parent candidate/final review, required independent ReviewGPT and exact-head CI. Merge reader on protected public main before dispatching the existing private assessment job. This change adds no ordinary runtime protocol or product mutation. Read back the protected result and canonical unchanged state; any repair requires a separate decision.

## Progress
- Isolated checkout and approved scope established.
- Implementation and native candidate review complete. New inspector uses the sealed optional assessment request; private workflow unchanged. Exact canonical input selectors avoid history scanning.
- Seven new synthetic tests plus nineteen existing assessment/publication regressions pass; Cloudflare typecheck passes after normal local Prisma generation. Complexity passes (new inspector max14; artifact assessment max20 to17; no new debt; request validator maximum18). Docs drift and diff whitespace checked.
- Independent GPT-6 Pro round 1 PASS at the immutable first-reviewed source head; exact accepted turn, attachment and response identity captured after more than four minutes. Earlier too-fast and pre-send picker failures remain separate diagnostic attempts. No qualifying findings; native final review Ready.
- Implementation complete. Final documentation-only plan closure preserves all reviewed source/tests. Exact final-head CI and protected merge remain required before the approved operational inspection. Only public-key preparation has run; no snapshot inspection or production mutation yet. Operational result and any later repair decision remain with the existing incident owner.
Status: completed
Updated: 2026-10-25
Completed: 2026-10-25
