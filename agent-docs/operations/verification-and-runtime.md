# Verification And Runtime

Last verified: 2026-11-14

Read the delivery-path rules first, then only the matrix row or procedure for
what you changed. Everything else here is reference, not a checklist. On a pull
request, required CI owns broad proof; a subsystem note in this file never adds
a second local acceptance run.

## Verification Ownership By Delivery Path

- **Pull request:** run the smallest focused local tests, typecheck, lint,
  build checks, and direct scenarios that exercise the changed behavior.
  Required GitHub Actions on the PR head own the broad package, app, coverage,
  fixture, smoke, and hosted E2E surfaces, so do not run `pnpm test:diff`,
  `pnpm test`, `pnpm test:coverage`, or `pnpm verify:acceptance` just because a
  PR exists. The PR is complete only when those required checks are green.
- **CI failure:** read the failing job and start with the narrowest local
  command that reproduces it. Widen to `pnpm test:diff`, an owner-level
  command, or `pnpm verify:acceptance` only when broader reproduction helps.
- **Direct push to `main` or another shared default branch:** there is no PR
  feedback loop, so after fetching and reconciling the candidate, run
  `pnpm verify:acceptance` once for that push attempt. If the remote advances
  or rejects the push, fetch, reconcile through a normal merge or an authorized
  rebase, inspect the intervening base diff and any conflict resolution, and
  rerun the affected focused checks. Rerun full acceptance only when the base
  change alters behavior or invalidates something the earlier run relied on; a
  moved base or a meaning-preserving docs resolution alone does not.
  Reconciliation inside the existing push authorization needs no new
  permission and has no retry limit. Preserve published history and branch
  protections, and stop for an unresolved ownership or product decision.

Focused local proof is required for changed behavior on every path. A green
unrelated check is not proof.

Evidence belongs to the file state it checked. After the last code, test, or
config edit, rerun each focused command whose inputs changed. Any later
TypeScript edit invalidates an earlier typecheck.

When a required check is blocked or was already red, report the exact command,
the failing target, why the change did not cause it, and the best focused
evidence. That does not turn the check green or permit bypassing CI. Do not run
an unrelated broad command only to show that a baseline is red.

### Pull Request Exact-Head Lifecycle

Pull requests open as draft. Marking a PR Ready starts the expensive
workflows, so Ready means near-merge admission. Run `gh pr ready <number>`
only when focused local proof and the candidate review are done, the pushed
head is the intended merge candidate, and no further edit is known. Opening a
PR as non-draft is the deliberate way to enter expensive CI immediately.

Draft-before-push: before pushing a new head to a PR you own, including
remediation and base reconciliation, mark it Draft and push only if that
succeeds:

```bash
gh pr ready <number> --undo && git push origin HEAD
```

Use the PR's remote when it is not `origin`. After the push, verify the remote
head, re-establish the conditions above, then mark the PR Ready again. If a
head was pushed while Ready, mark it Draft and then Ready after focused proof
and review.

The expensive workflows run only for a non-draft `opened` or `reopened` event
and for `ready_for_review`. They do not run on `synchronize`, so a push alone
proves nothing. Every new head needs its own required checks before merge even
if the PR still shows Ready, and a skipped job is not a pass. PR authors own
Draft and Ready; no background workflow changes that state. `PR Evidence`
still runs on `synchronize` to keep policy and evidence metadata current.

Required CI runs the same jobs for documentation and code. PR runs supersede by
PR number. Required `main` proof uses SHA-scoped concurrency, so merging
another commit cannot cancel a candidate's tests; the Web admission group
finishes its active run and keeps only the newest pending candidate. Every
`main` commit creates a Vercel production candidate for the Deployment Check
(`apps/web/vercel.json` enables Git deployment only for `main`).

Before checking mergeability, refresh the base with an explicit destination
refspec, because a bare `git fetch origin main` can update only `FETCH_HEAD`
when another task has narrowed the shared fetch mapping:

```bash
git fetch origin refs/heads/main:refs/remotes/origin/main
git rev-parse origin/main
git ls-remote origin refs/heads/main
```

The two SHAs must match; if the base advanced, refresh and check again. For
another base branch, substitute its name in all three commands. Leave the
shared `remote.origin.fetch` configuration alone.

The PR head is the commit that carries the PR's change. It does not need to be
merged repeatedly with a moving base: keep required CI green on that head and
prove mergeability with `git merge-tree --write-tree HEAD origin/<base>`. At
the authorized merge boundary, wait only for routed review gates and required
checks. If strict up-to-date checks apply, prefer the merge queue. When the
merge path needs a base update, reconcile it and let required CI gate the new
head, following the Base-Update-Only Exception in `pr-reviewgpt-loop.md`. A
non-required check delays merge only when its failure is relevant to the
changed surface or the user asked for it.

### Production canaries

Native iOS and Android hosted E2E are production canaries that run from
protected `main`, not pull-request statuses. `live-provider-canaries.md` owns
the cadence, recovery, and credential boundaries of every canary, including
which schedules are paused; `native-android-hosted-e2e.md` owns the Android
controller.

- A manual dispatch is the recovery path for a dropped schedule. Its ref must
  be `refs/heads/main` and its SHA must still equal current `main`.
- Reviewed native source pins live in
  `.github/native-hosted-e2e-controller.json`.
- A native pass is evidence for the deployed Web SHA it ran against. Local
  mocked or hosted-local tests do not replace it, and the controllers never
  publish a commit status.
- Never expose canary or live-provider credentials to a pull request or weaken
  a protected-branch gate to get earlier proof.

Controller and dispatcher proof:

```bash
node --test scripts/native-ios-hosted-e2e.test.mjs
node --test scripts/native-android-hosted-e2e.test.mjs
```

## Expensive And Stochastic Proof Order

When a change needs a real-model, live-provider, browser, or external review
run, finish the cheap deterministic proof first:

1. Test the exact production boundary result. When instructions are composed
   from generic and route-specific parts, assert both the required text and the
   absence of conflicting guidance.
2. Build the expensive scenario from the production prompt, policy, or saved
   automation instructions, not a retyped approximation.
