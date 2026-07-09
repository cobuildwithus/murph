# Inline health-commons into runner bundles via env-pinned package root

## Context

Measured on the assembled runner bundle (2026-07-08, local M-series; container
CPU is ~2-3x slower): vault-cli spawns that touch `@murphai/health-commons`
cost ~810ms CPU vs ~410-510ms for other scoped commands. Cause:
`@murphai/health-commons` is listed in `RUNNER_BUNDLE_SHARED_EXTERNALS`, so
every commons-touching spawn evaluates its whole unbundled module graph from
`node_modules` — 114 individual module files, including a second full zod
(the bundles already inline one) and a second `@murphai/contracts` (~220ms of
duplicate zod schema construction plus per-file load cost).

health-commons is external for exactly one reason: `runtime.ts` resolves
generated JSON artifacts relative to `import.meta.url`
(`new URL("../generated/...", import.meta.url)`), which breaks when its JS is
inlined into an esbuild chunk (June 2026 deploy smoke: ENOENT on
`@murphai/murph/generated/protocol-index.json`). The repo already solved this
class twice with image-pinned env roots (`MURPH_ASSISTANT_SKILLS_ROOT`,
`MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH`).

Our utmost priority is clean, simple, long term maintainable and composable
architecture with minimal complexity.

## Success criteria

- `@murphai/health-commons` is no longer a runner-bundle external; its JS
  inlines into both the vault-cli bundle and the container-entrypoint bundle.
- Generated artifacts still resolve via a new env-pinned package root,
  `MURPH_HEALTH_COMMONS_PACKAGE_ROOT`, set in the Dockerfile to
  `/app/node_modules/@murphai/health-commons` (the package stays installed in
  the bundle for its `generated/` payload; dependency install is unchanged).
- Default behavior when the env var is unset is byte-for-byte what it is
  today (web app, local dev, unbundled dist diagnostics are unaffected).
- The full assembly gate passes: `pnpm --dir apps/cloudflare runner:bundle`
  (parity battery including the `commons protocol list` probe, import-surface
  probe, byte budgets, boot probe).
- The env var is platform-owned end to end: image ENV pin, member/runner env
  cannot override it, and codex-shell child processes receive it.

## Constraints

- Minimal complexity; no new dependency edges for a string constant.
  `packages/assistant-runtime` must NOT gain a `@murphai/health-commons`
  dependency; use literals plus the existing node-side literal-equality test
  pattern (`hosted-env-policy.ts` already does this for the engine asset-root
  names).
- Do not touch the `@murphai/exercise-library` externals entries (its
  external cost is 3 files / 15KB; changing it is speculative).
- No production/runtime invariants weakened for tests; probes get the env pin
  explicitly.
- Follow `AGENTS.md` hard rules (no `as any`, one-way deps, public
  entrypoints only).

## Implementation

1. `packages/health-commons/src/runtime.ts`
   - Export `MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV = "MURPH_HEALTH_COMMONS_PACKAGE_ROOT"`
     (mirrors `assistant-skill-env.ts` naming).
   - Add one small package-root resolver: if the env var is set, use it as a
     filesystem path (or URL string — follow the `stringToGeneratedWebRootUrl`
     precedent) with a trailing slash; otherwise fall back to today's
     `new URL("..", import.meta.url)` derivation.
   - Route the three `DEFAULT_GENERATED_PROTOCOL_*_URL` values and
     `defaultGeneratedWebRootUrl()` through it. For
     `defaultGeneratedWebRootUrl()`, the env-pinned root's `generated/web`
     becomes the first candidate ahead of the existing cwd probes; the rest of
     the candidate list stays as-is.
   - The env read must be honored at first use (module-scope caching of a
     pre-import env value is fine in production but make it testable — a
     lazily computed value or function is acceptable if that is the simplest
     honest shape).
