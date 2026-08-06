# Lazy-load dynamic-tool execution

Status: active
Created: 2026-08-06
Updated: 2026-08-06

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
- Keep malformed computer requests in the serialized command queue. They are
  still computer actions from the provider's perspective, even though parsing
  produces an error request rather than an executable action.
- Convert a failed runtime import into a request-level RPC error, while routing
  unexpected asynchronous handler failures through the turn's existing
  rejection owner so they cannot become unhandled promise rejections.
- Keep individual tool definition modules eager for now because the provider
  catalog needs their descriptors. This PR defers the 187,998 B combined
  parser/executor chunk without duplicating schemas or splitting every handler.

## Verification

- Production runner assembly passed: entry 1,729,822 B; static closure
  8,423,625 B; total output 10,298,362 B. Against the exact clean-main baseline,
  the static closure is 172,618 B smaller while the lazy split adds 15,808 B to
  total output. The static byte budget is ratcheted to the new measurement and
  rejects `dynamic-tools.js` if it re-enters the boot closure.
- Twenty alternating Docker amd64-emulation samples per arm measured baseline
  versus candidate p50 1,126.0/1,079.5 ms and p90 1,202.1/1,195.0 ms; paired
  median delta was -27.3 ms. Excluding the candidate image's first layer-cold
  sample, the paired median was -32.4 ms. Treat the timing as directional under
  emulation; the deterministic result is the 172,618 B closure reduction.
- Ten fresh candidate containers measured the deferred chunk import at a 10.4
  ms median after entrypoint readiness.
- Production assembly's lazy-chunk boot probe passed, and a normal container
  health smoke returned healthy as the non-root `runner` user.
- Assistant Engine and Cloudflare typechecks passed. Focused Assistant Engine
  catalog/planning/runtime tests passed (191 tests), the failure/abort ordering
  regression passed, and Cloudflare bundle tests passed (35 tests).
- The package-wide Assistant Engine suite reached the existing roughly 4 GiB
  fork memory ceiling and its Vitest parent did not terminate after the worker
  OOM. The exact owned test session was interrupted after the crash; focused
  proof and exact-head CI remain the applicable gates.
