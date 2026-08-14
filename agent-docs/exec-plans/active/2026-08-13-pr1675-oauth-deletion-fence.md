# PR 1675 provider setup completion fences

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

Close ReviewGPT's OAuth/deletion and terminal-recovery findings in the reusable
member-owned provider setup primitive without adding another state owner or
provider-specific automation layer.

## Success criteria

- OAuth start, state creation, and callback connection persistence cannot cross
  a persisted provider-application deletion fence.
- Callback-first and deletion-first races converge on one valid setup and
  connection state under the existing hosted-member lock.
- External deletion rechecks live connection truth before browser mutation.
- The ordinary successful-delete retry and callback projection remain safe.
- Successful deletion releases the active setup slot only after its exact
  browser run is released, and the next connect creates a fresh setup.
- A later independent exact-landing inspection can clear an ambiguous submit
  only after proving no marked application exists and without resubmitting.
- Focused unit, TypeScript, lint, docs, and real-PostgreSQL proofs pass before
  the exact candidate head enters ReviewGPT and required CI.

## Scope

- In scope: hosted Web member-owned provider setup, OAuth-session and
  connection binding checks, focused tests, concurrency proof, and verification
  map updates.
- Out of scope: new provider adapters, provider-specific browser scripting,
  device-sync runtime redesign, database schema changes, or deployment config.

## Constraints

- Reuse the existing setup state machine, Prisma stores, hosted-member lock,
  public ingress, and browser run owner.
- Keep provider behavior registration-driven and credentials outside model
  context.
- Keep database transactions bounded and database-only.
- Preserve the exact existing PR direction and resolve only the accepted review
  finding plus directly coupled projection state.

## Risks and mitigations

1. Risk: deletion admits before a delayed callback persists its connection.
   Mitigation: serialize both writes on the hosted-member row and require the
   exact setup to remain `oauth_in_progress` at connection persistence.
2. Risk: callback connection wins but delayed projection overwrites
   `disconnect_first`.
   Mitigation: project `connected` only from `oauth_in_progress` and include
   that delayed projection in callback-first PostgreSQL proof.
3. Risk: a stale start reopens deletion or issues a usable state.
   Mitigation: gate start status in the service and recheck it inside the
   member-locked OAuth-state transaction.
4. Risk: tests prove mocks but not lock order.
   Mitigation: use independent one-connection Prisma clients and
   `pg_blocking_pids` to exercise both real PostgreSQL winner orderings.

## Tasks

1. [x] Map setup status, OAuth state, connection, projection, and deletion
   mutation paths.
2. [x] Persist deletion admission under the existing hosted-member lock.
3. [x] Gate OAuth start, state creation, connection persistence, and callback
   projection on the exact active setup state.
4. [x] Revalidate connection truth immediately before browser deletion.
5. [x] Add unit and real-PostgreSQL proof for stale OAuth and both lock winners.
6. [x] Run focused tests, hosted Web typecheck, lint, docs, diff, and privacy
   checks.
7. [ ] Archive this plan in the scoped commit, push the exact head, and run
   ReviewGPT concurrently with required CI.
8. [ ] Merge only after ReviewGPT passes and required exact-head checks are
   green; verify the safe deployment boundary and retire the worktree.
9. [x] Triage ReviewGPT round 8 and reproduce both terminal setup-slot and
   ambiguous-submit recovery findings through their owning state machine.
10. [x] Deactivate a deleted setup in the exact terminal-run release CAS and
    require an independent trusted zero-marker inspection before resubmit.
11. [x] Add service, trusted-boundary, computer-use, and real-PostgreSQL proof
    for both corrections and re-audit their coupled state.

## Decisions

- The deletion fence belongs in `PrismaDeviceProviderSetupStore` because it
  atomically couples setup status with the existing connection truth; it does
  not introduce a manager, queue, service, or new persisted state.
- OAuth state and connection writes independently recheck the exact
  `oauth_in_progress` relation under the same hosted-member lock. Service-level
  status checks improve immediate feedback but are not the concurrency
  authority.
- Callback projection is deliberately a narrow derived write. Once deletion or
  disconnect wins, projection must be a no-op rather than rediscovering or
  overriding current state.
- The immediate pre-browser disposition read is defense in depth for legacy or
  inconsistent state. The persisted fence remains the guarantee that no new
  bound callback can appear afterward.
- No new Frog entry is needed: the single-file hosted Web fanout and
  `open-exec-plan --help` behavior encountered here already have pending
  entries.
- The deleted tombstone remains active while it can own browser work. The same
  CAS that clears its exact run deactivates it; the existing member-locked
  `ensureActive` owner then admits one successor through the partial unique
  index.
- `capturing` remains the only submit ambiguity fence. Recovery code contains
  no submit controls, fully loads and verifies the exact safe landing, and
  returns a typed zero-marker observation. The service restores
  `browser_setup` and stops, so only a later independent invocation can submit.

## Verification

- Focused member-owned provider and ingress lane: 9,956 passed, 411 skipped.
- Direct affected behavior set: 104 passed.
- Real PostgreSQL OAuth/deletion concurrency and successor admission: 3 passed.
- Round-8 direct service, trusted-boundary, computer-use, reconnect-link, and
  internal-connect coverage: 244 passed.
- Coupled-state audit: two reported findings confirmed and corrected; no
  additional unresolved state inconsistency remains in the affected owner.
- Corrected-head product-purpose verdict: no findings. The irreducible purpose
  remains a credential-blind member-owned connection that recovers without
  duplicate provider effects. The smallest experience still uses the existing
  `/connect` card and conversation continuation; deletion now permits a later
  reconnect, and proven provider absence becomes retryable without a new screen,
  click, message, or setup owner. Existing rendered evidence remains applicable
  because no presentation component or visible state shape changed.
- Hosted Web TypeScript: passed.
- Hosted Web ESLint: 0 errors; unrelated existing warnings remain.
- `pnpm docs:drift` and `git diff --check` must pass with this active plan.
