# Evaluate Luna high workers for hosted onboarding delegation

Status: active
Created: 2026-08-15
Updated: 2026-08-22

## Goal

- Prepare hosted onboarding to delegate bounded health-history persistence to
  `gpt-5.6-luna` workers at high reasoning without activating the route before
  exact model and token accounting is authoritative for every child request.

## Success criteria

- No onboarding assignment selects Luna/high until authoritative child-request
  model, tier, attempt, and terminal-usage evidence is available and the
  executable Codex boundary can enforce the requested route.
- The existing onboarding foundation-memo contract continues to delegate each
  supplied independent save family to one-shot workers without speculative
  routing or recovery promises.
- Assistant-engine remains the sole usage-ledger writer and does not synthesize
  Luna usage from the parent model or non-authoritative V2 metadata.
- Existing hosted, non-OpenAI, and local/development behavior remains unchanged
  by the deferred Luna/high proposal.
- Murph's ReviewGPT dependency resolves the latest published package and its
  package-backed runner contract remains covered.
- Focused tests, affected package typechecks, exact-head CI, and required
  ReviewGPT gates pass.

## Scope

- In scope: hosted OpenAI Codex config, authoritative child-request accounting
  boundaries where Murph owns them, the requested ReviewGPT dependency bump,
  and focused regression coverage.
- Out of scope: arbitrary per-spawn model selection, nested delegation,
  changing the root model, and broad migration of other providers' accounting.

## Constraints

- Technical constraints: V2 `subAgentActivity` does not expose authoritative
  effective child-model evidence; both HTTP streaming and WebSocket Responses
  transports must preserve bytes, latency, retry semantics, and provider
  response delivery; usage persistence must be idempotent and private-safe.
- Product/process constraints: health-data authorization and canonical owners
  remain unchanged; children are one-shot bounded leaves; the root replies
  without waiting and never claims a save before canonical readback.

## Risks and mitigations

1. Risk: egress and engine both record the same hosted OpenAI call.
   Mitigation: keep assistant-engine as the only ledger owner and add exact
   regression proof for root and child calls.
2. Risk: transport evidence lacks Murph's accepted-turn, attempt, request, or
   child-assignment identity.
   Mitigation: keep the Worker out of ledger writes and extend the execution
   evidence at the owner that already has those logical coordinates.
3. Risk: hidden spawn metadata is mistaken for executable routing enforcement.
   Mitigation: restore the runtime and ledger files to base and make no new
   inheritance claim; defer the entire Luna/high route until the Codex handler
   rejects hidden routing arguments before spawning.
4. Risk: a preparatory prompt invents idempotency, fallback, or recovery
   capabilities that canonical health owners do not provide.
   Mitigation: leave the active onboarding contract unchanged and keep future
   routing policy in typed runtime ownership rather than model-readable prose.

## Tasks

1. [x] Give ReviewGPT the implementation packet and obtain its proposed patch.
2. [x] Inspect and integrate the smallest safe implementation against current
   runtime-config, engine-accounting, and onboarding owners.
3. [x] Probe the proposed fail-closed runtime boundary and remove it when the
   pinned Codex handler proved that hidden schema fields were not enforcement.
4. [x] Run focused tests and affected package typechecks, then inspect the diff for
   privacy and scope.
5. [x] Finish the initial candidate, push it, open a draft PR, and start the
   preliminary specialist and final ReviewGPT passes concurrently with CI.
6. [x] Re-open the accounting boundary against the stock Codex app-server
   protocol and verify that fresh raw-event listeners expose exact per-response
   child usage while metadata-only resume exposes the effective child config.
7. [x] Recover, integrity-check, apply, and locally audit the ReviewGPT metering
   patch; fix the billing-order, rerouted-model, and raw-content-retention gaps
   found by the parent review.
8. [ ] Push the corrected candidate and run sensitive final ReviewGPT round 2
   concurrently with exact-head CI; the one allowed preliminary specialist
   pass already completed on the immutable first-reviewed head.
9. [ ] Complete the parent final review, archive this plan, and create the final
   scoped commit.

## Decisions

- Do not move ordinary hosted OpenAI accounting to Worker egress. Egress sees
  provider facts but not Murph's immutable turn, attempt, request-ordinal, and
  child-assignment identity, so it must not become a second ledger authority.
- Keep assistant-engine as the sole ledger writer. Do not infer a Luna child's
  model or tier from the parent when authoritative V2 evidence is missing.
