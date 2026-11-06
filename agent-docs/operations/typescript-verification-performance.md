# TypeScript Verification Performance

Last verified: 2026-10-20

## Purpose

This guide owns Murph's TypeScript worker budgets, optional shared-host
admission, incremental CI reuse, editor adoption, watch lane, and benchmark
method.

The design stays deliberately small:

- tsrs checks and emission use four checkers outside the shared-host profile.
- When selected locally, Codex `test:diff` and acceptance commands use the
  conservative shared-host profile by default; explicit offload can run them
  through Crabbox on a dedicated static Mac.
- One root runner selects pinned tsrs for checks and emission on supported hosts,
  retains TypeScript 7 fallback, and owns the lane's worker flags.
- Host admission uses temporary directories. It has no daemon, database,
  persistent coordinator, hardware detector, or cross-worktree config file.
- The admission helper never signals or terminates another worktree's process.

## Compiler Boundaries

`scripts/run-typescript.mjs` selects pinned tsrs for every lane on supported
hosts. The explicit `check`, `web`, and `watch` lanes force `--noEmit`.
`package` and `workspace-build` honor the config's emission settings, covering
package builds, clean/incremental workspace graphs, prepared test runtimes,
Cloudflare builds and smoke bundles, and local build prerequisites.

The adoption comparison produced identical JavaScript and source maps across
5,284 output files. Thirteen declaration files differ in destructuring syntax
or member order; TypeScript 5 accepted their value exports and fifteen named types as bidirectionally
assignable to the retained TS7 output. Incremental regression coverage exercises
referenced declaration changes, invalid consumers, repairs, and compiler switches.

The pinned tsrs release publishes Linux x64/arm64 and macOS arm64 binaries.
Other hosts, including Intel Macs, use TypeScript 7. Set
`MURPH_TYPECHECK_COMPILER=typescript` to compare or troubleshoot; an explicit
`tsrs` selection fails on unsupported hosts. Missing binaries on a supported
host fail closed. `MURPH_BUILD_COMPILER=typescript` selects the retained emitter
for build troubleshooting or paired measurements; it is independent of
`MURPH_TYPECHECK_COMPILER`. The Linux CI typecheck explicitly selects tsrs. The same
entrypoints work on GitHub-hosted or Blacksmith Linux runners without a
provider-specific compiler setup.

Both compilers use the existing `MURPH_TSC_*` budgets. Outside shared-host mode,
tsrs gets four checkers unless overridden, matching the former TS7 default
instead of inheriting tsrs's larger worker count. Both compilers default to four
builders; explicit lane overrides and shared-host budgets remain authoritative.

`apps/web` still owns a local TypeScript 5 compatibility compiler for Next and
other tools that require the legacy compiler API or peer range. The tsrs
source check does not replace the separate generated route and page contract check.

Root acceptance checks hosted-web source with tsrs before app
verification. Only after that succeeds may the acceptance lane skip the
duplicate app-local tsrs source pass. A direct
`pnpm --dir apps/web verify` remains self-contained and still runs its source
check. The generated route/page contract check is never replaced by this reuse.

The production Next runner generates route declarations, then uses the root
`web` lane with `tsconfig.next.json` to check those actual contracts. Only after
that succeeds does it set its private exact-value build flag and let Next skip
the duplicate internal invocation. It clears inherited flags before checking;
direct `next build` still uses Next's internal TypeScript 5 check. A real Next
fixture proves that an invalid `generateStaticParams` export fails and a repair
passes. Next and Workflow still retain their TypeScript 5 API dependency.

## Shared-Host Profile

When selected, the canonical `pnpm test:diff` and `pnpm verify:acceptance`
entrypoints first select their executor. Automatic dispatch stays local. An
explicitly forced remote run uses a per-worktree static Mac workspace and
disables shared-host throttling there. Local
canonical verification and build entrypoints
automatically use the profile when `CODEX_THREAD_ID` is present outside CI.
Other local callers can opt in:

```bash
MURPH_VERIFY_SHARED_HOST=1 pnpm verify:acceptance
```