3. Assert the user-visible outcome and owned effects, such as provider call
   count, writes, delivery, or suppression. Assert an incidental model step only
   when that exact step protects a product, cost, security, or reliability
   invariant.
4. Run independent focused tests, typechecks, and lint checks concurrently.
   Start the expensive scenario after its boundary tests pass, and start
   ReviewGPT after the complete candidate passes focused proof.

For a stochastic base-versus-head comparison, interleave balanced samples from
both revisions in one shuffled batch with the same model, auth class, worker
count, and competing workload, and record the sample counts and order. Separate
batches can confuse a code change with provider or host variation. Keep setup
and prerequisite failures separate from completed model outcomes. The
meal-intake benchmark fails missing inputs as `MEAL_BENCHMARK_PREREQUISITE`
before any live journey starts; that checks availability, not how
representative the corpus is.

### Assistant behavior

A change that can alter Murph's interpretation, tool choice or arguments,
reply-versus-silence decision, or user-visible prose applies
`$verify-murph-assistant` after its deterministic boundary tests pass. Add a
focused production-derived journey to
`packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`, assert
required and forbidden effects, and run only that journey:

```bash
pnpm test:assistant:live -- --test "<unique test-name pattern>"
```

The name pattern is required so the run cannot fan out across the paid suite.
The default is `gpt-6.2-sol` through the authenticated local ChatGPT/Codex
subscription. A subscription run keeps personal configuration and global
instructions, so report it as developer-local evidence. `--auth provider` uses
the isolated provider-key route, which is the canonical release evidence. Do
not switch auth modes or copy credentials to make a local run look isolated.
Read every printed synthetic reply and record a `Ready` or `Hold` verdict
covering correctness, action count, repetition, clarity, warmth, autonomy, and
truthful recovery.

No scheduled workflow runs the live Codex suite, and routine CI never makes the
paid call or depends on local subscription state. Local runs use synthetic
vaults and messaging boundaries; they do not prove managed-container restart,
private Worker egress, Temporal, or real provider delivery. The lower-level
opt-in journeys use `MURPH_RUN_REAL_CODEX_E2E=1`; routine package verification
compiles them and skips the paid call when the gate or credential is absent.

Alternate-home retry: if the default subscription home fails before any
provider action because of authentication, quota, startup, or connection, this
repository authorizes trying every available authenticated local Codex home
without asking between attempts. Find candidates by directory and non-empty
auth-file presence only, order them by absolute path, and run the same journey
at most once per unused home with
`--codex-home <ABSOLUTE_ALTERNATE_CODEX_HOME>`. Never read, print, copy, or
move auth material. Stop rotating once a run reaches a provider action or
passes. If a run reaches a provider action but misses the behavior or reply
bar, fix the owning boundary and rerun on that same home. Record `Hold` only
when every available home is blocked before a provider action.

The generated-image avatar journey exercises the production tool contracts in
three natural turns: launch with a truthful wait acknowledgement, trusted
completion media attachment with no group mutation, and a later explicit
exact-ref avatar update with no product-feedback submission. Deterministic
suites stay authoritative for transcript persistence, native-resume rejection,
exact reply linkage, byte publication, and effect-authority denial.

## Hosted Stripe Billing Verification

Billing changes have two lanes. Run the hermetic owner proof first; it needs no
Stripe credentials:

```bash
pnpm --dir packages/hosted-local-harness exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/stripe-billing-live-config.test.ts \
  test/dev-hosted-local/stack.test.ts
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-onboarding-billing-checkout-route.test.ts \
  apps/web/test/hosted-billing-live-support.test.ts
pnpm hosted-billing:ci-guard
```

The live lane is separate external-provider proof. With a local PostgreSQL
database and the dedicated test-sandbox environment loaded:

```bash
pnpm stripe:cli:setup
pnpm hosted-billing:live:preflight
pnpm hosted-local e2e stripe-billing-browser-matrix
pnpm hosted-billing:live:cleanup
```

- Pull requests, trusted or fork, run only the hermetic lane. The live Actions
  lane runs twice weekly on protected `main` through the protected sandbox
  environment, after hermetic proof passes. `Required hosted Stripe billing
  boundary` requires hermetic success and a skipped live job on PRs and `main`
  pushes, and both jobs on scheduled runs. Missing or malformed sandbox
  configuration fails closed. Never use `pull_request_target` to work around
  this boundary.
- The Stripe key reaches only the preflight, matrix, and cleanup steps, and
  within the scenario only the Web Stripe client and the harness-owned
  `stripe listen` child. Never pass it as a CLI argument or write it to a
  repository file. Repository files hold only the Environment contract names.
- Use stable pre-provisioned test prices and an active default Portal
  configuration with plan updates and immediate invoicing. The matrix covers
  Starter activation then paid Pulse Checkout, Pulse to Edge through the
  Portal, Edge to Pulse as a renewal schedule (never an immediate downgrade),
  Family Checkout from a lapsed individual plus invite activation, and paid
  individual-to-Family conversion in place on the same subscription.
- Synchronize on Stripe object and event state and Murph's PostgreSQL
  projection, not a fixed sleep.
- Diagnostics may state only opaque run correlation, object type and status,
  and browser step, surface, and status. Do not capture or upload screenshots,
  traces, raw webhook payloads, URLs, identities, or full Playwright reports.
- Cleanup removes only mutable resources whose run ownership it proved, leaves
  shared catalog objects alone, is idempotent, and runs after a scenario
  failure. After an interrupted process, run the standalone cleanup command
  with the same run id.

The required PostgreSQL lane owns the legacy Starter migration proof through
`hosted-starter-usage-migration-postgres.test.ts`. The Stripe effect
compatibility cutover has its own credential-free database proof: after
applying all Web migrations to an isolated loopback PostgreSQL database, run
the `hosted-onboarding-member-lock-postgres.test.ts` command in
`stripe-effect-compatibility-cutover.md`.

## Live Junction Garmin Canary Verification

The public wearable workflow dispatches protected-`main` source to the private
hosted-runtime executor and requires a completed journey and cleanup receipt.
The receipt separates matched canonical data from a successful empty provider
response; an empty account does not prove ingestion. The public controller has
no provider credentials, private checkout, or artifact access. See
[Live provider canaries](live-provider-canaries.md) for execution, credential
provisioning, and migration.