2. `apps/cloudflare/scripts/runner-bundle/bundle-shared.ts`
   - Remove `@murphai/health-commons` and `@murphai/health-commons/*` from
     `RUNNER_BUNDLE_SHARED_EXTERNALS`; remove `/@murphai/health-commons/` from
     `RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS`.
   - Update the header comment: exercise-library remains external for
     asset-relative resolution; health-commons now inlines because its asset
     root is env-pinned (name the Dockerfile ENV and the probe wiring).
3. `apps/cloudflare/scripts/runner-bundle/bundle-cli.ts`
   - Parity probes and import-surface probes must spawn with
     `MURPH_HEALTH_COMMONS_PACKAGE_ROOT=<bundleDir>/node_modules/@murphai/health-commons`
     for BOTH the bundled and unbundled runs (outputs must stay
     byte-identical). Thread `bundleDir` into the probe helpers as needed.
4. `apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts`
   - The boot probe (`assertRunnerEntrypointBundleBoots`) spawns with the same
     env pin so lazy-chunk evaluation stays hermetic.
   - Byte budgets: the entrypoint bundle grows by health-commons' runtime JS.
     If the static-closure or entry ratchet trips, verify the growth is
     exactly the intended inline, then update the baseline constant to the
     measured value with a comment, per the existing baseline policy. Same for
     the vault-cli total budget if needed (currently ~7.1MB of 9MB).
5. `Dockerfile.cloudflare-hosted-runner`
   - `ENV MURPH_HEALTH_COMMONS_PACKAGE_ROOT="/app/node_modules/@murphai/health-commons"`
     beside the two existing asset-root pins; extend that comment block.
6. `apps/cloudflare/src/hosted-env-policy.ts`
   - Add the literal `"MURPH_HEALTH_COMMONS_PACKAGE_ROOT"` beside the two
     existing image-pinned asset-root literals (same platform-owned rationale:
     member/runner secrets must not redirect it).
7. `packages/assistant-runtime/src/hosted-runtime/environment.ts`
   - Add the name (literal, with the health-commons ownership noted in a
     comment) to both the forwarded-env denylist and the user-env denylist,
     beside the existing asset-root entries.
8. `packages/assistant-runtime/src/hosted-runtime/codex-shell-env-policy.ts`
   - Add the name to `HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY`. This is
     load-bearing: the include-only list is what lets vault-cli spawned inside
     codex shells see the pin. Without it, assembly probes pass but production
     commons commands ENOENT — after inlining, the `import.meta.url` fallback
     points inside the bundle directory, which has no `generated/` tree.
9. Tests
   - `apps/cloudflare/test/container-image-contract.test.ts`: assert the new
     ENV line.
   - `apps/cloudflare/test/hosted-env-policy.test.ts` (and wherever the
     node-side literal-equality assertions live): assert the policy literals
     equal `MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV` imported from
     `@murphai/health-commons/runtime` (apps/cloudflare already depends on
     health-commons; no new edge).
   - assistant-runtime env/codex-shell policy tests: list membership for the
     new name, following how the engine asset-root names are asserted.
   - `packages/health-commons` runtime test: env set → generated-artifact URLs
     resolve under the env root; env unset → current package-relative default.
   - Update any runner-bundle tests that pin the externals/forbidden-marker
     list contents.
10. Docs: update any durable doc that enumerates the runner-bundle externals
    or the image env pins (check `apps/cloudflare/DEPLOY.md`,
    `agent-docs/references/*`) in the same change.

## Verification

- `pnpm typecheck` (or the touched owners' scoped tsc builds).
- Scoped vitest for: apps/cloudflare (container-image-contract,
  hosted-env-policy, runner-bundle*), packages/health-commons,
  packages/assistant-runtime.
- Full gate: `pnpm --dir apps/cloudflare runner:bundle` must pass (parity
  battery including the commons probe is the regression test for the June
  ENOENT class).
- Post-assembly CPU readback (supervisor): `commons protocol list` CPU should
  drop from ~810ms to roughly the ~450-510ms band of other scoped commands.

## State

Active.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
