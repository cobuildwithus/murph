# PR 1675 provider setup completion fences

Status: active
Created: 2026-08-13
Updated: 2026-08-14

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
  device-sync runtime redesign, new database owners or tables, or deployment config.

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
7. [ ] Commit the remediation while retaining this active plan, push the exact
   head, and run ReviewGPT concurrently with required CI. Archive only after the
   review gate passes.
8. [ ] Merge only after ReviewGPT passes and required exact-head checks are
   green; verify the safe deployment boundary and retire the worktree.
9. [x] Triage ReviewGPT round 8 and reproduce both terminal setup-slot and
   ambiguous-submit recovery findings through their owning state machine.
10. [x] Deactivate a deleted setup in the exact terminal-run release CAS and
    require an independent trusted zero-marker inspection before resubmit.
11. [x] Add service, trusted-boundary, computer-use, and real-PostgreSQL proof
    for both corrections and re-audit their coupled state.
12. [x] Rebind only the computer owner's proven same-setup successor when a
    `capturing` run expires, preserving the submit fence and recovery-only first
    inspection.
13. [x] Bind each reserved candidate run before Kernel provisioning, attach it
    before navigation, and prove both Cancel/admission winner orders against real
    PostgreSQL without leaving active computer work.
14. [x] Keep a bound browserless run and its setup nonterminal while remote
    creation may be in flight, then prove late-response and lost-response cleanup
    through the existing exact creator and stale-provisioning owners.
15. [x] Treat a provider-client create rejection without an exact browser handle
    as ambiguous, block fresh acquisition, and prove Cancel and no-Cancel timeout
    convergence through the same stale-provisioning owner.
16. [x] Move no-Cancel timeout recovery from presentation reads back to the
    originally accepted mailbox item, with exact pre-model validation and typed
    two-minute retry through the existing computer owner.
17. [x] Route consent withdrawal through existing setup status owners so
    `capturing` and cleanup-pending `canceling` retain their durable fences.
18. [x] Admit both exact provider-setup POST routes through the existing signed
    Cloudflare Web-control policy and prove the production outbound boundary.
19. [x] Return the first durably retained no-handle browser-create ambiguity as
    the existing typed provisioning outcome so the accepted mailbox item owns
    its two-minute retry.
20. [x] Replace the visible member-derived ownership marker with one friendly
    model-proposed application name frozen on the existing setup before trusted
    submission, then prove exact-name recovery and deletion remain fail closed.
21. [x] Isolate provider-dashboard authentication in a deterministic setup-only
    Kernel profile lane and delete both current lanes during account cleanup.
22. [x] Keep the model-selected friendly words but restrict them to neutral
    tool-owned sets and append six Web-generated random digits; after sealing,
    authorize deletion by a digest of the stable client ID rather than mutable
    display text.
23. [x] Delete reconcile-time application adoption so the capture transaction is
    the only setup-binding writer.
24. [x] Remove negative model-locator evidence from capture and deletion
    convergence; use provider-registered client-ID and disjoint loaded-empty
    coordinates while preserving `capturing` and `deletion_pending` on partial,
    nonempty, unmatched, or incomplete inventory.

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
- An expired `capturing` run does not add a recovery owner. The existing
  computer-use owner proves the stale exact binding and same-setup successor;
  the setup CAS changes only `browserRunId` while preserving `capturing`, so
  recovery on the successor remains submit-free.
- Reservation remains inside the existing computer owner, but it is not browser
  authority. The setup's existing CAS admits the candidate before Kernel work;
  a losing candidate is retired, while a winning binding lets the existing
  `canceling` path finish the exact run. Browser attach precedes navigation so a
  canceled or otherwise ineligible setup cannot receive provider effects.
- A bound browserless run is not quiescent merely because an early deterministic
  delete reports absence while remote creation is in flight. Cancel reuses
  `cleanup_pending`, remains visible as `canceling`, and retains the exact browser
  name until the returning creator deletes its session or the existing
  stale-provisioning boundary repeats cleanup. A provider-client timeout without
  an exact returned handle is the same ambiguity and cannot admit a successor
  before that boundary.
- The accepted typed mailbox item, not a `/connect` read, owns no-Cancel
  continuation. It is revalidated against exact setup authority before every
  assistant attempt, remains `recording` until that turn checkpoints, and moves
  back to `pending` for the existing two-minute boundary on the typed browser
  provisioning result. The next attempt reuses the existing computer owner for
  exact stale cleanup and successor admission; mutable usage admission is not
  repeated.
