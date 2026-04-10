# Land watched security audit follow-up patch

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Land the applicable changes from the watched `murph-security-audit.patch` so local control-plane routes fail closed on proxied or non-loopback host headers, deletion artifacts stop persisting raw provider payloads, and parser subprocesses inherit only a minimal safe environment.

## Success criteria

- `packages/assistantd` control requests require loopback remote address, no forwarded headers, a loopback `Host`, and a valid bearer token.
- `packages/device-syncd` control requests enforce the same forwarded-header and loopback-`Host` guard, and Oura hosted delete hints plus device-sync delete markers stay metadata-only.
- `packages/importers` deletion artifacts persist only provider/resource/timestamp metadata, and deleted Oura sleep records no longer keep the full deleted artifact payload.
- `packages/parsers` child-process execution uses an allowlisted environment instead of inheriting ambient secrets.
- Required verification and repo audit flow complete, or unrelated blockers are identified precisely.

## Scope

- In scope:
- `packages/assistantd/src/http.ts`
- `packages/assistantd/test/http.test.ts`
- `packages/device-syncd/src/{hosted-hints.ts,http.ts,providers/oura.ts}`
- `packages/device-syncd/test/http.test.ts`
- `packages/importers/src/device-providers/{garmin.ts,oura.ts,shared-normalization.ts,whoop.ts}`
- `packages/importers/test/device-providers/deletion-normalization.test.ts`
- `packages/parsers/src/shared.ts`
- `packages/parsers/test/shared.test.ts`
- Out of scope:
- New security findings outside the downloaded patch.
- Broader replay/idempotency state-machine changes mentioned as residual concerns in the watched thread.

## Constraints

- Technical constraints:
- Preserve unrelated dirty `apps/web`, `package.json`, and `pnpm-lock.yaml` edits already in the worktree.
- Treat the downloaded patch as intent, not overwrite authority; merge against the current repo layout and existing tests.
- Product/process constraints:
- Follow the high-risk repo workflow: active ledger row, active plan, required verification, required audit passes, same-thread follow-up review request, wake re-arm, and scoped commit.

## Risks and mitigations

1. Risk: Existing `assistantd` and `device-syncd` HTTP test files already diverged from the patch's add-file shape.
   Mitigation: Integrate the new assertions into the live test files and adjust harness defaults only where the new host-header guard requires it.
2. Risk: The patch spans four owners with security-sensitive behavior changes.
   Mitigation: Keep the edits limited to the artifact's direct seams and use the required coverage-bearing verification lane plus audit review.
3. Risk: Existing active scheduler work also touches `packages/assistantd/**`.
   Mitigation: Keep the assistantd slice narrow to HTTP guard logic and preserve all unrelated nearby changes.

## Tasks

1. Register the bounded patch-landing lane in the coordination ledger and active plan.
2. Port the watched patch intent into the live assistantd, device-syncd, importers, and parsers files.
3. Add or adapt focused tests for the landed behavior in the current repo layout.
4. Run the required verification and audit flow, then send the required same-thread review request, arm the next wake hop, and commit the scoped changes.

## Decisions

- Reuse the existing daemon HTTP test files rather than forcing the patch's add-file layout.
- Add new focused test files for importers and parsers where the current repo has no equivalent coverage surface yet.
- Keep deletion artifacts metadata-only across providers rather than retaining raw delete payload copies for debugging.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/assistantd packages/device-syncd packages/importers packages/parsers`
- Expected outcomes:
- Green verification for the touched owners, or clearly separated unrelated blockers with evidence.

## Outcome

- Landed the watched security audit patch across assistantd, device-syncd, importers, and parsers.
- Tightened both local control planes so forwarded/proxy headers, repeated forwarded headers, malformed loopback-like `Host` values, and non-loopback `Host` headers all fail closed.
- Reduced Oura/device deletion retention to metadata-only artifacts and stopped carrying raw delete webhook payloads through hosted hints, device-sync execution, and importer artifacts.
- Restricted parser child-process env forwarding to an explicit allowlist and added focused proof for the scrubbed env behavior.
- Sent the required same-thread follow-up review prompt into the watched ChatGPT thread and armed the next recursive wake hop for depth `0`.

## Verification results

- FAIL (pre-existing unrelated blocker): `pnpm typecheck`
  `packages/cli/test/supplement-wearables-coverage.test.ts` reports `Property 'excerpt' does not exist on type '{ slug: string; markdown?: string | null | undefined; }'`. This diff does not touch `packages/cli`.
- FAIL (not used for handoff because dirty-tree fanout made it untruthful to this slice): `pnpm test:diff packages/assistantd packages/device-syncd packages/importers packages/parsers`
  The diff-aware lane expanded into unrelated dirty-tree owners and failed in `packages/assistant-engine` on missing `@murphai/contracts` plus a pre-existing `slug` property mismatch in cron automation types.
- PASS: `pnpm --dir packages/assistantd test:coverage`
- PASS: `pnpm --dir packages/device-syncd test:coverage`
- PASS: `pnpm --dir packages/importers test:coverage`
- PASS: `pnpm --dir packages/parsers test:coverage`
- PASS: rerun after final-review fixes
  - `pnpm --dir packages/assistantd test:coverage`
  - `pnpm --dir packages/device-syncd test:coverage`
- PASS: direct proof via `pnpm exec tsx --eval ...`
  Confirmed assistantd forwarded-header rejection, metadata-only deleted-sleep artifact output, and parser env scrubbing outside Vitest.

## Audit results

- PASS: required `coverage-write` audit on `gpt-5.4-mini`
  No additional tests or proof scaffolding were needed beyond the landed coverage and direct proof.
- PASS after fixes: required final review
  - Fixed duplicate forwarded-header arrays bypassing the proxy-header rejection in assistantd/device-syncd.
  - Fixed malformed loopback-like `Host` values such as userinfo-style `foo@localhost:...` / `foo@127.0.0.1:...` bypassing the loopback-host guard.
Completed: 2026-04-10