`MURPH_VERIFY_SHARED_HOST` accepts `0` or `1`. An explicit value wins over
automatic Codex detection, so `MURPH_VERIFY_SHARED_HOST=0` is the local escape
hatch. CI retains its existing explicit budgets and never inherits Codex-local
defaults.

The local profile has one exclusive heavyweight lane. Full workspace
verification, app verification, builds, and benchmarks claim it. `test:diff`
does not: it
keeps its per-worktree artifact lock while limiting workspace fan-out and
Vitest to one worker. If a diff requires app verification, that app phase
claims the heavyweight lane itself.

Each heavyweight command atomically claims one directory beneath the operating
system's temporary directory. Nested commands inherit the claim and do not
queue again. Dead claims can be reclaimed from process-liveness evidence. The
state is disposable and contains no product data or command output. Admission
has no deadline: a waiting command runs when capacity becomes available or
exits when its own caller cancels it.

Commands that also need the per-worktree artifact lock acquire that lock first,
then acquire the host slot. The two controls have separate jobs:

- The artifact lock protects emitted files inside one checkout.
- The host slot limits CPU and memory demand across participating worktrees.

Admission is for finite verification, build, and benchmark entrypoints only.
Never put `dev`, TypeScript watch, or another long-lived process behind a host
slot; it would reserve shared capacity indefinitely.

Direct package, app, and repo-tools Vitest commands do not claim the heavyweight
lane, but Codex/shared-host mode defaults them to one worker. Direct
`pnpm test:repo-tools` uses the same resolver's ordinary-local 75% and CI 50%
defaults, including in the host-support release check. Its config owns this
budget so tooling-focused `test:diff` can pass its scoped override while keeping
repo-tools outside the heavyweight lane. Direct TypeScript commands use the
lane-specific shared budgets below. For PR-bound work, prefer focused direct
checks and let required exact-head CI own broad verification; use `test:diff`
when it is the smallest useful scoped check or CI reproducer. Reserve local
acceptance for direct shared-default pushes or evidence-driven diagnosis.

## TypeScript Budgets

The shared profile starts conservatively so outer package and app fan-out does
not multiply TypeScript's internal workers:

| Lane | Normal mode | Shared-host default | Override |
| --- | --- | --- | --- |
| Package no-emit (`check`) | tsrs `--checkers 4` | `--checkers 1` | `MURPH_TSC_PACKAGE_CHECKERS` |
| Package `-b` | tsrs `--checkers 4` | `--builders 1 --checkers 1` | Package checker override; builders stay `1` |
| Hosted-web source | tsrs `--checkers 4` | `--checkers 2` | `MURPH_TSC_WEB_CHECKERS` |
| Root workspace graph | tsrs `--checkers 4` | `--builders 2 --checkers 1` | `MURPH_TSC_BUILDERS`, `MURPH_TSC_BUILD_CHECKERS` |
| Hosted-web watch | `--checkers 1` | `--checkers 1` | `MURPH_TSC_WEB_WATCH_CHECKERS` |

All numeric overrides must be positive integers. Pass budget choices through
these variables rather than adding `--builders`, `--checkers`, or
`--singleThreaded` at call sites; the root runner rejects competing worker
flags so the lane has one budget owner.

Package checks default to checker mode. To benchmark fully external
parallelism, set:

```bash
MURPH_TSC_PACKAGE_MODE=single-threaded
```

`MURPH_TSC_PACKAGE_MODE` accepts `checkers` or `single-threaded`. Leave
`MURPH_TSC_PACKAGE_CHECKERS` unset in single-threaded mode. This is an
alternative to measure, not the default, because it also disables TypeScript's
parallel parsing and emitting.

Keep checked-in values conservative. Put runner-specific overrides in that
runner's environment only after measurement; do not add automatic CPU
detection, worktree discovery, or a persistent budget service.

## Incremental CI State

Trusted `main` pushes in the host-support workflow cache only these TypeScript
build-info files; pull-request jobs never restore or save them:

```text
tsconfig.tools.tsbuildinfo
packages/*/*typecheck*.tsbuildinfo
apps/cloudflare/typecheck.tsbuildinfo
apps/web/.next/cache/tsconfig.tsbuildinfo
apps/web/.next/cache/tsconfig.next.tsbuildinfo
```