- Consent withdrawal does not add a setup state. It delegates connected/bound
  work to disconnection, pre-submit browser work to cancellation, retains
  cleanup-pending `canceling`, and leaves `capturing` intact so ambiguous submit
  recovery cannot create twice.
- Provider setup uses the existing `web-control.worker` service-binding request
  path. Cloudflare admits only the two shared exact POST constants and preserves
  the existing bound-member, runtime-write-fence, callback-signing, and body
  limit owners.
- Once the computer owner durably retains an exact no-handle browser create as
  `cleanup_pending`, the caller receives the existing typed provisioning
  outcome even if immediate best-effort delete-by-name fails. That outcome is
  retry ownership, not proof of cleanup or permission for another browser.
- The model may propose a safe-format friendly application name, but it does not own
  the mutation. `DeviceProviderSetup` freezes that exact name before the trusted
  boundary writes or submits it. The boundary rejects an exact pre-existing name
  before submit and releases that safe pre-submit choice so the model can choose
  another. Pre-binding capture recovery derives authority only after a fresh
  provider-page load produces one exact-name container. After sealing, deletion
  instead compares a digest of the encrypted binding's stable client ID inside
  registered containers, so a rename or same-name substitution cannot redirect
  the effect. The model cannot change the name after provider mutation may have
  started.

## Verification

- Focused member-owned provider and ingress lane: 9,956 passed, 411 skipped.
- Direct affected behavior set: 104 passed.
- Real PostgreSQL OAuth/deletion concurrency and successor admission: 3 passed.
- Round-8 direct service, trusted-boundary, computer-use, reconnect-link, and
  internal-connect coverage: 244 passed.
- ReviewGPT round 9 found one pre-existing stale-run composition gap. The
  correction rebinds a computer-owner-proven same-setup successor without
  leaving `capturing`; the service proof composes that rebind with a submit-free
  zero-marker inspection, and the real computer service proves terminal and
  expired exact-owner replacement plus foreign/active-owner rejection.
- Corrected round-9 hosted Web lane: 10,024 passed, 415 skipped.
- ReviewGPT round 10 found the pre-binding Cancel race. The correction composes
  the setup CAS with computer reservation before Kernel provisioning and requires
  exact eligible attachment before navigation. Direct service/computer proof:
  211 passed. Real PostgreSQL proof covers both winners; all 5 cases passed.
- ReviewGPT round 11 found the post-binding in-flight-create interval. The
  correction retains `cleanup_pending` through an early delete-by-name absence,
  classifies exact setup ineligibility as safe exact-browser compensation, and
  lets visible setup polling finalize only after cleanup. Direct setup/computer/
  Connect proof passes 321 tests; real PostgreSQL covers late and lost create
  responses in addition to the prior races, with all 7 cases passing.
- ReviewGPT round 12 found the production client-timeout branch omitted by the
  deferred fake. The correction retains `cleanup_pending` when create rejects
  without an exact handle and blocks a fresh retry until stale deterministic
  cleanup. The real-PostgreSQL file reproduces both Cancel and no-Cancel timeout
  orderings; all 9 cases pass.
- ReviewGPT round 13 found that no production owner revisited the no-Cancel
  timeout at the two-minute boundary. The correction reuses ordinary `/connect`
  setup reads to settle only the exact stale browser, CAS-clear its binding
  without changing `browser_setup` or `capturing`, and request the existing
  setup-versioned continuation. Fresh reads remain blocked, duplicate requests
  retain one event identity, and the real-PostgreSQL file keeps all 9 cases
  passing while proving the cleanup precedes ordinary run expiry.
- Round-13 remediation proof: 408 focused Web setup/computer/Connect tests,
  9 real-PostgreSQL ordering cases, the exact hosted-runtime continuation case,
  Web typecheck, focused ESLint, docs drift, and diff checks pass.
- Coupled-state audit: every reported setup/browser finding was confirmed and
  corrected; no additional unresolved state inconsistency remains in the
  affected owner.
- Corrected-head product-purpose verdict: no findings. The irreducible purpose
  remains a credential-blind member-owned connection that recovers without
  duplicate provider effects. The smallest experience still uses the existing
  `/connect` card and conversation continuation; deletion now permits a later
  reconnect, and proven provider absence becomes retryable without a new screen,
  click, message, or setup owner. Existing rendered evidence remains applicable
  because no presentation component or visible state shape changed.
