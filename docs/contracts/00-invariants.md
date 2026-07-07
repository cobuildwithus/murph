# Baseline Invariants

This file is the durable rulebook. Each rule states a trigger and the required
response; incident history, protocol case law, and mechanism detail live in the
referenced docs. Where a rule names an anti-pattern PR, the citation is
rationale, not a live mechanism.

## Implementation Bias

- Prefer simple, composable primitives over abstractions. A new abstraction must remove real duplication, clarify ownership, or make an invariant easier to enforce.
- Treat improving agent capability as a design input. Add code around agents only for hard guarantees — security, privacy, state integrity, idempotency, latency/retry bounds, protocol compatibility, or failures proven by tests or production evidence that prompt/tool guidance cannot cover. Do not preserve today's model limitations as permanent architecture.
- Review, audit, and ReviewGPT findings are inputs to engineering judgment, not architecture ownership. Before writing the first fix commit for a finding, evaluate the deletion, sibling-contract, or owner-boundary response; a finding fixed by adding a new state owner, lifecycle, queue, or manager when a tighter existing owner or one-source derivation preserves the invariant is a rejected fix, whoever suggested it.
- Operator/ops needs default to existing product flows, the CLI, or documented manual repair against the source of truth. A new ops route or page requires demonstrated recurring need and a deletion path (anti-pattern: PR 342's ops invite sender, deleted 48 hours later by PR 361).
- Keep production source free of branches, exports, routes, helpers, fixtures, and flags that exist only for tests or harnesses. If a test needs a new seam, make it a real production seam with clear runtime ownership, or keep it in test files and test-specific composition.

## Codex Is The Substrate

- Codex App Server is a production-grade runtime, not a component to defend against. Prefer Codex-native capabilities — thread resume, steering, subagents, web search, memory, process lifecycle, OpenAI transport — over Murph-side reimplementations, wrappers, or policing layers. A Murph-side layer that duplicates or supervises a Codex-native capability requires production evidence that the native path cannot meet the requirement, not a hypothetical failure.
- The default posture is one warm Codex App Server per Node runtime/container, reused across turns for the life of the container. Warm reuse is the contract; restart and poisoning are narrow recovery exceptions with proven triggers. Turn-scoped data — prompt text, session ids, turn ids, delivery facts — must never enter process identity or child env in a way that restarts a healthy process.
- The hard guarantees Murph does own at this seam: parent-thread output is accepted only when tagged with the current turn id, so a stale turn cannot inject into a new one; active turns are stopped through the explicit abort/interrupt path, never by killing the process under them; stale or mismatched resume state falls back to a fresh thread for the same user turn instead of failing to reply.
- Process babysitting is the named anti-pattern: PID sweeps, process classifiers, shadow lifecycle managers, and parallel orchestration state (PR 350 deleted ~3,000 lines of it).

## Durable Authority

- Any operation that resumes, wakes, mutates, egresses, delivers, deletes, exports, or recovers user state must revalidate an explicit durable authority tuple owned by the source-of-truth plane. Process-local pointers, cached "active" state, dashboard state, session presence, and provider callback state may optimize only after durable authority is proven.
- A session proves who is present, not that an action is authorized. Destructive, sensitive, or lifecycle-specific actions bind to the narrow action, user/member, route/target, attempt/lease/fence, freshness proof, or row lock that owns that action.
- Model-supplied tool arguments are requests, never authority. Delivery targets, thread ids, member ids, and scopes are injected server-side from the current wake's proven authority and re-asserted at the durable boundary.
- If authority is missing, stale, ambiguous, or mismatched, fail closed or fall back to the narrower safe flow. Provider success and container identity are not authorization.

## User Reply Primacy

- Every accepted inbound user message creates a durable obligation to reply. The obligation survives crashes, restarts, deploys, and runner replacement, and it clears only on a delivered reply or an explicitly recorded product-policy non-reply decision (such as the AI usage gate or a suppression with a decision record). Silence is never a valid terminal state.
- Replying to the user's current message outranks everything else the system could do. Background work, maintenance, checkpoints, cleanup, cost controls, and internal gates yield to or fail toward the reply path; a gate or dependency outage on that path must still end in a user-visible outcome — a reply or a policy message — never a dropped message.
- The obligation is at-least-once; delivery is at-most-once through the stable-identity and transport-matched-consumption rules. From accept to delivery there is terminal evidence (delivered, superseded, or suppressed-with-reason) that a restarted or replayed runtime keys on, so recovery always knows whether the user is still waiting.

## Product-Critical Flow Preservation

- Do not fix safety, reliability, privacy, auth, or review findings by disabling, silently dropping, or degrading an existing user-critical flow unless the user explicitly asks for that product change. User-critical flows include onboarding, signup and welcome delivery, replies to a current inbound message, billing and access transitions, authentication, device/data sync, and privacy or safety controls.
- Any change that tightens a guard, permission check, egress policy, retry rule, or delivery decision must preserve an authorized success path for the existing UX, proven with a production-faithful test or owner-level integration check.
- Any gate that depends on an external model or provider must declare, when it is introduced, its per-flow disposition when that dependency is unavailable; user-critical flows bias fail-open. Changing a disposition afterward is a product decision, not a fix (anti-pattern: PRs 324/334 decided the first-contact classifier's disposition twice in 24 hours).
- If safety and UX conflict, stop and surface the tradeoff. Never ship a silent no-op, dropped message, or unreachable recovery path as a safety fix.

## Stable Idempotency Identity

- Durable product identity, dedupe identity, idempotency keys, and revision identity derive from stable product/provider facts — never machine-local rows, runtime-local ids, mutable provider versions, media URLs, callback timing, or session-specific storage.
- Where paths intentionally overlap — retry, replay, push+pull ingestion, warm/cold restart, webhook reorder, outbox resend, migration re-entry — the shared identity makes overlap safe by construction.
- A new write path is complete only when it names its stable identity, states which mutable fields are excluded, and has a regression proving overlap does not duplicate or lose the user-visible fact.

## Transport-Matched Consumption

- Anything consumed over an at-least-once channel — webhook, provider callback, browser navigation, wake, job chain — must tolerate redelivery by construction: mark, don't delete.
- Stamp the durable fact at the instant it becomes true (delivery-accept, not a later checkpoint). A fact that becomes durable only minutes after the event is a duplicate-effect window.
- Replay gets a typed non-error resolution: indistinguishable from the first success to the user, distinguishable in the record.

## Minimal Mechanism Bias

- For "do this exactly once," start with a stable identity, a uniqueness constraint, and an idempotent write the losing caller can no-op on. If each write, send, or row a path produces is individually retry-safe, a top-level processing fence usually adds failure modes (stuck leases, owner mismatch on redeploy, replay-vs-reclaim races) without removing any.
- Before adding a second durable-state mechanism to an existing protocol — proof table, lease, reconciler, derived floor — write down the one-column/one-key alternative and prove it insufficient.
- Fix-loop length is a design trigger with a required response: when one protocol accumulates double-digit scoped "preserve/scope/fence/reclaim" fixes, the next change is a target-design rewrite to the smallest primitive the proven failures require, not another fix. Named anti-patterns: PR 320, and PR 381 (shelved at ~50 review rounds), whose one-column rewrite (PRs 383–385) deleted the proof machinery and made the previously unsafe direct wake safe by construction.

## Observable Outcomes

- Any path that can suppress, skip, or drop a user-visible effect returns a typed outcome and lands a queryable, metadata-only decision record. A silent no-op on a user-facing action is a defect even when the suppression is correct.
- A persisted pending effect names the condition under which it is still valid and is observably superseded when that condition stops holding; a scheduler or harness retry must not deliver a stale effect.
- A feature's stated user-visible goal must be proven reachable through the actually wired production path end to end before merge. A route with no caller, a tool action the model cannot invoke, or a field that persists null is an unfinished PR, even when every unit test of the pieces is green.

## One Fact, One Resolver

- A decision-grade predicate — access, capability, entitlement, identity — has exactly one owning resolver. A second exported variant may exist only when named by what it distinctly means, and a field must not carry two meanings.
- Every user-visible gate, billing/usage decision, experiment outcome, lifecycle automation, or safety/freshness claim names its authoritative source. Caches, current-period aggregates, sparse entity models, snapshots, and projections are accelerators unless their owner contract explicitly makes them the decision source; reads that enforce limits or report status reconcile against the authority, and bounded aggregates are repaired only in the owning mutating path.
- Decision-grade metric-window comparisons use normalized metric points plus the shared metric series/window primitives; wearable day summaries are presentation context, not analysis truth.

## State Lifetime And Durable Obligations

- Match state lifetime to scope: process state is for process configuration only. Request, turn, message, delivery, and user-action facts are explicit operation data or owned by a runtime object with that same lifetime.
- Durable obligations — retry ladders, backfill schedules, pending follow-ups — must be derivable from owned durable metadata on every pass. An obligation that exists only in an in-flight job chain, process memory, or a file that workspace restore deletes is lost state waiting to happen.

## Ordered Progress

- Any persisted cursor, sequence, watermark, pending-input index, or paginated read uses one total, transitive, owner-shared ordering primitive. Do not duplicate timestamp comparators or pick timestamp fields pairwise.
- Explicit causal anchors beat positional heuristics: provider reply ids, selected input ids, and server sequences resolve before "latest", grouping, watermarks, or time-window fallbacks. Import progress is not handling progress; events with different explicit anchors are never grouped into one turn.
- Consume/clear/advance only from owner-provided per-item authority or cursor coverage plus terminal evidence. Do not advance a lane high-water past pending lower work when a per-item stamp is the simpler durable truth.

## Provider Contracts

- An automation, assistant side effect, notification, or provider call carries a concrete deliverable/authorized target before it persists as executable. Continuity locators, thread ids, placeholders, and route hints are context, not targets. Invalid routes and unauthorized operations fail before model execution, delivery, or provider mutation — never add a scheduler, queue, or repair worker to compensate for an invalid route shape.
- Provider request and response shapes come from the provider's pinned canonical SDK or published typed contract. A bespoke boundary needs a documented reason (SDK too heavy, unpinnable, stale, or wrong authority owner) plus focused tests over the exact provider JSON shape.
- A fail-closed decision over provider-supplied data covers the provider's documented payload variants — item-level vs top-level fields, optional or removed flags, casing differences — with regressions before shipping.
- An external call may fail a job or turn only if the current input actually requires its result. Optional enrichment skips with a recorded typed reason, and calls whose result the input cannot use do not run.

## Enforcement-Point Completeness

- A new guard, preflight, or authority check is complete only when every path that can reach the guarded side effect is enumerated and either routed through the check durably or shown unreachable. An in-memory filter at a sibling boundary does not count.
- Every persisted wake, retry, or deadline has exactly one producing owner that records the current decision from decision-time state. Consumers select but never recompute due/defer logic, and appended state replaces stale wakes instead of preserving them.

## Deploy Skew

- Any change spanning web, Cloudflare, the runner bundle, or Temporal states its safe deploy order, its behavior under gradual container rollout (warm old-bundle containers), whether `container_rollout=immediate` is required, and its rollback floor.
- Schema changes are additive-first. Compatibility branches are deleted only after verified production drain, and the removal step is scheduled in the same change that lands the compatibility path.

## Executable Invariants

- If an invariant exists to keep a hot path small, a protocol boundary faithful, or a dependency surface narrow, make it executable with deterministic graph, byte, package-surface, shape, or protocol-contract tests. A docs-only invariant is not enough when one static import or shim drift can silently defeat it.
- Test doubles stand behind the real production adapter/protocol; they never reimplement owned protocols in parallel. Prefer the real binary, library, or protocol with stubbed external provider edges; stub only provider edges, secrets, clocks, or failure cases that cannot safely run in repo automation.
- Every abstraction, shim, compatibility layer, or generated harness has an owner, a deletion path, and a reason stronger than convenience. If the simpler path is deleting the shim and exercising the production seam, delete it.

## Latency And Scan Bounds

- Do not add unbounded linear-or-worse scans over any growing collection — repo files, vault records, runtime state, database rows, object-store keys, mailbox items, transcripts, logs, API result sets, or in-memory accumulators. Any path that can run during user-visible work, recurring jobs, deploy checks, or normal local commands uses a bounded window, limit, cursor, index, exact key lookup, or explicit pagination. Intentional full scans are limited to bounded fixture data, one-shot migrations, offline/admin repair tools, or diagnostics with a documented size cap.

## Hosted Workspace File Cardinality

- Hosted workspace restore/checkpoint treats file count as a latency, memory, and privacy budget; a routine feature must not create an unbounded number of small files just because each file is small. A new workspace write family classifies the state, chooses a compact storage shape, and defines snapshot inclusion and retention before shipping. Detailed rule: `docs/contracts/06-hosted-workspace-file-count.md`.

## Canonical Storage

- Human-facing truth lives in Markdown: `CORE.md`, `journal/`, and `bank/`.
- Machine-facing truth lives in JSONL: `ledger/events`, display-grade `ledger/metric-samples`, explicit raw/debug `ledger/samples`, and `audit`. Generic `ledger/samples` shards are not part of the default query/read/browser model.
- Imported originals live in `raw/` and are immutable once copied into the vault, except explicit core-owned repair tombstones that prove the old manifest byte/SHA and preserve durable product facts.

## Write Authority

- Only `packages/core` may mutate canonical vault data. `packages/importers` may parse and prepare external data, but all canonical writes call core APIs. `packages/cli` never writes vault files directly.

## Agent-Visible CLI Payloads

- Agent-primary `add`, `save`, and `edit` commands expose their normal input shape through native Incur args and options so `--help`, `--schema`, `--llms`, MCP, and generated skills stay truthful. Batch or document-derived JSON payloads are explicitly named escape hatches such as `import-json`/`import-jsonl`, never hidden behind canonical typed command names.
- Every agent-visible command that accepts a complex `--input @file|-` payload provides a paired Incur-discoverable shape path — a sibling `payload-schema` command with `scaffold` as a representative payload — sharing the runtime importer's normalization/schema path where practical. Agents must not have to infer payload shapes from source, tests, or stale docs.

## Assistant Boundary

- Agent layers, MCP surfaces, and future UIs call `murph`, `vault-cli`, or exported package APIs; no agent gets arbitrary write access to vault files as part of the public contract.
- Assistant runtime state lives under `vault/.runtime/operations/assistant/**`. If a datum is user-facing, queryable, or something future features will build on, it belongs in canonical vault records or explicit derived materializations, never assistant runtime state. Durable user-facing memory and scheduled prompt configuration are canonical vault records.

## User-Facing Message Sends

- Do not hard-code messages that automatically send to users, except for the AI usage gate, signup link delivery, first welcome, Linq daily text quota, Linq home-thread redirect, and billing cancellation feedback email. The Linq quota and home-thread redirects are narrowly scoped policy responses that preserve admission/routing invariants before assistant generation runs. All other automatic outbound user messages must come from the normal AI-gated assistant path, an explicit user/operator-authored message, or another reviewed product-copy surface that is not sent automatically.
- Any deterministic message that can send identically to more than one recipient renders from the seeded variant bank in `apps/web/src/lib/hosted-messages/user-facing-messages.ts`: at least 20 structurally distinct variants per class, selected by a stable per-recipient seed, never a single fixed string. Sending identical copy to many recipients is an iMessage spam signal (`agent-docs/operations/imessage-deliverability.md`), so the variant floor is enforced at module import and in the corpus test. This binds the allowed hard-coded classes above and any transactional onboarding, family, or group reply that would otherwise send fixed text. Managed automations satisfy it by composing each send through the AI-gated path instead of a fixed script, which is why they carry instructions rather than message text.

## Hosted Foreground Priority

- User conversation messages are the highest-priority hosted runtime work. Background device sync, provider cleanup, browser-vault refresh, maintenance, and idle checkpointing never block assistant admission or reply delivery, and idle-only work is preemptible: it yields, aborts, or reschedules when fresh user input arrives.
- After foreground work dirties hosted runtime state, the configured idle checkpoint delay is a lower bound for starting the next runtime-owned checkpoint. Due or projected wakes, budget exhaustion, and deferred durable follow-ups may preserve wake metadata for that checkpoint, but they must not pull it earlier than the idle timer; explicit shutdown cleanup is the narrow exception because the runtime is already exiting.
- Assistant reply code must not import, call, await, or coordinate with device-sync execution. Device sync may preserve a follow-up wake or recovery marker, but it stays out of the foreground reply path.
- Preemption is not permission to publish partial or corrupt state: wrong-user authority, stale leases, invalid auth, undecryptable mailbox payloads, and checkpoint compare-and-swap conflicts still fail closed.
- Observability writes are never user latency. Runtime logs, latency traces, diagnostics, and metrics are queued or fire-and-forget off the user-visible reply path and flushed at invocation end or idle, preserving enqueue order and logical timestamps. Bounded exception: warn/error crash-tail writes may block so failure forensics stay durable. Making an instrumentation write synchronous requires a documented correctness reason, not convenience.

## Hosted Runner Boundary

- Cloudflare stays a thin execution runner over the same Murph runtime used locally. It owns platform coordination, workspace restore/checkpoint transport, write fences, secret injection, and explicit runner shutdown; assistant business logic, vault semantics, Codex orchestration policy, and product state belong to the Murph runtime and hosted web owners. "Thin" means no business logic, not low line count.
- Warm reuse — container shell, workspace root, Codex process — is an optimization, never authority. Each message enters through the assistant input spine, revalidates current user/write-fence/config authority, uses invocation-local cache/temp state, and falls back to cold restore or process restart when safe reuse cannot be proven.
- Cloudflare container and Durable Object RPC methods are platform stub methods, not ordinary callbacks: invoke them directly on the stub, and keep test harnesses on that direct-call contract so local tests catch receiver/proxy bugs.
- All provider egress is Worker-mediated. Adding a new runtime tool, provider method, or provider API path is incomplete until the egress allowlist, sentinel credential rewrite, and focused regressions cover the exact upstream operation. Provider credentials in native slots identify provider/user/runner only; Worker egress validates current server-owned runtime state before injecting Worker-owned secrets, and container identifiers are not authorization.
- Keep one user-visible output as one typed value until its durable boundary; no hidden staging paths without a concrete product or reliability need.
- Detailed protocol case law: `agent-docs/references/hosted-runtime-protocol.md`.

## Observability And Logging

- Capture concrete structured error context at the root failure boundary, pass it through the shared redaction helper, then emit. No caller-local partial log shapes, one-off scrubbers, or coarse replacement buckets that discard status, provider code, retryability, operation, or cause before the boundary sees them.
- Error records keep both a stable machine-readable code and a redacted human-readable message/cause chain, end to end — persisted downstream copies included.
- Redaction masks the smallest unsafe span, not the artifact: a redactor that nulls a whole diagnostic value recreates the blindness it exists to prevent (anti-pattern: PRs 366/376). Structured content is extracted typed, never prose-masked.

## Append-Only Bias

- `raw/` is immutable by default; any repair rewrite is a named core primitive with manifest proof, metadata-only audit, and no raw payload leakage.
- `ledger/*.jsonl` and `audit/*.jsonl` are append-only by default; any future shard deletion needs its own named repair proof and architecture update.
- Markdown docs may change only in explicitly human-facing areas.

## Deferred Complexity

- No SQLite as canonical health storage. Rebuildable projections live under `.runtime/projections/**`; durable operational SQLite is allowed only for explicitly owned runtime stores with migrations and a documented snapshot/backup policy, such as device-sync state under `.runtime/operations/device-sync/state.sqlite`.
- Lexical search flows through the query projection. Vector search, OCR-heavy lab parsing, and local-model requirements stay deferred unless explicitly added to the contract.
- No automatic promotion of chat transcripts into canonical health state. The overnight memory consolidation automation is the one approved transcript-promotion boundary, deliberately narrower than health state: non-health durable user context only, written through `vault-cli memory upsert`/`vault-cli memory update`, sourced solely from the engine-supplied bounded conversation-evidence window, and never medical or health details, credentials, identifiers, or transient task detail.

## Frozen Current Choices

- Product CLI: `murph`. Raw explicit-vault CLI and operator surface: `vault-cli`.
- Public packages: `@murphai/murph`, `@murphai/openclaw-plugin`, `@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`.
- Workspace-private package families: `core`, `query`, `importers`, `parsers`, `health-metrics`, `health-commons`, `exercise-library`, `device-syncd`, `inboxd`, `inbox-services`, `messaging-ingress`, `runtime-state`, `assistant-engine`, `assistant-runtime`, `assistantd`, `operator-config`, `vault-usecases`, `assistant-cli`, `setup-cli`, `hosted-orchestrator-temporal`, `cloudflare-hosted-control`, `hosted-local-harness`.
- This roster must match the actual `packages/*` manifests; update it in the same change that adds, removes, or renames a package.
