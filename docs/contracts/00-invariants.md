# Baseline Invariants

## Implementation Bias

- Prefer simple, composable primitives over complex abstractions. Add a new abstraction only when it removes real duplication, clarifies ownership, or makes an invariant easier to enforce.
- Treat improving agent capability as a design input. If a behavior can be handled by clear prompt/tool guidance and existing primitives, prefer that over bespoke orchestration code; do not preserve today's model limitations as permanent architecture.
- Add code around agents only for hard guarantees: security, privacy, state integrity, idempotency, latency/retry bounds, protocol compatibility, deterministic runtime behavior, or failures proven by tests or production evidence that prompt/tool guidance cannot reliably cover.
- Do not introduce broad managers, speculative frameworks, or compatibility layers when a named primitive, package-owned seam, or direct function can express the behavior clearly.
- Review, audit, and ReviewGPT findings are inputs to engineering judgment, not architecture ownership. Do not accept a finding by adding a new state owner, lifecycle, queue, reconciliation loop, policy manager, or abstraction when the invariant can be preserved by deleting code, reordering existing writes, tightening an existing owner boundary, deriving from one source of truth, or adding a focused regression around the existing primitive.
- If a review-suggested fix makes the architecture broader, require production-path proof that the simpler owner-boundary fix cannot satisfy the invariant. Otherwise reject, defer, or redesign the finding before changing code.
- Keep production/source code free of branches, exports, routes, helpers, fixtures, and flags that exist only for tests or harnesses. Test-only needs belong in test files, fixtures, support modules, or test-specific composition outside the production source surface.
- If a test needs a new source seam, make it a real production seam with clear runtime ownership and product/debug value. Do not widen package exports, public APIs, runtime env branches, or internal object methods only to make a harness easier to drive.
- Tests and E2E checks should mock the fewest boundaries needed to stay deterministic and affordable. Prefer production-faithful libraries, binaries, protocols, and runtime integrations over bespoke mocks; stub only external provider edges, secrets, clocks, or failure cases that cannot safely run in repo automation.

## Durable Authority And Recovery

- Any operation that resumes, wakes, mutates, egresses, delivers, deletes, exports, or recovers user state across web, Cloudflare, assistant-runtime, provider callbacks, or UI routes must revalidate an explicit durable authority tuple owned by the source-of-truth plane. Process-local pointers, dashboard/layout state, provider callback state, session presence, or cached "active" state may optimize only after durable authority is proven.
- A session proves who is present, not that a sensitive or lifecycle-specific action is authorized. Destructive actions, bulk exports, managed-auth completion, mailbox resume, checkout recovery, provider egress, and runtime wake/reuse must bind to the narrow action, user/member, route/target, attempt/lease/fence, freshness proof, or row lock that owns that action.
- If durable authority is missing, stale, ambiguous, or mismatched, fail closed or fall back to the narrower safe flow. Do not "complete" by trusting ambient UI state, process memory, or provider success alone.

## Product-Critical Flow Preservation

- Do not fix safety, reliability, privacy, auth, or review findings by disabling, silently dropping, or degrading an existing user-critical flow unless the user explicitly asks for that product change.
- User-critical flows include onboarding, signup and welcome delivery, replies to a current inbound message, billing and access transitions, authentication, device/data sync, and privacy or safety controls.
- Any change that tightens a guard, permission check, egress policy, retry rule, route selection, or delivery decision must preserve an authorized success path for the existing UX, or replace it with an explicitly designed product path. Prove that path with a production-faithful test, E2E, or owner-level integration check.
- If safety and UX appear to conflict, stop and surface the tradeoff. Do not ship a silent no-op, dropped message, blocked onboarding path, or unreachable recovery path as a safety fix.

## Stable Idempotency Identity

- Durable product identity, dedupe identity, idempotency keys, and revision identity must be derived from stable product/provider facts, not machine-local rows, runtime-local ids, mutable provider versions, media URLs, callback timing, or session-specific storage.
- If two paths intentionally overlap — retry, replay, push+pull ingestion, warm/cold runtime restart, provider webhook reorder, outbox resend, media normalization, or migration re-entry — the shared identity must make overlap safe by construction.
- A new write path is not complete until it names the stable identity it uses for idempotency, explains which mutable fields are excluded, and has a regression proving retry/replay/cold-start overlap does not duplicate or lose the user-visible fact.

## Minimal Mechanism Bias

