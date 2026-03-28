Murph cleanup lane: deduplicate the repeated encrypted R2 envelope read and write plumbing in `apps/cloudflare` without changing key layout or record behavior.

Ownership:
- Own `apps/cloudflare/src/{bundle-store.ts,execution-journal.ts,outbox-delivery-journal.ts}` and `apps/cloudflare/src/crypto.ts` only if a minimal shared helper needs it.
- Own direct coverage in `apps/cloudflare/test/{index.test.ts,user-runner.test.ts}`.
- Do not edit `apps/cloudflare/src/index.ts` or `apps/cloudflare/test/index.test.ts` outside the direct storage-journal coverage you need; that router surface is already dirty from a separate active lane.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `apps/cloudflare/src/bundle-store.ts`: `createHostedBundleStore`
- `apps/cloudflare/src/execution-journal.ts`: `createHostedExecutionJournalStore`
- `apps/cloudflare/src/outbox-delivery-journal.ts`: `readRecordAtKey`, `writeRecordAtKey`
- `apps/cloudflare/src/crypto.ts`: underlying encrypt and decrypt helpers

Issue:
- Multiple Cloudflare storage modules repeat the same envelope mechanics:
  - `bucket.get(key)`
  - parse JSON envelope from R2
  - decrypt with `decryptHostedBundle`
  - optionally parse plaintext JSON
- The inverse write path is duplicated too:
  - serialize plaintext
  - encrypt with `encryptHostedBundle`
  - `JSON.stringify(envelope)`
  - `bucket.put(key, payloadText)`

Best concrete fix:
- Extract a tiny internal helper pair such as:
  - `readEncryptedR2Payload(bucket, key, cryptoKey) -> Uint8Array | null`
  - `writeEncryptedR2Payload(bucket, key, cryptoKey, keyId, plaintext)`
- Optionally add a JSON wrapper on top for the journal and outbox stores.
- Keep store-specific concerns local:
  - bundle hashing and ref metadata in `bundle-store.ts`
  - committed-result normalization in `execution-journal.ts`
  - `assistantChannelDeliverySchema` validation in `outbox-delivery-journal.ts`

Do not change:
- object key naming
- hash and ref behavior
- record schemas
- optional delete behavior on buckets
- externally visible worker response semantics

Tests to anchor:
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/user-runner.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
