# Land the supplied hosted/runtime simplification patches onto the current hosted tree

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Land the supplied hosted/runtime simplification patches onto the current hosted tree without regressing the active hosted envelope cleanup lane or the earlier architecture-review split already staged in this task.
- Finish the hosted runner/storage simplification by moving pending dispatch payloads out of Durable Object SQL, centralizing canonical outbox payload policy, mirroring device-sync runtime snapshots into Cloudflare before wake enqueue, and making runner containers one-shot.

## Success criteria

- The earlier architecture-review split remains intact on the live tree.
- Hosted storage path ownership is centralized and user-scoped or transient R2 keys are opaque and key-rotation aware.
- Pending runner dispatch bodies are removed from plaintext Durable Object SQL and stored as encrypted R2 payload blobs addressed by `payload_key`.
- Device-sync wake publishing mirrors the latest runtime snapshot into Cloudflare before the minimal wake is enqueued, and hydration no longer rebuilds that snapshot during drain.
- The shared hosted outbox payload policy is canonical in `packages/hosted-execution`, Cloudflare reuses it, and `gateway.message.send` remains inline while `member.activated`, `device-sync.wake`, and `vault.share.accepted` stay reference-first.
- Runner containers tear down after every invocation, matching docs.
- Required verification, final audit pass, and scoped commit are completed or any unrelated blockers are documented precisely.

## Scope

- In scope:
- `agent-docs/index.md`
- `docs/architecture-review-2026-04-04.md`
- `apps/cloudflare/{README.md,src/{bundle-store.ts,crypto-context.ts,dispatch-payload-store.ts,execution-journal.ts,index.ts,outbox-delivery-journal.ts,runner-container.ts,storage-paths.ts,user-runner.ts,worker-contracts.ts},src/user-runner/{runner-bundle-sync.ts,runner-queue-schema.ts,runner-queue-state.ts,runner-queue-store.ts,runner-user-env.ts,types.ts},test/{runner-bundle-helpers.test.ts,runner-queue-confidentiality.test.ts,runner-queue-store.test.ts,storage-path-rotation.test.ts,storage-paths.test.ts}}`
- `apps/web/src/lib/{device-sync/wake-service.ts,hosted-execution/hydration.ts}`
- `packages/{assistant-core/src/health-registry-command-metadata.ts,cli/test/health-descriptors.test.ts,hosted-execution/src/{client.ts,outbox-payload.ts,routes.ts},hosted-execution/test/{member-activated-outbox-payload.test.ts,outbox-payload.test.ts}}`
- Out of scope:
- Further decomposition of `HostedUserRunner.runQueuedEvents`
- Broader `apps/web` device-sync control-plane refactors beyond the wake snapshot handoff
- Reverting or restaging unrelated dirty-tree edits in overlapping hosted files

## Constraints

- Technical constraints:
- Port the supplied patch intent onto current dirty files rather than applying snapshot-era hunks blindly.
- Preserve active envelope-lock work and the earlier runner user-env ownership split already present in `apps/cloudflare/src/user-runner.ts`.
- Resolve the two supplied patches' payload-policy conflict in favor of the long-term design: keep `gateway.message.send` inline while still making the shared payload policy canonical and Cloudflare-owned code reuse it.
- Do not broaden into the separate hosted web-control cleanup lane or unrelated hosted-web route deletions already in flight elsewhere.
- Product/process constraints:
- Follow the high-risk repo workflow: coordination ledger, plan, required verification, final audit pass, and scoped commit.
- Do not expose sensitive identifiers in docs, code comments, commit messages, or handoff text.

## Risks and mitigations

1. Risk: queue-schema and queue-store changes could strand existing pending dispatch rows or break recovery semantics.
   Mitigation: recreate the pending-events table only when the old `dispatch_json` layout is present, keep malformed-payload poisoning behavior, and add focused queue regression coverage.
2. Risk: patch-era `user-runner.ts` wiring could clobber the active envelope-lock fix or the earlier user-env ownership split.
   Mitigation: merge only the new dispatch-payload and device-sync snapshot methods onto the current live file, then re-read before verification.
3. Risk: the supplied patches disagree on `gateway.message.send` storage, and choosing the wrong behavior would regress reconstructability assumptions.
   Mitigation: keep `gateway.message.send` inline, add explicit payload-policy tests, and make Cloudflare call the shared helper rather than maintaining a local switch.

## Tasks

1. Update the ledger/plan and reconcile the supplied hosted/runtime patches against the current dirty tree.
2. Land the combined Cloudflare storage, queue, one-shot container, and control-route changes onto the live hosted runner files.
3. Land the web-side device-sync wake publishing simplification and the shared hosted outbox payload policy cleanup.
4. Add or update the focused docs and regression coverage for storage paths, queue confidentiality, and payload policy.
5. Run required verification, complete the mandatory final audit pass, then close the plan and create a scoped commit.

## Decisions

- Treat the supplied patches as behavioral intent only; overlapping hosted files must be merged onto the live tree, not reset to the patch base.
- Keep `gateway.message.send` inline in the canonical shared payload-policy helper because it is not reconstructable from a source record without adding a new reference source.
- Keep the already-deleted dead hosted web outbox-drain route out of scope; that cleanup belongs to the separate active hosted-envelope lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused package/app tests as needed while iterating
- Expected outcomes:
- Required commands pass, or any unrelated pre-existing failures are documented with specific failing targets and why this diff did not cause them.
- Results:
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/runner-queue-confidentiality.test.ts apps/cloudflare/test/storage-paths.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/runner-queue-store.bundle-slots.test.ts` passed after test-only fixes for async payload seeding and the new payload-blob write count.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/device-sync-hosted-wake-dispatch.test.ts test/hosted-execution-hydration.test.ts` passed after updating expectations to the new transaction and snapshot-mirroring boundaries.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/outbox-payload.test.ts test/member-activated-outbox-payload.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test` still fails for the pre-existing web mismatch in `apps/web/test/device-sync-settings-routes.test.ts` where the expected headline is `"Connected and syncing normally"` but the current behavior returns `"Connected"`.
- `pnpm test:coverage` surfaced the same pre-existing `apps/web/test/device-sync-settings-routes.test.ts` failure before the full coverage pipeline could complete cleanly.
- Required audit follow-up found and fixed two rollout hazards in the queue/payload migration path plus one malformed-legacy-row resilience gap; the final focused Cloudflare audit recheck returned no remaining findings.
Completed: 2026-04-05