The root typecheck and app-verification lanes use separate cache namespaces.
Keys include runner OS and architecture plus Node, lockfile, package-manifest,
compiler-runner, and TypeScript-config inputs. That also ties reuse to the compiler version in
the dependency manifests and lockfile. GitHub saves the cache only after a
successful job. Compiler-version changes invalidate build info; the runner
regression test switches compilers through a failing edit and repair to prove
that a warm cache cannot hide the diagnostic.

Do not broaden these paths to all build output or the whole Next cache. The
clean workspace build runs before any typecheck cache restore, so the release's
clean-build proof remains cold. Incremental state accelerates later typecheck
and app-verification work; it never redefines clean-build proof.

## Editor And Watch Use

`.vscode/extensions.json` also recommends the official Oxc extension for Web
lint diagnostics. CLI lint uses the Web-local pinned binary and config.

`.vscode/extensions.json` recommends `TypeScriptTeam.native-preview`, but the
repo does not force TypeScript 7 editor settings. Enable it per developer or
per VS Code window with local settings such as:

```json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript"
}
```

If the web app needs behavior from a Next or Workflow language-service plugin
that the native server does not provide, keep it off in that web-specific
window. CLI verification remains authoritative.

Start the hosted-web source watcher manually beside `next dev`:

```bash
pnpm --dir apps/web typecheck:watch
```

The command prepares Health Commons output, Prisma, and route stubs once, then
runs the tsrs watcher with its own
`apps/web/typecheck.watch.tsbuildinfo`. It is never auto-started and never takes
a shared-host slot. When editing Health Commons source, run its generator watch
separately:

```bash
pnpm generate:watch
```

## Benchmarking

`pnpm benchmark:typescript` repeats any command on macOS or Linux, reports each
run, and summarizes median elapsed time plus maximum resident memory. Five runs
is the default:

```bash
MURPH_VERIFY_SHARED_HOST=1 \
MURPH_TSC_WEB_CHECKERS=4 \
pnpm benchmark:typescript -- \
  --runs 5 \
  --label web-checkers-4 \
  -- node scripts/run-typescript.mjs web \
    -p apps/web/tsconfig.json --pretty false
```

Prepare generated web inputs before timing a direct compiler command. For the
package fan-out, benchmark the complete lane so outer and inner concurrency are
measured together:

```bash
MURPH_VERIFY_SHARED_HOST=1 \
MURPH_TYPECHECK_WORKSPACE_CONCURRENCY=2 \
MURPH_TSC_PACKAGE_CHECKERS=1 \
pnpm benchmark:typescript -- \
  --runs 5 \
  --label packages-2x1 \
  -- pnpm typecheck:packages
```

Use a matrix, not one before-and-after result:

| Surface | Useful candidates to measure |
| --- | --- |
| Hosted web | Checkers `2`, `4`, and `8` |
| Package fan-out | Outer `2` or `4` with one checker; compare one single-threaded case |
| Workspace graph | Builders/checkers `1x1`, `2x1`, `2x2`, and `4x1` |

For each candidate, record cold state, an unchanged warm run, a representative
local edit, and a shared-package edit. Compare both median time and peak memory
on the actual runner class and under a representative host load. Select values
per runner only when the measurements show a stable win; there is no universal
fastest worker count.

### Paired compiler CI measurement

`pnpm benchmark:compilers` runs three alternating TS7/tsrs rounds in a disposable
installed checkout. It compares full cold/warm source checks and clean/incremental
workspace builds, plus generated-route checks against the former TS5 CLI, with
equal explicit worker budgets for the native compilers. It prepares generated inputs
before timing, clears only check build info before cold checks, and keeps TS7
emission during the check comparison to isolate the source-check adoption.
Every round also requires identical emitted JavaScript and source maps.

The `Compiler paired benchmark` workflow runs this on Ubuntu when compiler
routing or benchmark code changes, and supports manual dispatch. The artifact
contains individual timings, sanitized logs, medians and percentage reductions.
Those are command savings; installation, queue time, other parallel jobs and
provider billing are separate. Blacksmith consumes the same public build runner
through the protected Murph Cloud workflows; measure that provider separately
before claiming equivalent wall-clock or cost savings.