- For "do this exactly once," start with a stable identity, a uniqueness constraint, and an idempotent write the losing caller can no-op on. Reach for processing-state columns, leases, owner tokens, or fences only when a concrete downstream failure cannot be expressed as a uniqueness or dedupe key at the layer where it actually lives.
- Trust idempotency at the side-effect layer first. If each write, send, or row a path produces is individually retry-safe via its own unique key or upsert, a top-level processing fence usually adds failure modes (stuck leases, owner mismatch on redeploy, replay-vs-reclaim races) without removing any.
- Treat fix-loop length as a design signal. When a single protocol picks up double-digit "fix: preserve/scope/fence/reclaim" commits chasing edge cases, the abstraction is wrong; fall back to the smallest primitive the proven failure requires. PR 320 is the named anti-pattern.

## Ordered Progress And Causal Anchors

- Any persisted cursor, mailbox sequence, pending-input index, consume ack, wake gate, receipt watermark, or paginated read must use a total, transitive, owner-shared ordering primitive. Do not duplicate timestamp comparators, pick timestamp fields pairwise, or rely on ordering that can make persisted records unreachable or repeated.
- Import progress is not handling progress; checkpoint progress is not delivery progress; scanner discovery is not consume authority. Consume/clear/advance only from owner-provided coverage plus terminal evidence, and preserve gates when a later pass sees no current work but older retryable work still exists.
- Post-checkpoint side effects are state transitions, not auxiliary logs. When a post-checkpoint send, cleanup, or provider mutation consumes a pending wake or delivery effect, its result must replace the pre-side-effect wake/status before the next durable checkpoint; do not preserve stale due wakes or pending counters with a scheduler/harness retry.
- Explicit causal anchors beat positional heuristics: provider reply ids, selected input ids, delivery-context ordinals, server sequences, and segment ordinals must be resolved before "latest", "oldest", grouping, watermarks, or time-window fallbacks. Events with different explicit anchors must not be grouped into one turn.

## Deliverability And Provider Capability Contract

- A saved automation, assistant side effect, notification, media response, or provider call must carry a concrete deliverable/authorized target before it can be persisted as executable or run side effects. Continuity locators, thread ids, redacted/private placeholders, route hints, and dashboard state are context only; they are not delivery targets.
- Channel/provider capability must be one typed contract from planning through outbox/delivery service, hosted side-effect parsing, platform egress, and regression tests. Adding a new provider, media kind, channel operation, or runtime tool is incomplete until the exact operation has target validation, idempotency identity, and egress authorization.
- External provider API request and response shapes should come from the provider's canonical SDK or published typed contract when that SDK is lightweight, actively maintained, exact-version-pinnable, and compatible with our credential and egress authority boundaries. Do not roll bespoke provider request types or hand-shaped payloads by default; if a custom boundary is necessary because the SDK is too heavy, unpinnable, stale, or would move authority/credentials to the wrong owner, document that reason and cover the exact provider JSON shape with focused tests.
- Invalid routes or unauthorized provider operations must fail before model execution, delivery, provider mutation, or generated subject/media work. Do not add a scheduler, queue, route-repair worker, or broad abstraction to compensate for an invalid route shape.

## Decision Sources And Projection Drift

- Any user-visible gate, billing/usage decision, experiment outcome, lifecycle automation, export completeness check, or safety/freshness claim must name its authoritative source. Caches, current-period aggregates, sparse entity models, browser/dashboard snapshots, runtime state, and SQLite projections are accelerators unless their owner contract explicitly makes them the decision source.
- If a cached aggregate can lag an append-only ledger or canonical source, reads that enforce limits or report status must reconcile against the authoritative source and repair bounded aggregates only in the owning mutating path.
- Do not add raw-vault fallbacks, provider-specific remapping, duplicate persisted state, or larger projection payloads when the owned projection/ledger already contains the decision-grade facts. Prefer passing the existing projection rows into pure analysis functions over creating another state owner.

## Production-Faithful Seams And Executable Architecture Budgets

- If an invariant exists to keep a hot path small, a protocol boundary faithful, or a dependency surface narrow, make it executable with deterministic graph, byte, package-surface, shape, or protocol-contract tests. A docs-only invariant is not enough when one static import or shim drift can silently defeat it.
- Test doubles may stand behind the real production adapter/protocol, but they must not reimplement owned production protocols in parallel. Prefer the real binary/library/protocol with stubbed external provider edges over a fake owner protocol that can drift while tests stay green.
- A new abstraction, shim, compatibility layer, or generated test harness must have an owner, a deletion path, and a reason stronger than convenience. If the simpler path is to delete the shim and exercise the production seam, delete it.

