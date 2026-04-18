# Hosted hard-cut migration guide and worker batch

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Produce a deduplicated hosted hard-cut migration guide rooted in the live repo,
  then land the first parallel cleanup batch against the remaining hosted-wake
  seams without reopening already-completed substrate work.

## Success criteria

- `docs/hosted-hard-cut-migration-guide.md` exists and distinguishes landed work
  from remaining work with direct file evidence.
- `agent-docs/exec-plans/active/worker-prompts/2026-04-18-hosted-hard-cut-batch1/`
  contains the launched worker prompts for the first implementation batch.
- At least one parallel worker batch has been launched with the `codex-workers`
  skill on `gpt-5.4` at `xhigh` reasoning, and the resulting changes are
  integrated or explicitly triaged.
- The branch moves the hosted stack closer to the final hard-cut shape without
  reintroducing `execution_outbox`, staged dispatch payloads, or new queue
  ownership in Cloudflare.
- Required verification, completion audits, and commit happen before handoff,
  or blockers are documented with exact failing commands and unaffected scope.

## Scope

- In scope:
  - hosted hard-cut migration guide and execution-plan artifacts
  - worker-prompt authoring plus `codex-workers` launch/output triage
  - first parallel implementation batch across:
    - `apps/web` hosted webhook ingress cleanup
    - `packages/assistant-runtime` conversation-vs-system execution cleanup
    - `apps/cloudflare` thin-shim queue/status cleanup
- Out of scope:
  - unrelated active release, e2e stabilization, onboarding UI, or package-manifest work
  - speculative new hosted product behavior
  - a broad shared-contract rename that would overlap all three initial worker lanes
    before the first integration pass lands

## Constraints

- Technical constraints:
  - Preserve the web-owned `HostedWake` / `HostedExecutionCursor` substrate and
    its cursor compare-and-swap semantics.
  - Preserve the current producer fact that activation, channel sync, device-sync,
    share acceptance, Linq, Telegram, and hosted email already append into
    canonical wake ownership.
  - Do not revert or overwrite unrelated dirty-tree changes already present in
    hosted web, Cloudflare, tests, release files, or root manifests.
  - Treat active `apps/cloudflare` e2e stabilization work as overlapping and
    keep this lane focused on runner/control-plane ownership only.
- Product/process constraints:
  - Use the `codex-workers` skill and default to the current shared worktree.
  - Keep worker ownership disjoint enough to avoid predictable same-file conflicts.
  - Finish with repo-required verification, completion audits, and a scoped commit.

## Risks and mitigations

1. Risk: the external writeups are partly stale and could cause duplicate or
   already-landed work to be re-planned.
   Mitigation: root the migration guide in current files plus the completed
   `2026-04-18` hosted-cutover plans before launching workers.

2. Risk: the shared hosted-execution contract still overlaps every hosted lane,
   so a broad contract rename would create predictable worker conflicts.
   Mitigation: hold the contract hard-cut for a later integration/local pass and
   launch the first batch on narrower web/runtime/Cloudflare ownership cuts.

3. Risk: broad `apps/cloudflare/**` active work could make queue-thin-shim edits
   collide with unrelated e2e stabilization changes.
   Mitigation: keep the Cloudflare worker prompt scoped to runner ownership files
   and focused runner/web-control-plane tests only.

## Tasks

1. Audit the live hosted-wake, webhook, runtime, and Cloudflare code against the
   two supplied analyses and the recently completed hosted-cutover plans.
2. Write `docs/hosted-hard-cut-migration-guide.md` with:
   - landed substrate and producer work to keep
   - deduplicated remaining gaps with file evidence
   - ordered migration phases and acceptance criteria
   - a parallelization plan for the current session
3. Register this plan in `COORDINATION_LEDGER.md`.
4. Write raw worker prompts for the first batch:
   - web ingress fast path
   - runtime conversation-lane cleanup
   - Cloudflare thin-shim cleanup
5. Launch the worker batch with `codex-workers` on `gpt-5.4` and `xhigh`.
6. Integrate worker changes, resolve conflicts, and decide whether a second
   local integration pass is needed before audits.
7. Run verification and required completion audits, then commit with
   `scripts/finish-task`.

## Decisions

- Treat the supplied analyses as useful but stale: direct Linq/Telegram wake
  append and most producer cutovers are already landed; the real remaining gaps
  are dispatch-shaped contracts, receipt wrapping on active-member ingress,
  runtime maintenance coupling, and Cloudflare queue/state ownership.
- Start with a worker batch that avoids the shared hosted-execution contract
  rename because that surface overlaps every downstream lane.

## Verification

- Commands to run:
  - `pnpm test:diff apps/web packages/assistant-runtime apps/cloudflare packages/hosted-execution`
    when truthful after integration; otherwise the highest-signal owner-level
    commands per touched surface
  - required completion-workflow audits:
    - `coverage-write` on `gpt-5.4-mini` if the verification lane is coverage-bearing
    - `task-finish-review`
- Expected outcomes:
  - guide and worker prompts align with the current hosted-wake architecture
  - first worker-batch changes land without reintroducing legacy dispatch staging
  - verification either passes or fails only for credibly unrelated branch issues
Completed: 2026-04-18
