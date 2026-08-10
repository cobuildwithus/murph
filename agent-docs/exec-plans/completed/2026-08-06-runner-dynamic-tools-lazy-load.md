# Lazy-load dynamic-tool execution

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Remove dynamic-tool parsing and execution code from the runner's eager Node
  startup graph while preserving the tool catalog needed before provider start.
- Load the execution runtime only when Codex sends a dynamic-tool server request.

## Success criteria

- Turns that do not call a dynamic tool do not evaluate the dynamic-tool runtime
  during runner startup or provider initialization.
- The full catalog, availability behavior, tool schemas, and public exports keep
  their existing semantics.
- The first and subsequent dynamic-tool calls execute correctly, including
  concurrent requests and terminal-turn rejection.
- The production runner bundle is measurably smaller on its eager path, focused
  Assistant Engine tests and typechecking pass, and local Docker startup proof
  shows the effect or demonstrates that the change is not worth shipping.
- Exact-head CI and required completion reviews have no unresolved findings.

## Scope

- In scope:
  - Split the dynamic-tool catalog from request parsing and execution.
  - Cache one ESM import promise and await it on accepted server requests.
  - Add static bundle and runtime regression proof.
- Out of scope:
  - Changing tool schemas, availability, behavior, or user-visible copy.
  - Lazy-loading individual tool handlers after the runtime is loaded.
  - Outbox scanning, snapshot restore, container-layer compaction, or Zod import
    surface changes.

## Constraints

- Preserve package ownership and existing public entrypoints.
- Preserve request authentication and turn-terminal checks before execution.
- Do not add a new state owner, queue, dependency, or compatibility layer.
- Keep this change independent of the Zod startup PR.

## Risks and mitigations

1. Risk: an asynchronous import races with turn completion.
   Mitigation: reject terminal turns both before and after awaiting the module.
2. Risk: concurrent first calls initialize separate runtimes.
   Mitigation: share one module-level ESM import promise.
3. Risk: catalog extraction changes schema identity or availability order.
   Mitigation: move existing declarations unchanged and run existing catalog,
   planning, prompt, and dynamic execution tests.
4. Risk: the import await lets a later stdout event advance mutable delivery
   context before an earlier tool request captures its owner.
   Mitigation: capture the request-time ordinal before the first await and use
   that immutable value throughout parsing, execution, and patch application.

## Tasks

1. Measure the current eager graph and identify the exact catalog/runtime seam.
2. Extract the catalog and route production static imports to it.
3. Load parsing and execution on the first accepted dynamic-tool request.
4. Add bundle and runtime regression proof; run focused tests and Docker timing.
5. Commit, push, open a separate PR, run exact-head CI and completion reviews,
   then close this plan with `scripts/finish-task`.

## Decisions

- Keep the provider-visible catalog eager because it is needed to construct the
  first provider request. Defer only parsing and execution, which are unused on
  ordinary text-only turns.
- Use native ESM caching plus one explicit promise rather than a loader manager.
- Track accepted requests while the shared import resolves. A request observed
  before a terminal event remains owned by that turn, so failure cleanup first
  lets it register its execution and then aborts/drains the work. The existing
  immediate turn-failure image-generation regression caught and now proves this
  ordering boundary.
- Capture each accepted tool request's delivery-context ordinal before awaiting
  the lazy runtime. This preserves the former synchronous request-observation
  semantics even when a completed steered user message follows the tool call in
  the same stdout batch.
- Keep malformed computer requests in the serialized command queue. They are
  still computer actions from the provider's perspective, even though parsing
  produces an error request rather than an executable action.
- Convert a failed runtime import into a request-level RPC error, while routing
  unexpected asynchronous handler failures through the turn's existing
  rejection owner so they cannot become unhandled promise rejections.
- Keep individual tool definition modules eager for now because the provider
  catalog needs their descriptors. This PR defers the 187,998 B combined
  parser/executor chunk without duplicating schemas or splitting every handler.

## Round 2 requirement-level retrospective

Decision: continue the complete catalog/runtime separation as one change.

- The original requirement is to keep the provider-visible dynamic-tool
  catalog available before the first provider request while removing parsing
  and execution from Node's startup closure. The first-reviewed implementation
  contained 1,526 additions and 1,373 deletions of authored production source
  (2,899 churn lines); the current implementation contains 1,528 additions and
  1,375 deletions (2,903 churn lines).