- A future Luna/high rollout must be selected by a typed runtime capability
  after its authoritative evidence path and representative evaluations land;
  the active skill must not authorize billing-critical routing through a
  natural-language marker.
- Do not enable the Luna/high production route on Codex 0.147.0. Its canonical
  V2 activity item proves child lifecycle and thread identity but not the
  effective child model, reasoning effort, service tier, provider attempt, or
  terminal usage. `hide_spawn_agent_metadata` hides tool-schema and returned
  metadata but the executable handler still accepts the hidden arguments, so
  it cannot prove inherited routing. Restore all proposed assistant-runtime and
  assistant-engine changes to base rather than adding another Murph authority.
- Accept the preliminary specialist findings that the first ReviewGPT patch
  invented a family-level recovery key, contradicted mixed-dispatch fallback,
  and put routing authority in prompt prose. Remove that entire active-skill
  addition rather than adding new health-record or transport machinery.
- Upgrade the repository-backed ReviewGPT runner from 0.5.127 to the registry's
  current 0.5.132 release and update its release-contract assertions.
- Make Murph's repository wrapper the sole trust-floor owner: reject later
  `--config` arguments and all kebab-case and camelCase threshold options before
  launch, then place one fixed `--minimum-marked-response-time 5m` before caller
  arguments. This keeps a trailing value-taking caller option from consuming
  the fixed option as its value. Leave the sourced config free of policy
  assignments so ReviewGPT remains configurable for direct callers without
  creating a second owner.
- Follow the registry to ReviewGPT 0.5.132 when it appears during the gate.
  That release fixes Deep Research conversation identity and timestamped
  submitted-attachment matching; retain Murph's wrapper-owned trust floor.
- The earlier no-authoritative-usage conclusion is superseded by stock
  app-server protocol evidence: `thread/start.experimentalRawEvents` enables
  exact, non-cumulative `rawResponse/completed` usage on fresh parent and
  inherited child listeners. Resumed legacy parents intentionally retain the
  cumulative `thread/tokenUsage/updated` fallback because `thread/resume` does
  not accept the raw-event switch.
- Treat the exclusively owned app-server process as the trust boundary. A
  non-root thread notification correlates that child with the active turn; a
  particular parent collab-item shape is not a second billing-authorization
  protocol. The process retains the small usage callback after the root reply
  so detached child usage is still attributed to the originating Murph turn.
- Fresh hosted turns use exact raw-response usage only. Resumed legacy parents
  retain their pre-existing cumulative fallback because `thread/resume` cannot
  enable raw events; no per-child arbitration state is needed.
- Resolve the child's effective model, provider, service tier, and reasoning
  effort through one cached metadata-only `thread/resume` with
  `excludeTurns: true`. Incomplete or failed metadata drops that usage sample
  without retry or parent-identity fallback. The returned effective model is
  used for both requested and served fields because there is no separate
  authoritative requested-model fact on the V2 child lifecycle.
- Enabling raw events also causes the parent listener to receive full upstream
  response items. Drop `rawResponseItem/completed` before trace or provider
  event buffering; only the strict, usage-only completion shape participates
  in child accounting.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-codex-subagent-usage.test.ts
  test/assistant-codex-runtime.test.ts` passed on the corrected metering diff:
  287 tests.
- `pnpm --dir packages/hosted-execution exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-usage.test.ts` passed: 23 tests.
- `pnpm --dir packages/assistant-engine typecheck` and
  `pnpm --dir packages/hosted-execution typecheck` passed after the final
  TypeScript edits.
- The stock Codex source confirms that raw completion usage is optional,
  per-upstream-response, non-cumulative, emitted before cumulative token
  accounting, and inherited by child listeners from a raw-enabled fresh
  parent. Its running-thread metadata-only resume path returns the current
  config snapshot without replaying historical token usage.
- The simplified path removes the arbitrary 32-thread accounting cap and the
  raw/cumulative source-arbitration sorter. Focused proof covers post-reply
  child usage, response-id deduplication, malformed-then-valid completions,
  strict metadata failure without retry or parent fallback, and exclusion of
  full raw response items from both buffered and traced events.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts`
  passed: 44 tests, 4 skipped.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-subagent-usage.test.ts`
  passed: 12 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-skill-assets.test.ts`
  passed: 25 tests, 6 skipped.
