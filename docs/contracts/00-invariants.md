# Baseline Invariants

## Implementation Bias

- Prefer simple, composable primitives over complex abstractions. Add a new abstraction only when it removes real duplication, clarifies ownership, or makes an invariant easier to enforce.
- Do not introduce broad managers, speculative frameworks, or compatibility layers when a named primitive, package-owned seam, or direct function can express the behavior clearly.
- Keep production/source code free of branches, exports, routes, helpers, fixtures, and flags that exist only for tests or harnesses. Test-only needs belong in test files, fixtures, support modules, or test-specific composition outside the production source surface.
- If a test needs a new source seam, make it a real production seam with clear runtime ownership and product/debug value. Do not widen package exports, public APIs, runtime env branches, or internal object methods only to make a harness easier to drive.

## Canonical Storage

- Human-facing truth lives in Markdown: `CORE.md`, `journal/`, and `bank/`.
- Machine-facing truth lives in JSONL: `ledger/events`, display-grade `ledger/metric-samples`, explicit raw/debug `ledger/samples`, and `audit`. Generic `ledger/samples` shards are not part of the default query/read/browser model.
- Imported originals live in `raw/` and are immutable once copied into the vault, except for explicit core-owned repair tombstones that prove the old manifest byte/SHA and preserve durable product facts.

## Write Authority

- Only `packages/core` may mutate canonical vault data.
- `packages/importers` may parse and prepare external data, but all canonical writes must call core APIs.
- `packages/cli` may never write vault files directly.

## Assistant Boundary

- Agent layers, MCP surfaces, and future UIs call `murph`, `vault-cli`, or exported package APIs.
- Assistant runtime state is stored under `vault/.runtime/operations/assistant/**`.
- Durable user-facing memory and scheduled prompt configuration live in canonical vault records, not assistant runtime state.
- If a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical vault records or explicit derived materializations, never in assistant runtime state.
- No agent gets arbitrary write access to vault files as part of the public contract.

## User-Facing Message Sends

- Do not hard-code messages that automatically send to users, except for the AI usage gate, signup link delivery, and the first welcome. All other automatic outbound user messages must come from the normal AI-gated assistant path, an explicit user/operator-authored message, or another reviewed product-copy surface that is not sent automatically.

## Hosted Foreground Priority

- User conversation messages are the highest-priority hosted runtime work.
- Background device sync, provider cleanup, browser-vault refresh, maintenance, and idle checkpointing must never block assistant admission or reply delivery for fresh user input.
- Idle-only work must be preemptible. If fresh user input arrives while background maintenance or idle checkpointing is running, that work must yield, abort, or reschedule instead of making the user message wait for completion.
- Assistant reply code must not import, call, await, or coordinate with device-sync execution. Device sync may preserve a follow-up wake or recovery marker, but it must stay out of the foreground reply path.
- Foreground preemption is not permission to publish partial or corrupt state. Wrong-user authority, stale lease, invalid auth, undecryptable mailbox payloads, and checkpoint compare-and-swap conflicts still fail closed.

## Hosted Runner Boundary

- Cloudflare must remain a thin execution runner over the same Murph runtime used locally. It may own platform coordination, workspace restore/checkpoint transport, write fences, secret injection, and process cleanup, but assistant business logic, vault semantics, Codex orchestration policy, and product state belong to the Murph runtime and hosted web owners.
- Assistant-engine owns one reusable Codex App Server slot per Node runtime/container for the current stable process identity. A turn is an RPC into that process; clean successful turns leave it idle, while overlapping direct turns fail busy instead of creating a process map. Identity/config mismatch, abort cleanup, malformed output, off-turn output, process failure, or idle explicit shutdown stops or poisons it before a later turn can reuse it.
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

## Observability And Logging

- Log errors at the root failure boundary, where the system first has enough context to classify the failing owner, operation, and cause. Do not scatter patchwork logs across callers, retries, or fallback layers to compensate for an unclear source.
- When an error is safe to persist or publish, preserve the full error chain and structured context, then pass it through the shared redaction helper before emission. The shared redactor must remove secrets, keys, credentials, tokens, authorization headers, and user/provider-facing direct identifiers.
- Prefer shared redaction and complete structured errors over hand-crafted partial error strings, one-off scrubbers, or caller-local redaction rules. Local-only debugging should keep enough concrete path/id/value evidence to prove root cause, while keeping secrets out.

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