- Hosted Web TypeScript: passed.
- Hosted Web ESLint: 0 errors; unrelated existing warnings remain.
- `pnpm docs:drift`, `git diff --check`, and the changed-line identifier scan:
  passed.
- ReviewGPT round 14 found that the round-13 retry owner depended on visible
  `/connect` reads and that blanket consent-withdrawal projection erased
  `capturing` and `canceling` authority. The correction retains the accepted
  mailbox item, performs exact Web-owned validation before model work, returns
  typed provisioning outcomes to the existing two-minute mailbox retry, removes
  read-side continuation publication, and delegates consent withdrawal by
  status. Focused service/consent, engine, mailbox, event, workspace-phase, and
  hosted-contract tests pass; assistant-runtime and hosted-execution typechecks
  pass. Exact authority validation passes, and the isolated PostgreSQL proof
  confirms that an exact stale owner is expired and replaced without a second
  live browser.
- ReviewGPT round 15 found that Cloudflare's exact outbound allowlist omitted
  both provider-setup routes and that the first no-handle timeout surfaced the
  raw Kernel/delete error after durably retaining `cleanup_pending`. Both are
  accepted for correction through the existing Web-control policy and typed
  mailbox retry disposition; no new transport or retry owner is permitted.
- Round-15 remediation proof: 33 production Cloudflare outbound cases, both
  immediate-delete outcomes, the isolated PostgreSQL first-attempt and exact
  successor case, and the exact engine/mailbox ownership seams pass. Hosted Web
  and Cloudflare typechecks, focused Web ESLint, docs drift, diff integrity, and
  the changed-line privacy scan pass.
- Friendly-name proof: 269 focused Web browser-boundary, service, route,
  migration, and changelog tests; 109 assistant prompt/tool tests; and 9 hosted
  execution contract tests pass. Web, assistant-engine, and hosted-execution
  typechecks, focused Web ESLint, Prisma validation, docs drift, diff integrity,
  and the changed-line privacy scan pass. The opt-in PostgreSQL case now proves
  the name and `capturing` fence commit together; local execution was unavailable
  because the checkout database is intentionally unbaselined and lacks this PR's
  setup table, so exact runtime proof remains owned by post-migration CI.
- Friendly-name collision hardening: 41 direct service and trusted-browser tests
  pass, including exact pre-existing-name rejection before submit and release of
  that safe choice for a later retry. Hosted Web typecheck and docs drift pass.
- ReviewGPT round 16 found three issues. The shared persistent Kernel profile and
  reconcile-time application adoption findings were accepted directly: setup auth
  now has its own deterministic profile lane, and capture is the sole binding
  writer. The mutable-name authority finding was accepted for privacy, collision,
  partial-page, and deletion safety, but its server-authored entire-name proposal
  was rejected because the user explicitly requires model-chosen friendly naming.
  The smaller correction restricts the model to neutral word sets, appends a
  Web-CSPRNG suffix, uses the name only before binding, and authorizes later
  deletion by a digest of the sealed client ID with positive loaded-inventory
  proof. This adds bounded selector/digest logic but no state owner, service,
  queue, scheduler, adapter, or lifecycle; removing reconcile adoption offsets one
  production concept.
- Round-16 remediation proof: 240 direct setup/trusted-browser/computer tests,
  another 130 focused application/account/route/migration/changelog tests with 10
  opt-in PostgreSQL cases skipped, 109 assistant prompt/tool tests, and 9 hosted
  execution contract tests pass.
- ReviewGPT round 17 found that negative page evidence still released both
  irreversible fences. The finding is accepted: delete-time client-ID lookup was
  still model-selected, the Strava container and creation-form fallbacks
  overlapped, and capture recovery treated any missing friendly name as proof of
  absence. The correction removes the delete-time client-ID selector, locates it
  through finite provider registration, rejects every incomplete or unmatched
  nonempty inventory, and permits capture or deletion absence only with zero
  registered application containers plus one visible disjoint loaded-empty
  coordinate. It deletes unsafe convergence branches and adds no state, phase,
  owner, service, queue, scheduler, adapter, or provider-specific browser program.
- Round-17 remediation proof: 372 focused Web setup, browser, account, route,
  application-store, migration, and changelog tests; 75 assistant prompt/tool
  tests; and 9 hosted-execution contract tests pass. Web, assistant-engine, and
  hosted-execution typechecks, focused Web ESLint, and docs drift pass.