- `pnpm --dir packages/assistant-runtime typecheck`,
  `pnpm --dir packages/assistant-engine typecheck`, and
  `pnpm --dir packages/cli typecheck` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
  passed after the trust-floor remediation and again on ReviewGPT 0.5.132: 46
  tests, 1 skipped. The real installed package dry-run starts with ambient and
  local-config values of `1`, including a callback that resets the value after
  config loading, and the wrapper still resolves `300000`. A direct-package
  control proves that a later weak config still resolves `1`, while both
  `--config` forms and all four direct threshold forms fail before the wrapper
  launches the package. The in-memory installed-driver harness uses the same
  repository-owned value, while the existing boundary cases prove `299999` is
  rejected and `300000` is admitted.
- An isolated pinned Codex 0.147.0 config parse accepted
  `features.multi_agent_v2.hide_spawn_agent_metadata = true`, but the final
  executable-path review proved that this setting controls presentation rather
  than handler enforcement. The corresponding runtime, engine, and test files
  are byte-identical to base in the current PR.
- `npm view @cobuild/review-gpt version --json` and
  `pnpm exec cobuild-review-gpt --version` both reported 0.5.132 after the
  release appeared during the final-review cycle.
- `git diff --check` passed after applying the separately authored ReviewGPT
  patch; the candidate diff and patch were scanned for direct identifiers.
- After specialist remediation removed the speculative active-skill contract,
  the focused onboarding skill-assets suite again passed with 25 tests and 6
  skips, assistant-engine typecheck passed, and `git diff --check` stayed clean.
- Exact-head CI passed on the first-reviewed commit. The preliminary specialist
  pass returned substantive findings after 34 minutes; its accepted prompt
  findings were removed on a remediation head. A 41-minute final pass confirmed
  those findings resolved and found the ambient trust-floor override introduced
  by ReviewGPT 0.5.131; the repository-boundary pin and regression above resolve
  it. A fresh final pass and exact-head CI remain pending. Two pre-send browser
  failures and one rejected nine-second response were not treated as reviews;
  no Eragon lane was used.
- Two later marked `PASS` candidates on the trust-floor remediation were also
  rejected: they completed in 19 and 18 seconds and each exact committed turn
  rendered as two assistant DOM nodes. A 0.5.131 Deep Research retry could not
  prove one accepted conversation URL. None counts as substantive round 3;
  retry on 0.5.132 after pushing the dependency update.
- ReviewGPT 0.5.132 produced an exact 28-minute round-3 response that was
  `INVALID` because the invocation omitted the full prior-finding ledger. The
  same-thread correction supplied that ledger and produced a fully attested
  44-minute `FINDINGS` result. Its two accepted findings were the ineffective
  hidden-Codex routing claim and the package-precedence/phase-parser bypass.
  The former is resolved by deleting the full runtime/engine delta; the latter
  is resolved at the wrapper's repository-policy boundary above.
- The exact long-running round-4 correction review found that a later scalar
  `--config` still replaced the canonical config after the wrapper's policy
  check. The wrapper now rejects both config forms in the same pre-launch
  policy function, and real-package plus no-child-launch tests cover the direct
  caller and repository-gate sides of that boundary.
- The exact long-running round-5 correction review found that arbitrary sourced
  Bash could redefine a callback invoked after the config-level floor reset.
  The config-level assignment is now deleted and the wrapper owns the fixed
  five-minute option. A later local review found that appending it after caller
  arguments let a trailing value-taking option consume it; the option now
  precedes caller arguments, with invocation-order regression coverage. A
  fresh exact-head final pass remains pending; no Eragon lane was used.
- The current PR's one preliminary specialist pass found two medium coverage
  gaps: metadata failure lacked direct no-retry proof, and raw-response privacy
  was asserted for buffered events but not traces. Both were accepted and
  resolved in the adjacent runtime scenario; they added proof only, not a new
  production concept.
- Current final ReviewGPT round 1 found three high issues: child accounting died
  with the parent reply, one valid raw sample suppressed later incomplete raw
  accounting, and metadata failure fabricated the parent's billing identity.
  All three were accepted. The corrected shape retains a small callback on the
  already-resident App Server process, uses exact raw usage only for fresh
  hosted turns, and drops samples whose child metadata is incomplete. This
  deletes the parent-event authorization map, raw/cumulative arbitration,
  reroute state, metadata-drain wait, arbitrary child cap, and parent fallbacks.
- The canonical completed-parent-spawn requirement was then rejected as an
  unnecessarily brittle local policy. The revised implementation derives child
  ownership from the exclusively owned App Server process and non-root thread
  notifications. The working production-source correction is net deletion
  relative to the previously pushed head; focused tests cover unrecognized
  parent item shapes, post-reply delivery, duplicate raw responses, incomplete
  metadata, privacy, and unbounded observed fan-out.
