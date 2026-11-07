# Device daemon launcher hygiene

Review packaging rejected the committed executable shim under the repository
JavaScript artifact policy before any prompt was submitted. Allow only the
exact device-syncd launcher path beside existing framework exceptions. The
shim must exist before compilation so pnpm can link it; it imports the same
compiled daemon entrypoint. Native TypeScript launchers cannot run beneath
installed node_modules. No broader artifact rule or runtime behavior changes.

Proof: source hygiene, focused hygiene tests, script typecheck, complexity
guard, and diff checks pass before publishing the corrected candidate.
The hygiene suite passes all 15 tests. The raw source-bundle guard still
rejects local build output as designed; ReviewGPT packages a guarded clean snapshot.
The first external review baseline will move because the prior attempt never
submitted a prompt or produced a substantive result.
Status: completed
Updated: 2026-10-01
Completed: 2026-10-01