- The measured result justifies the boundary: 172,747 static-closure bytes move
  off startup, ordinary text-only turns never evaluate that runtime, controlled
  Docker timing moved directionally by -27.3 ms at the median, and the first
  tool call pays a 10.4 ms median import. The tradeoff is a 15,679-byte increase
  in total emitted output from the lazy boundary.
- The separate eager catalog is necessary because Codex needs exact tool names,
  schemas, descriptions, order, and availability before it can issue a tool
  request. Keeping the former combined module eager fails the requirement;
  loading the combined module lazily makes provider planning impossible.
- The single process-local import promise makes initialization and failure one
  explicit boundary for concurrent first calls. Repeating direct `import()`
  expressions would still rely on Node's implicit module cache and would not
  remove the underlying process-wide state; the named promise keeps that state
  explicit without adding a manager, retry policy, or lifecycle service.
- The turn-local accepted-request set extends the existing execution and
  progress drains across the new import await. Without it, terminal cleanup can
  finish before an already accepted request registers on the serialized
  execution chain. It is not a second queue or durable owner and disappears
  with the turn.
- The static-closure exclusion and byte ratchet extend the existing production
  assembly guard. They are required to prevent a future import from silently
  undoing the only measured benefit; they add no runtime state.
- Splitting every individual tool handler would create many more module
  boundaries while the provider still needs their eager descriptors. Starting
  the runtime speculatively on every turn would avoid first-tool latency only by
  evaluating it for text-only turns, contrary to the requirement. Splitting the
  catalog move from request ownership would leave either PR without a safe,
  measurable production behavior.
- Review-driven production growth is two additions and two deletions: the sole
  accepted round-one correction moves immutable delivery-context capture before
  the import await. Its production-shaped regression adds coverage but no state
  or lifecycle owner. The correction remains the smallest fix and introduces
  no repeated mechanism.

## Verification

- Production runner assembly passed on current main: entry 1,641,254 B; static
  closure 7,885,509 B; total output 9,902,746 B. Against the exact merged-main
  baseline, the static closure is 168,095 B smaller while the lazy split adds
  17,669 B to total output. The static byte budget is ratcheted to the new
  measurement and rejects `dynamic-tools.js` if it re-enters the boot closure.
- Merging current main exposed one stale root-Zod import in the extracted eager
  catalog. The production locale guard failed the assembly, the catalog was
  routed through `@murphai/contracts/zod-runtime`, and the complete assembly
  then passed with only the English locale in the static closure.
- Twenty alternating Docker amd64-emulation samples per arm measured baseline
  versus candidate p50 1,126.0/1,079.5 ms and p90 1,202.1/1,195.0 ms; paired
  median delta was -27.3 ms. Excluding the candidate image's first layer-cold
  sample, the paired median was -32.4 ms. Treat the timing as directional under
  emulation; the deterministic result is the 172,618 B closure reduction.
- Ten fresh candidate containers measured the deferred chunk import at a 10.4
  ms median after entrypoint readiness.
- A post-merge ten-pair alternating Docker run on the currently contended local
  host measured baseline/candidate p50 2,264.6/2,351.2 ms and a mixed-sign
  paired median of +19.8 ms. This run is not directionally useful and does not
  replace the earlier controlled comparison; the exact static-closure reduction
  remains the reliable combined-head proof.
- Production assembly's lazy-chunk boot probe passed, and a normal container
  health smoke returned healthy as the non-root `runner` user.
- Assistant Engine and Cloudflare typechecks passed. The post-merge focused
  Assistant Engine catalog/planning/runtime selection passed 529 tests, the
  failure/abort ordering regression passed, and the combined Cloudflare bundle
  guard passed 42 tests.
- The package-wide Assistant Engine suite reached the existing roughly 4 GiB
  fork memory ceiling and its Vitest parent did not terminate after the worker
  OOM. The exact owned test session was interrupted after the crash; focused
  proof and exact-head CI remain the applicable gates.
- Final ReviewGPT round 1 found that the new import await preceded delivery-
  context capture, so a later steered `user_message` in the same stdout batch
  could rebind an earlier accepted request. The production-shaped regression
  failed against that reviewed head with no-reply ordinal `[1]`, then passed
  with `[0]` after moving capture before the await. The same turn proves both
  the first import and cached import path, keeps preflight/execution ordinals at
  `0` and `1`, and leaves the latest follow-up reply visible. All five focused
  dynamic-runtime tests and Assistant Engine typecheck pass.
- Final ReviewGPT round 3 accepted the requirement-level retrospective, verified
  the round-one ownership correction against the complete exact-head snapshot,
  and returned PASS with no remaining qualifying finding.
Completed: 2026-08-07