## Latency And Scan Bounds

- Do not add unbounded linear-or-worse scans over any growing collection, including repo files, vault records, runtime state, database rows, object-store keys, mailbox items, transcripts, logs, API result sets, or in-memory accumulators. Any path that can run during user-visible work, recurring jobs, deploy checks, or normal local commands must use a bounded window, limit, cursor, index, manifest, precomputed projection, exact key lookup, or explicit pagination. Intentional full scans are allowed only for bounded fixture data, one-shot migrations, offline/admin repair tools, or diagnostics with a documented size cap and operator-visible cost.

## Hosted Workspace File Cardinality

- Hosted workspace restore/checkpoint treats file count as a latency, memory, and privacy budget. A routine feature must not create an unbounded number of small files under the restored workspace just because each file is small.
- Before adding a new workspace write family, classify the state, choose a compact storage shape, define snapshot inclusion or exclusion, and document retention or compaction. Prefer existing shards, ledgers, manifests, SQLite stores, or owner documents over per-event file trees.
- Detailed rule: `docs/contracts/06-hosted-workspace-file-count.md`.

## Canonical Storage

- Human-facing truth lives in Markdown: `CORE.md`, `journal/`, and `bank/`.
- Machine-facing truth lives in JSONL: `ledger/events`, display-grade `ledger/metric-samples`, explicit raw/debug `ledger/samples`, and `audit`. Generic `ledger/samples` shards are not part of the default query/read/browser model.
- Imported originals live in `raw/` and are immutable once copied into the vault, except for explicit core-owned repair tombstones that prove the old manifest byte/SHA and preserve durable product facts.

## Query Metrics

- Experiment progress, protocol outcome, and other decision-grade metric-window comparisons must use normalized metric points plus the shared metric series/window comparison primitives. Wearable day summaries are presentation/context summaries and must not be the source of truth for those analysis windows.

## Write Authority

- Only `packages/core` may mutate canonical vault data.
- `packages/importers` may parse and prepare external data, but all canonical writes must call core APIs.
- `packages/cli` may never write vault files directly.

## Agent-Visible CLI Payloads

- Agent-primary `add`, `save`, and `edit` commands must expose their normal input shape through native Incur args and options so `--help`, `--schema`, `--llms`, MCP, and generated skills stay truthful.
- Nested, batch, or document-derived JSON payloads that do not fit typed flags must be explicitly named JSON escape hatches such as `import-json` or `import-jsonl`, not hidden behind canonical typed command names.
- Every agent-visible command that accepts a complex `--input @file|-` payload must provide a paired Incur-discoverable shape path. For supported JSON/JSONL import surfaces, the exact contract is a sibling `payload-schema` command; `scaffold` is a representative example payload. Do not require agents to infer payload shapes from source code, tests, prompts, or stale docs.
- The runtime importer and the emitted payload schema must share the same owned normalization or schema path where practical, and scaffold/template payloads should validate against that contract when the command exposes one.

## Assistant Boundary

- Agent layers, MCP surfaces, and future UIs call `murph`, `vault-cli`, or exported package APIs.
- Assistant runtime state is stored under `vault/.runtime/operations/assistant/**`.
- Durable user-facing memory and scheduled prompt configuration live in canonical vault records, not assistant runtime state.
- If a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical vault records or explicit derived materializations, never in assistant runtime state.
- No agent gets arbitrary write access to vault files as part of the public contract.

## User-Facing Message Sends

- Do not hard-code messages that automatically send to users, except for the AI usage gate, signup link delivery, first welcome, Linq daily text quota, Linq home-thread redirect, and billing cancellation feedback email. The Linq quota and home-thread redirects are narrowly scoped policy responses that preserve admission/routing invariants before assistant generation runs. All other automatic outbound user messages must come from the normal AI-gated assistant path, an explicit user/operator-authored message, or another reviewed product-copy surface that is not sent automatically.

## Hosted Foreground Priority

