Goal (incl. success criteria):
- Fix the inbox CLI follow-up review findings without changing unrelated active lanes.
- Ensure canonical meal promotion idempotency survives local runtime loss, daemon cursor state uses connector-stable namespaces, connector aliases cannot collide onto the same runtime namespace, and `inbox init --rebuild` reports an uncapped count.
- Add regression tests for each corrected failure mode.

Constraints/Assumptions:
- Do not edit files or symbols owned by other active rows.
- Keep machine-local runtime state under `.runtime/**`; do not treat it as canonical truth.
- Canonical dedupe for promotion must survive cross-machine and local runtime reset scenarios.
- Repo-wide required checks may still be blocked by unrelated active lanes; record causal separation if that remains true.

Key decisions:
- Reuse canonical vault evidence instead of `.runtime` alone for meal promotion idempotency.
- Propagate connector runtime identity explicitly through daemon connector wiring instead of relying on source/account reconstruction later.
- Reject connector configurations that alias the same `(source, accountId)` runtime namespace under different ids.
- Count rebuild results from the full runtime set instead of a hard-coded listing cap.

State:
- done

Done:
- Claimed the follow-up inbox fix scope in the coordination ledger.
- Fixed meal promotion idempotency to derive from canonical meal manifests under `raw/meals/**/manifest.json` instead of local `.runtime` state alone.
- Passed connector ids explicitly into inboxd connector construction, aligned the local daemon connector contract with inboxd's real poll-connector shape, and added regression coverage for daemon id/account propagation.
- Rejected duplicate connector namespaces that alias the same `(source, accountId)` runtime identity under different ids.
- Removed the rebuild-count cap by counting runtime captures until the listing stops growing.
- Added regression tests for canonical promotion retry safety, post-`addMeal` local-store write failure recovery, connector namespace alias rejection, daemon connector identity forwarding, and uncapped rebuild reporting.
- Updated architecture/inboxd docs to clarify that canonical inbox promotion idempotency must come from vault evidence, not `.runtime`.
- Verification completed:
- Focused inbox TypeScript check passed.
- Focused inbox Vitest run passed with 20 tests.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` failed outside this slice on documented search smoke mismatches in the active search lane.

Now:
- Completed and ready for handoff.

Next:
- Follow up separately if the active search lane wants help clearing the remaining `pnpm test:coverage` smoke/doc mismatch.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: The current canonical meal dedupe fingerprint depends on meal-manifest artifact hashes plus occurredAt/note/source matching; if core later adds first-class inbox-promotion receipts, this CLI path should switch to them.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/completed/2026-03-13-inbox-followup-fixes.md`
- `packages/cli/src/inbox-services.ts`
- `packages/cli/src/commands/inbox.ts`
- `packages/cli/test/inbox-cli.test.ts`
- `ARCHITECTURE.md`
- `packages/inboxd/README.md`
- `agent-docs/index.md`