Focused controller, browser-boundary, and progress proof:

```bash
node --test scripts/github-wearable-canary.test.mjs
pnpm --dir packages/hosted-local-harness exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/junction-wearable-canary-workflow.test.ts \
  test/wearable-progress.test.ts
```

- Only a successful protected-`main` run proves the complete result. Only the
  private executor's browser-canary step may receive Kernel authority, Junction
  sandbox authority, and the dedicated Garmin login; setup steps stay free of
  Environment secrets.
- The run uses a headed remote Kernel browser with no persisted profile.
  Headed Chromium is the mitigation that cleared the provider challenge seen in
  headless automation. A challenge or MFA prompt fails closed, and manual
  authorization stays disabled in CI.
- The private executor must expose the workspace Codex CLI from the frozen root
  dependency graph and install a checksum-pinned Kernel CLI and `websocat`
  before hosted-local preparation. The workspace Codex pin currently matches
  the `Dockerfile.cloudflare-hosted-runner-base` pin, but no executable guard
  links the two.
- The consent step on Garmin's `/partner/oauthConfirm` route expects exactly
  three available data-sharing checkboxes and one enabled `Save`. A change to
  those counts or to the paired progression markers fails closed; do not relax
  the gate to make a run pass.
- Diagnostics and progress annotations carry fixed stage names, counts, HTTP
  status numbers, and host resource numbers only. They never include a raw
  URL, provider page text, account data, or a screenshot, and they do not
  replace connection, canonical-data, or cleanup proof.

## Verification Execution Location

`pnpm test:diff <path ...>` and `pnpm verify:acceptance` run through
`scripts/verification-dispatch.mjs`:

- CI and already-remote runs execute `scripts/workspace-verify.sh` directly.
- The default runs locally under shared-host admission.
- `MURPH_VERIFY_EXECUTOR=local|ssh` selects an executor explicitly. `ssh` uses
  a dedicated static macOS worker through Crabbox and fails closed when its
  host, user, port, Crabbox CLI, or archive capability is unavailable. A remote
  failure never falls back to a local run. The `:local` package aliases exist
  only to diagnose the executor.

The remote run executes the same `workspace-verify.sh` command, with the same
diff scope, reverse dependents, coverage, and acceptance semantics, after
`pnpm install --frozen-lockfile --prefer-offline`. The verifier chooses worker
budgets from the detected CPU and memory and prints them in its startup
`resources` line; caller environment values cannot tune the `static-ssh`
profile.

### Dedicated static macOS worker

A spare Mac is the free offload lane for finite, CPU-heavy canonical checks.
Select it deliberately:

```bash
MURPH_VERIFY_EXECUTOR=ssh \
MURPH_VERIFY_SSH_HOST=verification-worker.local \
MURPH_VERIFY_SSH_USER=verification-worker \
MURPH_VERIFY_SSH_PORT=22 \
pnpm test:diff <path ...>
```

`MURPH_VERIFY_SSH_HOST` must be a host name or address the initiating Mac can
resolve directly; an SSH-config-only alias does not work. Keep all three values
as operator-local inputs and never commit a machine address, host label,
account, or SSH key path.

Prepare the worker once:

1. Create a standard macOS account used only for verification. Keep it out of
   iCloud, Keychain, password managers, developer cloud CLIs, product
   credentials, repository `.env*` files, and Full Disk Access. Candidate code
   runs arbitrary repository commands as this account, so never reuse a
   personal or credential-bearing one.
2. Enable Remote Login and restrict SSH to that account. Give the Mac a neutral
   resolvable DNS or mDNS name, match it in local SSH config with
   `IdentityFile` and `IdentitiesOnly yes`, and disable agent forwarding.
3. Give only that account access to `/Users/Shared/murph-crabbox`. Install
   `git`, `rsync`, `tar`, `zstd`, Node `>=24.22.1`, and Corepack (the
   repository pins pnpm `10.33.0`), and make them and the native `lockf`
   visible in the account's non-interactive SSH `PATH`.
4. Prove reachability:

```bash
crabbox doctor \
  --provider ssh \
  --target macos \
  --static-host verification-worker.local \
  --static-user verification-worker \
  --static-port 22 \
  --static-work-root /Users/Shared/murph-crabbox/doctor \
  --doctor-probe-ssh
```

The doctor command proves transport only. The run itself checks `tar` and
`zstd` before installing anything and fails with a worker-prerequisite
diagnostic if they are missing or incompatible. The verifier cannot wake a Mac
that is offline; while a run is admitted it prevents idle sleep. To stop
offering the Mac, disable Remote Login or remove its authorized key.

What to expect from a remote run:

- The dispatcher freezes one Git candidate before syncing, so later edits and
  late untracked files do not enter the run.
- It refuses a checkout with ordinary untracked files, intent-to-add entries,
  staged-then-changed additions, unmerged paths, or tracked credential, vault,
  runtime-state, or private-document paths. Modified tracked files, tracked
  renames and deletions, ignored files, and fully staged new files are
  accepted. Fully stage a new source or documentation file before delegating;
  never stage private data to get past the refusal.
- The worker runs one verification at a time. A second invocation fails as
  busy without waiting or falling back.
- Each run uses its own directory below `/Users/Shared/murph-crabbox/runs` and
  removes it afterward.

### Ten-minute local admission fallback

Measure time spent waiting for the local shared-host slot separately from
active verification time. A recovery claim older than the metadata grace period
fails with a diagnostic; confirm its owner has exited before removing abandoned
slot state. If a required canonical command has waited 10 continuous minutes
for the slot, stop only the waiting process tree this task owns and rerun the
same command on the SSH worker when it is configured and idle:

```bash
MURPH_VERIFY_EXECUTOR=ssh pnpm test:diff <path ...>
MURPH_VERIFY_EXECUTOR=ssh pnpm verify:acceptance
```

If Crabbox cannot run, report that blocker with the completed local evidence.
Do not leave the local waiter running alongside the remote run.