- User conversation messages are the highest-priority hosted runtime work.
- Background device sync, provider cleanup, browser-vault refresh, maintenance, and idle checkpointing must never block assistant admission or reply delivery for fresh user input.
- Idle-only work must be preemptible. If fresh user input arrives while background maintenance or idle checkpointing is running, that work must yield, abort, or reschedule instead of making the user message wait for completion.
- Assistant reply code must not import, call, await, or coordinate with device-sync execution. Device sync may preserve a follow-up wake or recovery marker, but it must stay out of the foreground reply path.
- Foreground preemption is not permission to publish partial or corrupt state. Wrong-user authority, stale lease, invalid auth, undecryptable mailbox payloads, and checkpoint compare-and-swap conflicts still fail closed.
- Observability writes are never user latency. Engineering-facing telemetry — runtime logs, latency traces, diagnostics, metrics — must not sit synchronously on the user-visible reply path (message accept through provider start and reply delivery). Queue or fire-and-forget such writes and flush them off-path (invocation end, idle), preserving enqueue order and logical timestamps. Bounded exception: warn/error crash-tail writes may block so failure forensics stay durable. A new milestone or instrumentation write defaults to non-blocking; making one synchronous requires a documented correctness reason, not convenience. (Measured 2026-06: each awaited best-effort log write cost a full runner→worker→web round trip on the reply hot path.)

## Hosted Runner Boundary

- Cloudflare must remain a thin execution runner over the same Murph runtime used locally. It may own platform coordination, workspace restore/checkpoint transport, write fences, secret injection, and process cleanup, but assistant business logic, vault semantics, Codex orchestration policy, and product state belong to the Murph runtime and hosted web owners.
- Cloudflare container and Durable Object RPC methods are platform stub methods, not ordinary callbacks. Invoke them directly on the stub (`container.method(...)`) instead of detaching, binding, wrapping, or passing them around; test harnesses for these seams must preserve that direct-call contract so local tests catch Cloudflare-style receiver/proxy bugs.
- Assistant-engine owns one reusable Codex App Server slot per Node runtime/container for the current stable process identity. A turn is an RPC into that process; clean successful turns leave it idle, while overlapping direct turns fail busy instead of creating a process map. Identity/config mismatch, abort cleanup, malformed active-turn output, process failure, or idle explicit shutdown stops or poisons it before a later turn can reuse it. Parent-thread output/tool/terminal state from a reused warm process is accepted only when Codex scopes it to the active turn id; unscoped parent-thread server requests are denied, and other unscoped parent-thread events are not projected into the active turn.
- Codex App Server process env is for process authority/configuration. Hosted and non-hosted warm identity hashing must cover the exact child process env passed to Codex. If a value should not affect warm reuse, do not put it in the Codex process env; pass it through Codex RPC or an active runtime seam instead. Prompt text, session ids, and assistant turn ids are turn request data and must not be smuggled into process env in a way that makes ordinary turns restart the warm process.
- Native Codex thread resume must receive the current non-instruction execution context through RPC, including cwd, model/provider, sandbox, and approval policy. Resume state is continuity, not permission to keep stale execution policy from the original thread or process launch. When stale resume is detected, the product provider must fall back to a fresh thread for the same user turn instead of failing to reply.
- Codex warm reuse is the default contract, not best-effort convenience. Messages in the same warm Node runtime/container must reuse the existing Codex App Server process when the stable process identity still matches, cleanup proof succeeded, and the process is idle; ordinary new messages must not force process restart through turn-scoped env, prompt, session, or delivery data.
- Hosted container invocations must attempt native Codex thread resume from saved assistant session state when the saved resume fingerprint matches the restored rollout/session files and the current authority/configuration identity. A fingerprint mismatch, missing rollout file, failed proof that the file belongs to the saved thread, or stale execution policy invalidates native resume for that turn; the runtime must use a fresh-thread fallback, preserve the broader assistant session binding when ownership and authority still match, and replace Codex resume metadata only through the normal successful turn/checkpoint path.
- Whole Codex config file content is not part of the warm launch key. Per-thread-safe values such as model selection may vary through thread RPC while a warm app-server process is reused. Process authority such as explicit `--config` provider-table overrides, command, cwd, or child env is launch-affecting identity.
- Match state lifetime to scope: process state is for process configuration only. Request, turn, message, delivery, and user-action facts must be passed as explicit operation data or owned by a runtime object with that same lifetime.
- Keep one user-visible output as one typed value until its durable boundary. Do not split reply text, media, delivery options, or metadata across hidden staging paths unless a concrete product or reliability need proves that the simpler value flow is insufficient.
- Hosted execution should reuse warm in-container runtime infrastructure across messages while the same container remains alive and the authority/configuration identity still matches. That includes the Node process, restored workspace root, and Codex App Server process where cleanup proof and write-fence validity make reuse safe.
- Warm-container lifecycle code must not shut down the app-server process or outer runtime while a foreground assistant turn is active. Idle shutdown, activity expiry, or post-turn process cleanup may only stop idle or poisoned processes; active turns are interrupted through the explicit turn abort/interrupt path and keep the app server alive until terminal turn handling or poisoning completes.
- Warm container reuse is only an optimization. Each message still enters through the assistant input spine, validates current user/write-fence/config authority, uses invocation-local cache/temp state, and falls back to cold restore or process restart when safe reuse cannot be proven.
- Intercepted provider APIs are part of the hosted runner boundary. Adding a new runtime tool, provider method, or provider API path for OpenAI, Exa, Mapbox, Linq, Telegram, WhatsApp, or another Worker-owned credential is not complete until the Cloudflare egress allowlist, sentinel credential rewrite, and focused regression tests cover the exact upstream operation.
- Hosted provider credentials placed in native provider slots identify the provider, hosted user, and runner only. They must not be treated as standalone authority: Worker egress must validate current server-owned runtime state for that user/runner/provider before injecting any Worker-owned provider secret. Container runtime identifiers such as outbound `ctx.containerId` are not authorization.

## Observability And Logging

- Repo logs should follow one model: capture concrete structured error context at the root failure boundary, then emit only the shared-redacted form. Do not build caller-local partial log shapes that discard status, provider error code, retryability, cause, or operation before the logging boundary sees them.
- When an error is safe to persist or publish, preserve the full error chain and structured context, then pass it through the shared redaction helper before emission. The shared redactor must remove secrets, keys, credentials, tokens, authorization headers, and user/provider-facing direct identifiers.
- Error logs must include both a machine-readable failure code or category and a redacted human-readable message or cause summary. A code without the redacted message/cause chain is not enough for later debugging, and a message/cause chain without a stable code is not enough for aggregation.
- Log the error itself after shared redaction: code/category, status when present, retryability/disposition, and redacted message/cause/detail. Do not replace concrete diagnostics with coarse buckets such as `external_code` unless the shared redactor cannot make the value safe.
- Prefer shared redaction and complete structured errors over hand-crafted partial error strings, one-off scrubbers, caller-local redaction rules, provider-specific logging allowlists, or coarse replacement buckets. Local-only debugging should keep enough concrete path/id/value evidence to prove root cause, while keeping secrets out.
- Persisted error records are part of the logging boundary: keep structured context on the shared error object instead of creating downstream code/message-only copies that silently drop status, provider codes, operation, retryability, description, or cause.

## Append-Only Bias

- `raw/` is immutable by default; any repair rewrite must be a named core primitive with manifest proof, metadata-only audit, and no raw payload leakage.
- `ledger/*.jsonl` and `audit/*.jsonl` are append-only by default. The wearable storage repair may report dense provider-generated debug shard candidates, but v1 does not delete `ledger/samples/**`; any future shard deletion needs its own named repair proof and architecture update.
- Markdown docs may change only in explicitly human-facing areas.

## Deferred Complexity

- No SQLite as canonical health storage. Rebuildable SQLite projections belong under `.runtime/projections/**`. Durable non-canonical operational SQLite is allowed only for explicitly owned runtime stores with migrations and a documented snapshot/backup policy, such as device-sync control and credential state under `.runtime/operations/device-sync/state.sqlite`.
- Lexical search is allowed through the query projection.
- Vector search is deferred unless it is explicitly added to the contract.
- No OCR-heavy lab parser.
- No local-model requirement.
- No automatic promotion of local or provider chat transcripts into canonical health state.

## Frozen Current Choices

- Product CLI: `murph`
- Raw explicit-vault CLI and operator surface: `vault-cli`
- Public packages:
  - `@murphai/murph`
  - `@murphai/openclaw-plugin`
  - `@murphai/contracts`
  - `@murphai/hosted-execution`
  - `@murphai/gateway-core`
- Workspace-private package families:
  - `core`
  - `query`
  - `importers`
  - `device-syncd`
  - `inboxd`
  - `runtime-state`
  - `assistant-engine`
  - `assistant-runtime`
  - `assistantd`
  - `operator-config`
  - `messaging-ingress`
  - `vault-usecases`
  - `assistant-cli`
  - `setup-cli`