Do not run both remote `test:diff` and remote acceptance on the same head. When
acceptance is required, keep the diff checks local and use the one remote run
for acceptance; otherwise use the remote diff lane. Retry an unchanged head
only after a concrete infrastructure failure, and record the reason in the
completion evidence.

### Environment and Vercel boundary

The remote lane is synthetic and secret-free. The dispatcher replaces the
inherited environment with a small allowlist of host path, account, terminal,
and XDG config locations before it starts Crabbox, and the worker rebuilds
CI-style placeholder values for the hosted-web build and smoke checks.

- Do not add `--allow-env`, `--env-from-profile`, credential variables, or
  ad-hoc `crabbox run` commands to this lane.
- The lane never runs `vercel env pull` or `vercel env run`, and never copies
  `.env*`, `.vercel`, or provider, model, billing, messaging, or production
  credentials.
- Canonical completion tests pass under this synthetic contract. A separate
  scenario that needs Vercel development state sets
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1`, stays local on an authorized host, and
  is reported separately. A remote live-environment lane would need its own
  reviewed, step-scoped secret boundary.
- This is not an operating-system sandbox: a process that can already read a
  production secret can exfiltrate it without Crabbox. Keep production
  credentials out of ordinary local process environments, and keep GitHub
  production secrets in a protected-branch environment only, never as
  repository-scoped duplicates.
- When Crabbox runs, record the command, result, executor, and timing without
  host, account, or local-path identifiers.

### Refreshing stale dependency build-cache metadata

A restored pnpm installation can keep an old `ignoredBuilds` list after
`allowBuilds` denies those scripts. Confirm that a clean frozen install is
warning-free before treating an ignored-script warning as stale metadata, and
do not enable dependency scripts to silence it.

For a one-time refresh, set the non-secret Vercel project variable
`VERCEL_FORCE_NO_BUILD_CACHE=1` for production before the next authorized
`main` commit. That commit still deploys through Git integration and ordinary
production admission. Inspect its install logs and cache upload, remove the
variable, and confirm the next cached build is warning-free. See
[Vercel's build-cache guidance](https://vercel.com/docs/deployments/troubleshoot-a-build#managing-build-cache).

### Web build artifact and caches

Production admission builds the `hosted-integration-web-v1` Web artifact from
the exact public `main` SHA with synthetic configuration. A build or upload
failure is not an admission failure: the private consumer falls back to its own
local build. The artifact never replaces private runtime proof or deployment
admission.

Private integration may set `MURPH_HOSTED_WEB_WEBPACK_CACHE=1` to persist the
Next compiler cache; the full build, route type generation, and both TypeScript
checks still run. Public CI, Vercel, and ordinary builds compile Webpack cold,
because the public CI cache experiment exhausted the compiler heap. Focused
proof lives in `apps/web/test/next-config.test.ts` and
`apps/web/test/production-next-build-runner.test.ts`.

## Verification Matrix

The delivery-path rules govern this matrix. For PR work, a row names the
coverage surface that focused local proof and required CI must cover, and its
command is the local fallback when you want broad proof. For a direct
shared-default push, run `pnpm verify:acceptance` whatever the row says.

Prefer `pnpm test:diff <path ...>` when it covers the touched owner and its
reverse dependents. It already typechecks them, so do not run root
`pnpm typecheck` first. When it does not cover the change, the fallback must
still carry coverage; do not drop to a no-coverage package loop.

| Change scope | Local command | Notes |
| --- | --- | --- |
| Vault-only data under `vault/**` | None | Read back the touched vault records and any audit artifacts the mutation wrote. |
| Review-only inspection with no edits | None | Use file references and static analysis. Run commands only when the user asks for runtime proof or a material conclusion cannot be supported statically. |
| Text-only Markdown edits or deletions in docs or process files | None | Read back the touched docs, confirm intended deletions, and check references to removed or renamed docs. Applies only when the diff touches no scripts, config, tests, generated docs, tracked artifacts, or workflow-enforcement files. |
| Low-risk repo-internal tooling: `agent-docs/**`, `docs/**`, `scripts/**`, `config/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `vitest.config.ts`, root `tsconfig*.json` | Direct checks on the touched files: `bash -n`, `node --check`, focused Vitest, or doc readback. `pnpm test:diff <path ...>` when the touched files or a CI failure need more. | Applies only when the diff touches no app or package runtime code, product behavior, persisted-state logic, auth or trust boundary, or deploy surface. On this path `test:diff` runs shell and Node syntax, architecture and privacy guards, repo-tools TypeScript, dependency policy, and focused repo-tool tests. |
| Docs or process work beyond text-only Markdown that is not low-risk tooling | `pnpm verify:acceptance` | Covers broader scripts, config, tests, generated docs, tracked artifact inventories, and workflow-enforcement files. |
| Fixture, e2e, or package-doc changes | `pnpm verify:acceptance` | Verifies fixture corpus integrity, scenario-manifest wiring, package runtime health, built CLI checks, command-surface coverage, and the source-artifact guard. |
| `packages/hosted-local-harness` | `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/hosted-local-harness test:coverage` and `verify:package-boundary` | When launch, profile, or runtime behavior changes, also smoke the changed entrypoint without printing secrets, for example `pnpm hosted-local worktree env <slug>` and `pnpm hosted-local worktree doctor <slug> --json`. Run `pnpm hosted-local worktree up <slug>` only when the task depends on child startup or provider or webhook behavior. |
| `packages/health-commons` | `pnpm --dir packages/health-commons verify` | Root acceptance regenerates the ignored catalog for consumers but does not replace this lane. |
| `packages/contracts`, `clinical-records`, `hosted-execution`, `runtime-state`, `core`, `importers`, `inboxd`, `parsers`, `health-metrics`, `query` | `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/<name> test:coverage`; also `pnpm test:scenario-integrity` | |
| `packages/assistant-engine`, `assistant-runtime`, `gateway-core`, `vault-usecases`, `cloudflare-hosted-control`, `messaging-ingress`, `inbox-services`, `device-syncd` | `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/<name> test:coverage` | `assistant-runtime` is also exercised by the Cloudflare hosted-runner lanes. |
| `packages/cli` | `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/cli verify:coverage` | See CLI notes below. |
| `apps/web` | `pnpm test:diff <path ...>` when it covers the touched slice, otherwise `pnpm verify:acceptance` | See Web notes below. |
| `apps/cloudflare` | `pnpm test:diff <path ...>` when it covers the touched slice, otherwise `pnpm verify:acceptance` | See Cloudflare notes below. |
| The user says to skip checks | None for that turn | |

Vitest budgets, stated once for every lane: app lanes read
`MURPH_APP_VITEST_MAX_WORKERS`, then `MURPH_VITEST_MAX_WORKERS`, then default
to 50% locally or 25% in CI. Root and package configs read
`MURPH_VITEST_MAX_WORKERS` and default to 75% locally or 50% in CI. File
parallelism is on locally and off in CI; `MURPH_VITEST_FILE_PARALLELISM`
overrides it except in buckets that disable it, such as
`cloudflare-node-platform`. In-file suite concurrency is off unless
`MURPH_VITEST_SUITE_CONCURRENCY` enables it, and then
`MURPH_VITEST_MAX_CONCURRENCY` or `MURPH_CLI_VITEST_MAX_CONCURRENCY` caps it (2
locally, 1 in CI). App verify steps overlap locally and run serially in CI
unless `MURPH_VERIFY_STEP_PARALLEL=1`.

### Web notes

- `pnpm --dir apps/web test` is the fast Vitest lane for iteration.
- `pnpm --dir apps/web verify` is the package-level superset: it regenerates
  the Health Commons catalog and the Prisma client, runs the source check, then
  the production `next build` (`apps/web/.next`), the cold-boot dev smoke
  (`apps/web/.next-smoke`), tests, and lint. `verify:parallel` forces the
  local parallel path. Lint is a required check for `apps/web` changes.
- The dev smoke reuses its Turbopack cache locally;
  `MURPH_HOSTED_WEB_SMOKE_PRUNE_CACHE=1` forces a cold smoke.
- Root `pnpm typecheck`, `pnpm --dir apps/web typecheck`, and
  `pnpm --dir apps/web prisma:generate` regenerate the Prisma client that Web
  tests import. Finish them before starting those tests, for example
  `pnpm typecheck && pnpm --dir apps/web test`; regenerating while tests
  collect or run can remove the module they import. `apps/web verify` already
  orders this.
- `apps/web/README.md` § Production build memory guard owns the production
  build's memory, cache, and deadline contract, including the Linux CI
  cgroup measurement. What matters here: production and Linux CI build with
  Webpack while interactive development and the dev smoke use Turbopack, and
  the verify lane builds with `VERCEL=1 VERCEL_ENV=preview`, which compiles
  cold and never arms the production-only build deadline. Disabling the CI
  memory measurement requires `MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0`, and CI
  rejects `MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=passthrough`.
- Every user-facing `apps/web` UI diff also runs
  `pnpm test:frontend-design-proof` and carries the design proof that
  `agent-docs/FRONTEND.md` describes. Prefer an attached in-app Browser for
  visual proof, then the repository-installed Playwright runtime. Crop
  screenshots to the changed component and inspect them at native resolution.
  `/screenshots` pages render production components with synthetic props and
  prove presentation only; use the real product path for journey proof.

### Cloudflare notes

- `pnpm --dir apps/cloudflare verify` runs the app typecheck once, then the
  Node lane (`test`) and the Workers-runtime lane (`test:workers`);
  `verify:parallel` forces the local parallel path. For standalone checks in a
  fresh checkout, follow the generated-client prerequisite in
  [Cloudflare focused tests](../../apps/cloudflare/README.md#focused-tests).
- No repository check verifies a live `wrangler` deploy or Cloudflare-managed
  container provisioning.
- `pnpm --dir apps/cloudflare test:e2e:runner-python:local` builds the same
  `linux/amd64` app-layer image the Cloudflare container uses, starts it with
  its normal entrypoint, waits for `/health`, and checks the Python `PATH` as
  the non-root `runner` user.
- `pnpm --dir apps/cloudflare runner:docker:smoke` is the broader final-image
  smoke against a restored fixture vault: Codex App Server with the hosted
  shell env allowlist, `vault-cli` through `command/exec`, Python, the ffmpeg
  audio pre-step, and the Poppler and `file` PDF toolchain.
- `.github/workflows/cloudflare-runner-permission-sandbox.yml` rebuilds the
  production image on native `ubuntu-24.04` when the Codex permission, runner
  image, bundle, or smoke surfaces change. The filesystem, network, and
  environment denial proof is not valid under ARM64 emulation of AMD64, where
  the inner seccomp filter cannot install.
- The runner bundle budget is authoritative only on native Linux x86_64 in CI,
  which compares the candidate with its direct parent using the full
  `runner:bundle` command. Local macOS byte totals are diagnostic.
- For Worker initialization measurements, use the container-free
  [Worker startup profiling command](../../apps/cloudflare/README.md#worker-startup-profiling).

### Hosted-local E2E

- `pnpm hosted-local e2e` runs the full hosted-local suite;
  `pnpm hosted-local e2e <scenario ...>` runs named scenarios in one prepared
  suite; `pnpm hosted-local e2e --list` lists them.
  `pnpm --dir apps/cloudflare test:e2e:local` adds the Workers-runtime lane.
- `pnpm hosted-local e2e foreground-reply-priority --profile e2e:stub` runs the
  foreground priority regression. `--process-shard 1/2` and `2/2` run its two
  isolated Vitest processes separately; the private workflow requires both.
- `pnpm hosted-local e2e linq-delivery` runs one unfiltered Vitest process.
  To parallelize the stub profile, run `--process-shard 1/2` and
  `--process-shard 2/2` on separate runners. Both shards are required. Each
  checks the complete partition against the active Vitest inventory before
  running its journeys. The opt-in real-model profile keeps its focused run.
  In CI, fast Linq setup reports the duration of Temporal startup through worker
  launch, then elapsed milliseconds from the start of the concurrent Web and
  Worker health checks to each successful response.
- `pnpm hosted-local e2e vault-persistence --profile e2e:live` runs the opt-in
  real Codex app-server persistence scenario across a restart. The model
  defaults to `gpt-6.1-sol`; `MURPH_HOSTED_LOCAL_LIVE_E2E_MODEL` overrides it.
- `pnpm hosted-local e2e analyze-video-roundtrip` is the hosted analyze-video
  acceptance: signed private Linq video turns through attachment projection,
  the real Codex dynamic tool loop, Worker-owned Gemini egress, usage
  recording, and final Linq delivery. It also proves that a Gemini 503 becomes
  a delivered retryable final response with no extra Gemini usage row.
- Private Murph Cloud's `Public Murph Integration` workflow runs these
  scenarios on every private pull request and private `main` push against
  loopback `postgres:17`: `device-connect`, `codex-image-media-delivery`,
  `linq-delivery`, `linq-webhook`, `linq-scheduled-reminder`, `telegram`,
  `idle-checkpoint-deferred-progress`, `direct-r2-presigned-put`,
  `temporal-orchestration`, `foreground-reply-priority`, and
  `device-sync-junction-wearable-direct-resource-replay`. Pull requests and
  `main` use the fast timing profile for the Linq reminder leg; the protected
  deployment gate leaves `MURPH_HOSTED_LOCAL_E2E_FAST_GATE` unset to keep the
  full profile.

### CLI notes

- `pnpm --dir packages/cli test` is the source-first loop. Tests execute the
  built `packages/cli/dist/bin.js`, so `pnpm exec tsx packages/cli/src/bin.ts`
  is only a diagnostic shortcut; final verification needs the built CLI or a
  documented unrelated blocker.
- Changes to the CLI package manifest, build or package-shape config, CLI
  Vitest configs, the prepared-runtime helper, or the root workspace manifests
  escalate to `pnpm verify:cli`. The acceptance commands are
  `pnpm --dir packages/cli verify`, `pnpm --dir packages/cli verify:coverage`,
  and `pnpm verify:cli`; only those run the release-tarball test.
- `MURPH_CLI_TEST_PERSISTENT_HARNESS=0` returns CLI integration tests to
  isolated per-command processes.
- `node packages/cli/dist/bin.js ...` exercises the built `vault-cli` when a
  change needs an end-to-end runtime check.

## Change-Specific Proof

These add to the matrix row for the named change. Required CI owns the broad
suites on a PR, and the tests for each feature say what they cover; what is
listed here is what a test run cannot tell you.

- **Resource acquisition and cleanup:** prove the lifecycle by executing the
  real owner with narrow injected boundaries: acquisition order, success,
  relevant failure exits, exactly-once release, and awaited cleanup. Source
  text or statement-order assertions can supplement that but cannot establish
  runtime cleanup.
- **Test structure:** keep a hand-authored test module to one behavior family.
  Split a module that mixes independent families or repeatedly loads one heavy
  mock or import graph, with shared setup in one adjacent harness. File length
  is a prompt to look, not a gate; keep one coherent state-machine proof
  together.
- **Playwright Chromium install wrapper, or a workflow that calls it:** run
  `bash -n scripts/install-playwright-chromium.sh` and the focused
  `scripts/install-playwright-chromium.test.ts` Vitest file.
- **CLI private dependency closure:** run the CLI generators and the full
  offline runner assembly.
- **Hosted Linq weighted line planning:** keep the 5,000 assignment-target
  assertions separate from the 7,000 provider traffic guideline, and add no
  runtime traffic-cap expectation.
- **Hosted Assistant Ask targets:** prove replay and authority revalidation at
  each hop. Expiry, revocation, text mismatch and route drift are terminal and
  never fall back to the group.
- **Hosted product-feedback digest and assistant-provider choice:** synthetic
  credentials and a loopback fake only. Routine tests never call Resend or a
  paid provider, or read production feedback.
- **Saved-card group funding:** the tests are mocked, so release proof still
  needs the documented Stripe test-mode run and the desktop and mobile browser
  smokes.
- **Read-only Labs:** capture authenticated, fixture-safe `/labs` proof at
  each viewport where the result can differ, with no real query or ZIP in a
  durable artifact. Live Junction calls are operator smoke only.
- **Meal-photo capture:** enrollment-contract changes run the exact
  expand/contract SQL against opt-in local PostgreSQL. No automated path
  replaces a signed physical-iPhone opt-in and upload check, because CI has
  neither iOS Photos authority nor production R2 access.
- **Generated-delivery refs:** producer activation needs reader-compatible
  protected-`main` deployment gates and exact runner-fingerprint convergence
  before the writer release, then a hosted approval, checkpoint, destroy and
  restore delivery scenario.
- **R2 write admission:** local proof does not replace the runbook's live
  100-percent rollout, per-runner `inFlight=false` and capability-drain
  checks.
- **Device providers:** the direct WHOOP, Oura and Strava transport suites are
  retired; keep the source-labelled normalization and wearable-query coverage.

## Hosted Temporal Replay Proof

Private `cobuildwithus/murph-cloud` owns the Temporal Workflows, Activities,
production bundle, replay fixtures, Render deployment, and their verification.
This repository keeps the released contracts, the hosted-local harness, and
architecture guards; it must not contain the worker implementation or trigger
the production deployment. A change there that adds, removes, or reorders
awaited command-producing Temporal APIs needs Worker Versioning or deployment
pinning, TypeScript Workflow patching, or a replay test against captured or
synthetic pre-change histories. State-machine tests, mocked Activity tests,
and local signal or timer tests do not prove replay compatibility. History
fixtures must be redacted or synthetic.

A public shared-contract change that affects Workflow inputs, signals, queries,
or retry semantics requires the fixture-only `Temporal compatibility`
pull-request status in addition to public checks. After merge, every public
`main` production candidate dispatches private `Public Murph Integration`
release admission against the exact public and private `main` revisions; it
never checks out a public pull-request candidate. The public
`hosted-temporal:guard` runs inside `pnpm typecheck` and keeps the worker
implementation out of this repository.

For local work, the root scripts `temporal:cli:setup`, `temporal:cli:check`,
and `temporal:dev` remain. Hosted-local starts the private worker only when
`MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR` is set; otherwise enabled Temporal
fails before child startup and names that variable or
`MURPH_DEV_TEMPORAL=disabled`. The `temporal-orchestration` scenario proves
the Web signal, worker query handling, and Cloudflare ensure-processing;
`linq-same-wake-batching` proves that one Temporal wake batches
already-arrived rapid Linq messages into one assistant turn.

## Pnpm Guard

Do not add `--config.verify-deps-before-run=false` to any verification
command. `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` is a real workspace-state problem to
fix or report. Record verification evidence with the normal command forms.

## Current Command Meaning

- `pnpm test:diff [path ...]`: the optional local lane for a scoped check or
  CI diagnosis. It maps the paths to workspace owners and reverse dependents,
  runs the relevant global guards, then the affected typechecks and package
  tests. A root workspace manifest change widens it to the whole workspace.
  `MURPH_TEST_DIFF_WORKSPACE_CONCURRENCY` (up to four local processes by
  default) and `MURPH_TEST_DIFF_VITEST_MAX_WORKERS` tune it.
- `pnpm typecheck`: shell syntax, root `.mjs` syntax, `pnpm deps:guard`, the
  workspace-boundary and package-cycle audits, hosted architecture and privacy
  guards, the repo-tools typecheck, the contracts build, and each workspace's
  typecheck script. No-emit checks use pinned tsrs on Linux x64/arm64 and
  macOS arm64; emission and unsupported hosts use TypeScript 7.
  `MURPH_TYPECHECK_COMPILER=typescript` selects the fallback, `=tsrs` fails on
  an unsupported host, and a missing tsrs binary on a supported host fails
  rather than falling back. `MURPH_TYPECHECK_WORKSPACE_CONCURRENCY` defaults
  to `min(logical CPUs, 8)` locally and `2` on CI or a shared host. Web keeps
  a local TypeScript 5 only for Next, Workflow, and Solana tooling.
- Package boundaries: typecheck, including the one inside `test:diff`, resolves
  sibling workspace source and reports `package-boundary=unchecked`. When a
  change adds or changes a sibling public-entrypoint import, workspace
  dependency, project reference, public export, or build `rootDir`, also run
  the edited package's `build`, unless a package-boundary follow-up already
  does.
- `pnpm test`: the fast deterministic loop without coverage: incremental
  contracts verification, the root multi-project Vitest lane, and fixture and
  scenario-manifest verification.
- `pnpm test:packages`: the same without fixture verification. App
  verification and CLI package-shape acceptance have their own commands.
- `pnpm test:apps`: prepares Health Commons output and the Prisma client once,
  then runs `apps/web verify` and `apps/cloudflare verify`.
- `pnpm test:packages:coverage`: prepares built CLI and runtime inputs, runs
  each package's coverage command, and runs built package-boundary checks.
  `scripts/release-verification-plan.mjs` must classify every `packages/*`
  workspace: an assigned package declares `test:coverage`, an exclusion needs
  a reason, and a new, stale, duplicate, or unassigned package fails before
  coverage starts. `MURPH_PACKAGE_COVERAGE_SHARD` selects one shard for this
  standalone command only. Overrides for the default profile:
  `MURPH_PACKAGE_COVERAGE_CONCURRENCY`,
  `MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY`,
  `MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS`, and
  `MURPH_PACKAGE_COVERAGE_CLI_VITEST_MAX_WORKERS`.
- `pnpm test:coverage`: the coverage acceptance lane: repo, doc, and artifact
  guards, prepared package coverage, scenario-integrity coverage, and app
  verification.
- `pnpm verify:acceptance`: the canonical acceptance gate. Under one lock it
  runs the full `typecheck` surface, then the coverage lane, reusing
  typecheck's guards and generated inputs.
- `pnpm test:scenario-integrity`: coverage-bearing fixture and
  scenario-manifest integrity, documented-command coverage, and indexed
  fixture references. It is not an end-to-end smoke.
- `pnpm docs:drift`: the manual durable-doc drift check for changes to
  `agent-docs/**`, `ARCHITECTURE.md`, or other durable docs. It ignores
  untracked documents and `agent-docs/exec-plans/completed/**`. In
  pull-request CI it compares the exact base and candidate trees
  (`MURPH_DOCS_DRIFT_BASE_SHA` and `MURPH_DOCS_DRIFT_CANDIDATE_SHA` override
  them).
- `pnpm build:workspace:clean`: clears runtime-package outputs and
  `tsbuildinfo`, runs the root project-reference graph once, then the
  importers safe build. Use it when the build needs clean semantics, such as
  release or CI proof. `pnpm build:workspace:incremental` is the same without
  the clean step.
- `pnpm build:test-runtime`: clears the narrower runtime `dist/` outputs, then
  builds the `tsconfig.test-runtime.json` graph that built CLI consumers and
  the root Vitest lane need.
- `pnpm build:test-runtime:prepared`: builds that graph without deleting
  outputs and verifies the runtime and public entrypoints. Test workers
  validate prepared artifacts and name this command when they are missing or
  stale; they never rebuild. Use separate worktrees to rebuild concurrently.
- `pnpm build`: package-local `build` scripts in topological order, with
  `MURPH_BUILD_WORKSPACE_CONCURRENCY` defaulting to `4`.
- `pnpm clean`: removes `dist/`, `.next/`, `.next-dev/`, `.next-smoke/`,
  `.test-dist/`, `*.tsbuildinfo`, and untracked generated JS and declaration
  files beside tracked TypeScript. Interactive hosted dev uses
  `apps/web/.next-dev`, so do not run this beside a running dev server unless
  you mean to drop its cache.
- `pnpm no-js`: prunes those generated files, then fails on handwritten `.js`,
  `.mjs`, `.cjs`, or `.d.ts` source under `packages/`, `apps/`, or `e2e/`
  outside `apps/web/next-env.d.ts` and `apps/web/postcss.config.mjs`, and on
  tracked `.env` files or committed build residue.
- `pnpm deps:guard`: requires the committed lockfile, a pinned
  `packageManager` with matching `engines.pnpm`, the pnpm supply-chain
  settings, `workspace:` protocol for internal packages, and registry-sourced
  third-party specs.
- `pnpm lockfile:sync-existing -- <workspace-importer>`: after editing that
  importer's `package.json`, copies only dependency records that already exist
  uniquely elsewhere in the lockfile. It fails for a new resolution or an
  ambiguous peer snapshot; use the normal install flow for those.
- `pnpm deps:audit`: `pnpm audit --audit-level=high`.
  `pnpm deps:ignored-builds` shows install scripts that pnpm blocked;
  `pnpm deps:approve-builds` records reviewed approvals in
  `pnpm-workspace.yaml`.
- `pnpm --dir apps/web lint`: pinned Oxlint with `apps/web/.oxlintrc.json`.
  Some Next navigation, React, and React Compiler rules run through Oxlint JS
  plugins; do not remove them to improve benchmark numbers. Rule fixtures live
  in `scripts/web-lint.test.ts`.
- `pnpm zip:src` and `scripts/package-audit-context.sh`: run `pnpm no-js`,
  then build the source or review bundle from git-visible files with local
  residue such as `.env*` and build output filtered out. Raw clone archives
  are unsafe. `scripts/package-audit-context-full.sh` for a PR requires
  `--zip` and refuses repo-visible files under `review-gpt-pr-context/**`.
- Release checks leave job-wide `NODE_OPTIONS` unset so a memory regression
  stays visible at its owner; no package needs its own heap setting.
- npm publication is retired and every workspace package is private. Hosted
  runner assembly keeps its runtime file lists, explicit CLI dependency
  closure, and artifact secret checks.
- `agent-docs/references/testing-ci-map.md` owns the CI job layout, including
  host-support, release checks, and the Web, PostgreSQL, Cloudflare, fixture,
  and bundle jobs. Consent ledger tests run against the separate local
  database named by `MURPH_CONSENT_TEST_DB_URL`.

## Incur-Backed CLI Guardrails

- Model nested CLI verbs with real incur router groups. Argv rewrites or
  synthetic action args break `--schema`, `--llms`, `skills add/list`, and
  command-map typegen, which are truthful only when the router tree is.
- `--format`, `--json`, `--full-output`, `--schema`, `--llms`,
  `skills add/list`, and `--mcp` are incur behavior. Command docs describe
  Murph semantics and payloads and restate an incur default only where the
  repository constrains it.
- An error-envelope change needs built-CLI proof for stable domain code,
  retryability, stage, hint, and field errors, plus non-echo assertions for
  submitted values, raw causes, provider bodies, and absolute paths. Include a
  pre-`serve()` machine-format scenario when invocation planning, vault or
  config resolution, or the outer entrypoint changes.
- An incur version change resolves artifact generation through the installed
  package manifest's `bin.incur` target, regenerates config, types, and skill
  identity after the final patched install, and reruns generation to check
  idempotence. When several incur patch versions coexist, the hosted runner
  stages only the patch specs in its generated production lock graph.
- Keep `packages/cli/src/index.ts` default-exporting the root CLI and refresh
  `packages/cli/src/incur.generated.ts` when command topology changes. If
  `incur gen` is blocked by an unrelated build failure, say so in the handoff.

## Runtime Status

`ARCHITECTURE.md`, `apps/web/README.md`, `apps/cloudflare/README.md`, and
`apps/cloudflare/DEPLOY.md` own the runtime design, deploy path, Worker
secrets, and container images. The facts below are the ones that affect local
verification and debugging.

- Local database inspection in the main checkout uses
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync`.
  Use `murph_test` only in test and E2E lanes that select it; a secondary
  worktree uses its own `murph_dev_<slug>` database. Most hosted Prisma
  `DateTime` columns are `timestamp without time zone` and hold UTC instants.
  Read them as text with `to_char(column, 'YYYY-MM-DD HH24:MI:SS.MS')`, add
  `pg_typeof(column)::text` when the type matters, and use
  `column AT TIME ZONE 'UTC'` only to convert deliberately to `timestamptz`.
- Hosted-web modules that import the shared Prisma client require
  `DATABASE_URL` at module load.
- `vault-cli` loads `.env.local` and then `.env` from the launch directory;
  variables already exported in the shell win.
- Query reads use three write-once files under `.runtime/projections/`:
  `query-entities.sqlite` (including lexical search), `query-metrics.sqlite`,
  and `query-wearables.sqlite`. Inbox runtime is
  `.runtime/projections/inboxd.sqlite` plus `.runtime/operations/inbox/*.json`.
  Hosted device worker state is `.runtime/operations/device-sync/state.sqlite`.
  The local device daemon, its control token, and duplicate worker ingress are
  retired; Web owns provider OAuth sessions and webhook admission.
- Codex App Server assistant turns default to `danger-full-access` with `never`
  approvals. Codex is a privileged local adapter, not a sandbox boundary.
- Source-resolved workspace aliases are limited to the package allowlists in
  `config/workspace-source-resolution.ts`; Vitest subpaths resolve only through
  explicit workspace entries and package-declared public exports.
- `apps/cloudflare/wrangler.jsonc` is the checked-in scaffold. The generated
  deploy config from `apps/cloudflare/scripts/**` is authoritative for
  environment bindings and required Worker secrets.
- Existing supplement-label databases carry the payload constraint as
  `NOT VALID`; `apps/web/README.md` owns the restore sequence and importer
  rollback floor.
- A new runtime target documents its entrypoints, environment assumptions and
  operational guardrails in its app README and `ARCHITECTURE.md`. This
  section keeps only what helps local debugging.

### Live Telegram presentation previews

`TELEGRAM_PREVIEW_CHAT_ID` is the opt-in target for manual Telegram UI
previews. Keep its value in an ignored local env file. When it is set, a
user-facing Telegram presentation change sends representative live samples
after focused local proof and before final review; a backend-only Telegram
change does not. Load the target together with `TELEGRAM_BOT_TOKEN`, render
with the current branch renderer rather than hand-written provider markup, and
report provider message IDs without printing either value. This standing
consent covers product evidence for the configured private target only. It
does not cover unrelated messages, a deploy, or a webhook change.
