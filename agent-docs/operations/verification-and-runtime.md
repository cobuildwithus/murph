# Verification And Runtime

Last verified: 2026-08-11
## Verification Ownership By Delivery Path

The delivery path decides who owns broad verification:

- **Pull request:** before opening or updating the PR, run the smallest focused
  local tests, typecheck/lint/build checks, and direct scenarios that exercise
  the changed behavior. Do not run `pnpm test:diff`, `pnpm test`,
  `pnpm test:coverage`, or `pnpm verify:acceptance` merely because a PR is being
  created. Required GitHub Actions on the exact PR head own the broad package,
  app, coverage, fixture, smoke, and hosted E2E surfaces. The PR is not complete
  until those required checks are green.
- **CI failure:** inspect the failing job and begin with the narrowest local
  command that reproduces its owner or scenario. Expand to `pnpm test:diff`,
  an owner-level verification command, or `pnpm verify:acceptance` only when
  broader reproduction is useful. Do not rerun an unrelated full local suite.
- **Direct shared-default push:** after fetching and reconciling the exact
  candidate for `main` or another shared default branch, run
  `pnpm verify:acceptance` once for that direct-push attempt. This rule overrides
  the PR-focused and docs-only fast paths because there is no PR feedback loop
  before the shared branch changes. If the remote advances while acceptance
  runs, fetch it and allow the unchanged accepted patch one post-acceptance
  normal rebase. Require a conflict-free rebase, prove the patch is unchanged,
  inspect the intervening base diff for overlap or invalidated assumptions, and
  rerun affected focused checks. Do not restart full acceptance solely because
  the base moved. Push immediately after that proof. If the patch changes, the
  rebase conflicts, the intervening diff invalidates acceptance, or the push is
  rejected because the remote advances again, do not rebase or rerun acceptance
  again: report `moving-base race` and stop or move the change to a PR. The
  one-rebase budget remains consumed until push or handoff; a later agent turn
  does not reset it.

Focused local proof is still mandatory for changed behavior. The PR rule moves
the broad suite to CI; it does not permit an untested push or make a green
unrelated check sufficient.

For readiness, the exact PR head is the commit that contains the PR-authored
change; it does not need to be repeatedly merged with a moving base. Keep green
required CI on that head and prove current-base mergeability with
`git merge-tree --write-tree`. At the authorized merge boundary, wait only for
routed review gates and required GitHub checks. If strict up-to-date checks
apply, prefer the merge queue; otherwise allow at most one normal base update
for the unchanged reviewed patch and let required CI gate that head. If the base
advances again after it is green, never perform a second base update or restart
CI. Re-run the current-base merge-tree and follow the terminal non-refresh merge
or `moving-base race` stop rule in `pr-reviewgpt-loop.md`. A non-required check
delays merge only when its failure is relevant to the changed surface or the
user explicitly requested it.

Verification evidence belongs to the exact file state it checked. After the
last code, test, or config edit, rerun every focused command whose inputs or
compiled graph changed; in particular, any later TypeScript edit invalidates an
earlier typecheck result even when the edit appears test-only or mechanical.

For resource acquisition and cleanup changes, prefer executable lifecycle proof
over source-text or statement-order assertions. Exercise the real owner with
narrow injected boundaries and prove acquisition ordering, success, relevant
failure exits, exactly-once release, and awaited cleanup. Text inspection may
supplement that proof, but it cannot establish runtime cleanup behavior.

## Expensive And Stochastic Proof Order

When a change needs a real-model, live-provider, browser, or external review
run, finish the cheap deterministic proof first:

1. Test the exact production boundary result before the expensive run. Assert
   both required text and the absence of conflicting guidance when instructions
   are composed from generic and route-specific parts.
2. Build the expensive scenario from the production prompt, policy, or saved
   automation instructions. Do not retype a reduced approximation when the real
   builder or record is available.
3. Assert the user-visible outcome and owned effects, such as provider call
   count, writes, delivery, or suppression. Do not assert incidental model steps
   such as reading one helper file or choosing search before execute unless that
   exact step protects a product, cost, security, or reliability invariant.
4. Run independent focused tests, typechecks, and lint checks concurrently.
   Start the expensive scenario only after its boundary tests pass, and start
   ReviewGPT only after the complete candidate passes focused proof.

This order keeps stochastic evidence useful without making incidental model
behavior or an avoidable late contradiction trigger repeated expensive runs.

For hosted Linq weighted line-planning changes, the focused owner proof is the
hosted-web Vitest slice covering routing policy, on-demand line load, home
routing, group outreach, canonical thread-route refresh/repair, the bounded
account-projection backfill, and the production migration guard. Keep the
5,000 assignment target assertions separate from the existing 7,000 provider
traffic guideline; this verification slice must not add a runtime traffic-cap
expectation.

For Hosted Assistant Ask target changes, focused proof must cover the shared
contract and parser, exact target-adapter admission and replay, Web
prepare/complete authority revalidation, mailbox routing, reviewed-child
lifecycle, and Cloudflare control-port replay. A private-current-sender change
additionally proves exact accepted group-message attribution to the canonical
author's active personal runtime, rejection of thread-container and
non-accepted-input contexts, conversion to one same-channel `direct-member`
queue-only exact-text notification with no group-route authority, and rejection
of route-changing replay. Provider-entry proof must revalidate the original
private Assistant Ask expiry, exact reviewed-text digest, same personal member,
and current same-channel `direct-member` route, with expiry, revocation, text
mismatch, and route drift all terminal and unable to fall back to the group.
Exact-head CI owns the broad app and package suites.

## Hosted Stripe Billing Verification

Billing changes retain two distinct lanes. Run the focused hermetic owner proof
first; it must not need Stripe credentials:

```bash
pnpm --dir packages/hosted-local-harness exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/stripe-billing-live-config.test.ts \
  test/dev-hosted-local/stack.test.ts
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-onboarding-billing-checkout-route.test.ts \
  apps/web/test/hosted-starter-usage-migration.test.ts \
  apps/web/test/hosted-billing-live-support.test.ts
pnpm hosted-billing:ci-guard
```

The live lane is an explicit external-provider proof, not a replacement for
those tests. With a local PostgreSQL database and the dedicated test-sandbox
environment contract loaded, run:

```bash
pnpm stripe:cli:setup
pnpm hosted-billing:live:preflight
pnpm hosted-local e2e stripe-billing-browser-matrix
pnpm hosted-billing:live:cleanup
```

Never run PR-controlled fork code with writable Stripe authority and never use
`pull_request_target` to work around GitHub's secret boundary. The Actions
classifier admits only same-repository heads (excluding dependency-bot heads)
whose pull-request author and triggering actor are both non-Dependabot. Every
eligible trusted head enters the live lane; absent or malformed sandbox
configuration fails closed. Fork and dependency-bot pull requests run only the
credential-free hermetic lane. The always-present
`Required hosted Stripe billing boundary` job checks the applicable result so
branch protection has one stable required context. The live job exposes the
existing pinned `@openai/codex` workspace binary for hosted-local model-catalog
preparation without adding another CLI dependency. Keep the key on
preflight/matrix/cleanup steps only; within the scenario it reaches the web
Stripe client and harness-owned `stripe listen` child, not the browser,
Cloudflare, Temporal, setup, or runner children. Do not pass it as a CLI
argument or write it to a repository file.

Use stable pre-provisioned test prices and an active default Portal
configuration with plan updates enabled and immediate invoicing. The browser
journey, rather than a cached configuration projection, proves that Stripe
exposes the dedicated Pulse and Edge products. The matrix covers Starter
activation followed by ordinary paid Pulse Checkout, paid Pulse to Edge through
the Portal boundary, Edge to Pulse at renewal, Family Checkout plus invite
activation, and paid individual-to-Family conversion in place. Synchronize on
bounded Stripe object/event state and Murph's PostgreSQL projection; do not
replace those assertions with a fixed sleep. Diagnostics may state only opaque
run correlation, object type/status, and browser step/surface/status. Do not
capture or upload screenshots, traces, raw webhook payloads, URLs, identities,
or full Playwright reports. Cleanup must verify exact run ownership, remain
idempotent, avoid shared catalog objects, and run even after a scenario
failure. Use the standalone cleanup command with the same run id after an
interrupted process.

Stripe Checkout completion uses the official CLI fixture. Paid plan changes use
the supported Subscription Update and Schedule APIs, and provider events traverse
the harness-owned webhook listener before Murph's projection is asserted. The
Family Checkout case starts from an authenticated lapsed individual without an
active subscription, while a separate browser case proves that an already-paid
individual converts to Family through an in-place update of the same
subscription. Edge to Pulse is verified as a renewal schedule, never an
immediate downgrade. Stripe's immutable paid invoices, events, and terminal
records remain as bounded audit history in the dedicated sandbox; cleanup
removes only mutable resources whose exact run ownership was proved. Repository
files contain only the protected Environment contract names; sandbox values
remain external to the checkout.

## Live Junction WHOOP Canary Verification

The public live wearable canary is a protected-main external-provider proof,
not a pull-request check. Its focused hermetic owner proof is:

```bash
pnpm --dir packages/hosted-local-harness exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/junction-wearable-canary-workflow.test.ts
```

The workflow must expose and smoke-check the exact workspace Codex CLI installed
by the frozen root dependency graph before hosted-local model-catalog
preparation. That workspace pin currently matches the independently owned
`Dockerfile.cloudflare-hosted-runner-base` pin; both owners remain visible in
the guarded review context, but no executable cross-owner equality guard links
them. Keep that setup step free of Environment secrets; only the final
browser-canary step may receive Junction sandbox authority and the dedicated
WHOOP login. A real sign-in proof remains available only after the exact
workflow reaches protected `main`, where non-canceling concurrency serializes
the dedicated provider account. Do not weaken the protected-branch gate or
expose live credentials to a pull request to obtain earlier proof.

## Verification Execution Location

The verification matrix chooses the command and coverage surface; it does not
require that finite CPU-heavy work execute on the developer laptop. The canonical
root commands `pnpm test:diff <path ...>` and `pnpm verify:acceptance` pass
through `scripts/verification-dispatch.mjs`:

- CI and already-remote runs execute `scripts/workspace-verify.sh` directly.
- `auto` mode always uses local shared-host admission. Canonical acceptance
  intentionally selects its bounded composed
  profile there when at least 12 logical CPUs are available; ordinary commands
  and smaller hosts keep their conservative shared-host worker budgets.
- `MURPH_VERIFY_EXECUTOR=local|ssh|crabbox` explicitly selects an executor.
  `ssh` uses a configured, dedicated static macOS worker through Crabbox and
  fails closed when its validated host, user, port, Crabbox CLI, or required
  native archive capability is unavailable. Its locked entrypoint selects the
  `static-ssh` verification profile internally; caller environment values do
  not select or tune that profile.
  `crabbox` requests a fresh one-shot Blacksmith Testbox and fails closed when
  either CLI is unavailable. No remote failure silently duplicates work
  locally. The `:local` package aliases exist only for executor diagnosis
  because canonical automatic execution is already local.
- The `crabbox` executor is the only lane that creates paid Blacksmith spend, so
  it is disabled by default and fails closed with a message naming the free
  alternatives. A single deliberate invocation accepts the cost by also setting
  `MURPH_ALLOW_TESTBOX_SPEND=1`. The flag is per-invocation on purpose: do not
  export it into a shell profile, a worktree env file, or an agent's ambient
  environment, because that silently restores the unbounded lane. It gates only
  the paid executor and never widens `local` or `ssh`.
- The Testbox hydration workflow must exist on the repository default branch
  before GitHub accepts a delegated `workflow_dispatch`. The change that first
  introduces or moves `.github/workflows/crabbox-bounded.yml` therefore uses
  local verification and PR gates; after that bootstrap lands, explicitly
  forced canonical commands can create fresh one-shot Testboxes from feature
  branches. Canonical verification rejects reusable lease IDs because current
  provider metadata does not prove the Blacksmith organization that installed
  the root-owned entrypoint.
- The retired `.github/workflows/crabbox.yml` path must remain absent. It is the
  capability hard cut for pre-cost-control dispatchers: a stale worktree fails
  workflow lookup before a Blacksmith job can start. Do not restore that path as
  a compatibility shim.

Remote execution preserves the exact underlying `workspace-verify.sh` command,
including diff scope, reverse dependents, coverage thresholds, app verification,
and acceptance semantics. The remote bootstrap reconciles the synced lockfile
with `pnpm install --frozen-lockfile --prefer-offline` before verification.

### Dedicated static macOS worker

A spare Mac is the preferred free offload lane for finite, CPU-heavy canonical
checks once it is configured. Select it intentionally; `auto` remains local:

```bash
MURPH_VERIFY_EXECUTOR=ssh \
MURPH_VERIFY_SSH_HOST=verification-worker.local \
MURPH_VERIFY_SSH_USER=verification-worker \
MURPH_VERIFY_SSH_PORT=22 \
pnpm test:diff <path ...>
```

`MURPH_VERIFY_SSH_HOST` must be a neutral host name or address that the
initiating Mac can resolve directly; Crabbox's readiness probe does not resolve
an SSH-config-only alias. `MURPH_VERIFY_SSH_USER` names the dedicated account,
and `MURPH_VERIFY_SSH_PORT` is an integer from 1 through 65535. Keep all three
as operator-local command inputs. Never commit a machine address, personal host
label, account, or SSH key path. The dispatcher rejects inline users, combined
host-and-port values, paths, and shell syntax, passes the validated routing only
as Crabbox CLI flags, and omits the three variables from the Crabbox process
environment. Crabbox's first-party static SSH provider owns transport and sync;
Murph adds no daemon, queue, scheduler, shared checkout, or fallback selector.

Prepare the worker once:

1. Create a dedicated standard macOS account used only for verification. Keep
   it out of iCloud, Keychain, password managers, developer cloud CLIs, product
   credentials, repository `.env*` files, and Full Disk Access.
2. Enable Remote Login and restrict SSH access to that account. Give the Mac a
   neutral resolvable DNS or mDNS name. Match that name in local SSH config for
   `IdentityFile` and `IdentitiesOnly yes`; disable agent forwarding.
3. Give only that account access to `/Users/Shared/murph-crabbox`. Install
   `git`, `rsync`, `tar`, `zstd`, Node `>=24.14.1`, and Corepack; the repository
   pins pnpm `10.33.0`. The native `/bin/sh` and `/usr/bin/lockf` must also be
   present. Make `git`, `rsync`, `tar`, `zstd`, `node`, `corepack`, and `lockf`
   visible in the account's non-interactive SSH `PATH`; the doctor probe and a
   canonical run must see the same command surface.
4. Keep the Mac reachable while it is offered as a worker, then prove
   reachability. The verifier cannot wake a Mac that is already offline. Once
   admitted, each run uses native `caffeinate` to prevent idle system sleep for
   the verifier lifetime only; no persistent power change or daemon is
   required:

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

The doctor command proves transport and its supported tool probe only. The
canonical locked entrypoint is the readiness authority for Murph's snapshot
path: before Git reconstruction, dependency installation, or candidate
verification, it creates a bounded `tar` probe and requires `zstd` to preserve
that input through stdin compression with `-3 --no-progress -T2` and stdin
decompression with `-d --stdout`. Missing, incompatible, or corrupt behavior
fails closed with a worker-prerequisite diagnostic.

Each local worktree derives a deterministic opaque static lease id. Every
invocation adds a fresh opaque token and syncs into its own directory below
`/Users/Shared/murph-crabbox/runs`; the local path itself is never sent, only
its truncated cryptographic digest. The per-worktree artifact lock protects
cooperating local artifact producers and candidate capture. It does not lock
editors, prove remote completion, or serialize the Mac.

Before freezing, the dispatcher performs a fail-fast check of the mutable
checkout. It then captures one Git candidate and derives its base commit,
captured index, remote admission, and sensitive-path checks from that immutable
object. New paths must match the captured index. The local candidate keeps the
captured base commit as detached `HEAD` and stages the frozen tree in its index
and worktree, so branch-attached and detached source checkouts both preserve
explicit paths and implicit no-argument `test:diff` scope. The dispatcher
verifies and logs the tree, invokes Crabbox from that candidate with full
resync, and removes the local snapshot when the provider exits. Later checkout
writes and late untracked files cannot enter the run.

Crabbox deliberately excludes `.git` from rsync. Before sync, the dispatcher
adds generated transport metadata containing the exact base tree, candidate
tree, tree objects, and only base blobs absent from the candidate. That metadata
is outside the admitted candidate tree. On the worker, only after native archive
readiness passes does the locked entrypoint move the metadata under a new private
`.git`, reconstruct the base as detached `HEAD`, stage the transported candidate,
prove both tree ids, and check base connectivity before dependency installation.
The metadata is removed after reconstruction. This preserves no-argument
`test:diff` and Git-backed acceptance guards without a source branch or remote
repository credential.

On the worker, `/Users/Shared/murph-crabbox/verification.lock` is the single
static-worker capacity boundary. Native `lockf -t 0` acquires it on a file
descriptor inherited by the remote verifier. A concurrent invocation fails
closed as busy without waiting or falling back. If local transport disappears,
the remote verifier still owns the kernel lock while it reaps its exact child
process groups. Native `caffeinate` prevents idle sleep during that same finite
lock-owning lifetime and preserves the verifier's exit status. Crabbox nests
its static lease and repository below the run-unique directory; the wrapper
resolves the shared lock above that nesting, and cleanup validates the complete
nesting before removing the outer run directory. The remote account may retain
only machine-level package-manager caches outside those directories.

The three routing variables are non-secret local control inputs and are not
forwarded as an environment allowlist. Candidate code enters through
`scripts/crabbox/run-ssh-locked-verification.sh`; its Node verifier rebuilds
the same synthetic test-only environment as the Blacksmith path and stamps
`MURPH_VERIFY_PROFILE=static-ssh` after discarding caller overrides. The root
verifier treats that profile as executor-owned. For `verify:acceptance`, at
least 10 logical CPUs and 24 GiB of detected physical memory admit its bounded
composed plan; a smaller host or unavailable memory measurement retains the
serial fallback. Source environment values cannot change either plan. The
startup `resources` line reports detected CPU and memory plus the authoritative
process, worker, and overlap budgets. The dedicated account is
the trust boundary: candidate code can execute arbitrary repository commands on
that account, so never reuse a personal or credential-bearing account. Static
SSH is host-managed and has no provider TTL or automatic machine shutdown; stop
offering the Mac by disabling Remote Login or removing its authorized key.

### Ten-minute local admission fallback

Measure time spent waiting for the exclusive local shared-host slot separately
from active verification time. If a required canonical command has waited 10
continuous minutes without acquiring that slot, stop only the exact waiting
process tree owned by the current task and rerun the same command on a free
executor first. Prefer the dedicated SSH worker when it is configured and idle,
because it runs the same canonical command without creating spend:

```bash
MURPH_VERIFY_EXECUTOR=ssh pnpm test:diff <path ...>
MURPH_VERIFY_EXECUTOR=ssh pnpm verify:acceptance
```

Only when no free executor can run the command does the paid Testbox lane
apply, and it must be opted into per invocation:

```bash
MURPH_ALLOW_TESTBOX_SPEND=1 MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff <path ...>
MURPH_ALLOW_TESTBOX_SPEND=1 MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance
```

Report the spend when you take that lane: name the Testbox ID and the reason no
free executor was usable. A slow local slot is a reason to wait or to use the
SSH worker, not by itself a reason to spend. The paid forced executor
creates a fresh one-shot Testbox through the fully pinned route. Crabbox stops
every newly acquired delegated Testbox when the one-shot command exits unless
`--keep` is passed; the dispatcher never passes `--keep` or
`--keep-on-failure`. The provider receives its supported 10-minute idle timeout,
and the hydration workflow supplies the 50-minute last-resort ceiling. Do not
leave the local waiter running concurrently, forward local environment values,
bypass the canonical command, warm a lease separately, or return automatically
to another unbounded local wait.
Before delegation, satisfy the Git-state admission boundary, including fully
staging any new non-ignored source or documentation file. If Crabbox cannot run
because its CLIs, authentication, or capacity are unavailable, fail closed and
report that concrete blocker with the completed local evidence. Preserve the
Testbox ID, timing summary, and linked Actions run when delegation starts.

Do not run both remote `test:diff` and remote acceptance on the same exact head.
When acceptance is required, keep the preceding diff checks local and reserve
the one remote check for acceptance; otherwise use the remote diff lane. Retry
an unchanged head only after a concrete infrastructure failure and record that
reason in the completion evidence.

### Required post-landing trust-root proof

One case does not require a ten-minute local admission wait: after a change to
`.github/workflows/crabbox-bounded.yml` or the trusted entrypoint lands on the
default branch, run exactly one explicitly forced canonical remote check to
prove that new trust root. This is required boundary validation, not ordinary
capacity fallback; do not manufacture a local wait first. Use acceptance when
the landed change requires acceptance coverage, otherwise use `test:diff`, and
retain the same lifecycle bounds and evidence.

### Environment and Vercel boundary

Both canonical remote lanes are synthetic and secret-free:

- Blacksmith Testbox rejects Crabbox environment forwarding. Before invoking
  either the Crabbox or Blacksmith CLI, the dispatcher replaces its inherited
  local environment with a small allowlist of host path, account, terminal, and
  XDG config locations. Provider, model, production, GitHub, billing, messaging,
  and application credentials never enter the Crabbox CLI process, so neither
  user-level allowlists nor command flags have a credential value to forward. Do not add
  `--allow-env`, `--env-from-profile`, or credential variables to this lane.
- Crabbox sync can transfer Git-tracked plus untracked non-ignored paths.
  Before either remote delegation, the dispatcher derives authorization from one
  `git status --porcelain=v1 -z --untracked-files=all` boundary. It permits
  modified tracked files, tracked renames/deletions, ignored files, and new files
  whose current contents are fully staged. It refuses ordinary untracked files,
  intent-to-add, staged-then-modified/deleted additions, unmerged states, and
  unsupported status before Crabbox starts. It then checks the cached/tracked set
  for known credential, vault, runtime-state, local-artifact, and private-document
  paths. Authorized staged and modified tracked working-tree content must leave
  the host so the Testbox verifies the exact candidate change rather than only
  the pushed commit. `.gitignore` carries the matching normal exclusions,
  including local Crabbox run artifacts. Every Git subprocess in this guard
  receives the same scrubbed environment as Crabbox, so ambient `GIT_*`
  overrides cannot make the guard inspect a different index or worktree from
  the upload path.
- The default-branch hydration workflow has read-only repository contents
  permission, attaches no GitHub Environment, requests no OIDC authority, and
  references no Actions secrets. It copies
  `scripts/crabbox/trusted-verification-entrypoint.sh` into a root-owned path
  outside the synced workspace before opening the delegated Testbox session.
  Canonical commands invoke only that installed shell. It validates the two
  allowed verification commands, resolves the candidate verifier from the real
  current directory, and directly `exec`s it through `env -i` with an isolated
  temporary home, fixed basic host paths, and a one-bit trusted-entry marker.
- Canonical delegation pins the Blacksmith organization, `main` ref, workflow,
  and hydration job on the command line before the one-shot Testbox is created.
  Local `CRABBOX_CONFIG`, profile, ref, workflow, job, or arbitrary existing
  lease IDs are not trusted routing inputs.
- `scripts/crabbox/run-verification.mjs` fails closed without that marker, then
  calls the shared sanitized verification core.
  `scripts/crabbox/run-ssh-verification.mjs` enters that core directly on the
  dedicated secret-free static account. The core independently rebuilds the
  process environment with deterministic CI-style placeholder values required
  by hosted-web build and smoke checks. Candidate changes can still be verified,
  but they never receive the Testbox orchestration environment first.
  Blacksmith authentication remains in the local Blacksmith CLI and never
  enters either test process.
- The lane never runs `vercel env pull`, `vercel env run`, or copies `.env*`,
  `.vercel`, provider, model, billing, messaging, or production credentials.
- Canonical completion tests are expected to pass under this synthetic contract.
  A separate direct scenario that genuinely requires Vercel development state
  must set `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1`, remain local on an authorized
  host, and be reported separately. Do not weaken the default Crabbox boundary;
  a future remote live-env lane requires its own reviewed Testbox workflow with
  repository-managed, step-scoped secrets. This secret-free workflow bootstrap
  is itself a trust root: a change to it or the installed entrypoint must use
  local verification until that exact trusted version exists on the default
  branch, followed by a post-landing remote proof.

This boundary prevents ambient credential inheritance in the canonical Murph
verification path. It is not an operating-system sandbox: a process that can
already read a production secret and make arbitrary network requests can
exfiltrate that secret without Crabbox. Keep production credentials out of
ordinary local process environments and never use ad-hoc Crabbox or Blacksmith
commands to carry secret values. GitHub production secrets must live only in a
protected-branch environment, never as repository-scoped duplicates that an
alternate workflow ref could request.

When Crabbox runs, record the command, result, executor, and timing summary.
For Blacksmith, also retain the Testbox ID and linked GitHub Actions run.

## Verification Matrix

The delivery-path rule above governs this matrix. For PR-bound work, each row
defines the coverage surface that focused local proof and exact-head CI must
cover; its umbrella command is a diagnostic/full-local fallback, not an
automatic pre-PR requirement. For direct shared-default pushes, run
`pnpm verify:acceptance` regardless of the row. When `pnpm test:diff <path ...>`
is selected locally, it is a complete scoped lane and should not be preceded by
a redundant root `pnpm typecheck`.

| Change scope | Canonical full/scoped command | Notes |
| --- | --- | --- |
| Vault-only data changes under `vault/**` | No repo-wide commands by default. | Read back the touched vault records plus any audit artifacts written by the mutation path. |
| Review-only repo inspection with no file edits | No repo-wide commands by default. | Applies when the user asks for code review, architectural review, or repo inspection only and the task does not modify repo or vault files. Use direct file references and static analysis by default. Run tests, typecheck, or other commands only when the user explicitly asks for runtime proof or when a material review conclusion cannot be supported from static inspection alone. |
| Text-only docs/process-only (`*.md` edits or deletions only) | No repo-wide commands by default. | Allowed only when the diff is limited to Markdown text changes or deletions in repo docs/process files and does not touch scripts, config, tests, generated docs, tracked artifacts, or workflow-enforcement files. Read back the touched docs, confirm any intended deletions directly, and check for obvious broken references when the removed or renamed doc might be linked elsewhere. |
| Low-risk repo-internal workflow/tooling changes | `pnpm test:diff <path ...>` plus direct checks for the touched tooling files | Applies when the diff stays limited to repo-internal docs/process/verification tooling such as `agent-docs/**`, `docs/**`, `scripts/**`, `config/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `vitest.config.ts`, and root `tsconfig*.json`, without touching app/package runtime code, product behavior, persisted-state logic, or deploy/auth surfaces. The diff lane runs shell/Node syntax, architecture/privacy guards, repo-tools TypeScript, dependency policy, and focused repo-tool tests for `scripts/**` or `config/**` changes. Add direct checks such as `bash -n`, `node --check`, focused Vitest, or doc readback for the touched files. Do not precede it with root `pnpm typecheck` or add acceptance lanes unless the change broadens beyond this fast path. |
| Docs/process-only with mechanics beyond text-only Markdown | `pnpm verify:acceptance` | Applies when docs/process work touches anything beyond text-only `.md` edits/deletions and does not qualify for the low-risk repo-internal workflow/tooling fast path above, including broader scripts, config, tests, generated docs, tracked artifact inventories, or workflow-enforcement files. `pnpm verify:acceptance` is the canonical repo acceptance entrypoint and runs `pnpm typecheck` plus the explicit coverage-heavy acceptance lane. When those repo-wide commands are already known red for unrelated reasons, the scoped verification mode below may be used instead. |
| Fixture/e2e/package-doc changes | `pnpm verify:acceptance` | Verifies fixture corpus integrity, scenario-manifest wiring, package-runtime health, built CLI checks, command-surface coverage, and the source-artifact guard for handwritten JS-like files plus tracked `.env` / `.env.*` private files and generated residue such as `dist/`, `.next/`, `.next-dev/`, `.next-smoke/`, `.test-dist/`, and `*.tsbuildinfo`. |
| Changes under `packages/hosted-local-harness` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/hosted-local-harness test:coverage` plus `pnpm --dir packages/hosted-local-harness verify:package-boundary` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched harness files; that lane also runs the hosted-local-harness package-boundary check after the source-first package tests. If the diff changes launch/profile/runtime behavior, add a direct hosted-local command smoke that exercises the changed entrypoint without printing secrets, such as `pnpm hosted-local worktree env <slug>` and `pnpm hosted-local worktree doctor <slug> --json` for worktree helper changes. Full `pnpm hosted-local worktree up <slug>` proof is only required when the task depends on child process startup or provider/webhook behavior. |
| Changes under `packages/contracts`, `packages/clinical-records`, `packages/hosted-execution`, `packages/runtime-state`, `packages/core`, `packages/importers`, `packages/inboxd`, `packages/parsers`, `packages/health-metrics`, `packages/query`, or `packages/openclaw-plugin` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus the edited package's `pnpm --dir packages/<name> test:coverage`; also run `pnpm test:scenario-integrity` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched package owner and reverse dependents. If there is no truthful diff-aware lane for the task, run the edited package's coverage-capable command directly before handoff. `pnpm verify:acceptance` remains the canonical full-repo acceptance entrypoint, but the scoped package fallback should stay coverage-bearing rather than dropping to the no-coverage package lane. The root package-coverage lane bounds its local outer fanout by CPU (up to six processes), drops to `MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY=4` while CLI coverage is active, and derives each package's default Vitest worker cap from the remaining CPU budget instead of multiplying percentage-based worker pools. The OpenClaw package is intentionally skill-first and vault-first: it ships an OpenClaw-compatible bundle rooted at `skills/**` and teaches OpenClaw to use the existing `vault-cli` surface rather than introducing a second Murph assistant runtime. |
| Changes under `packages/health-commons` | `pnpm --dir packages/health-commons verify` | Use the package-local verify lane for authored content, generator, schema, or package test changes. Root acceptance regenerates the ignored catalog for app/typecheck consumers, but it is not a replacement for the package-local Health Commons verification surface. |
| Changes under `packages/assistant-engine`, `packages/assistant-cli`, `packages/setup-cli`, `packages/gateway-core`, `packages/vault-usecases`, `packages/cloudflare-hosted-control`, `packages/messaging-ingress`, or `packages/inbox-services` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus the edited package's `pnpm --dir packages/<name> test:coverage` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched package owner and reverse dependents. If there is no truthful diff-aware lane for the task, run the edited package's package-local `test:coverage` command directly before handoff. Keep the scoped fallback coverage-bearing instead of dropping to a no-coverage package loop. |
| Changes under `packages/device-syncd` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/device-syncd test:coverage` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched device-syncd files. Otherwise run the package-local coverage command directly before handoff. Repo-wide acceptance is still appropriate when the task broadens beyond a narrow package slice. |
| Changes under `packages/assistantd` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/assistantd test:coverage` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched assistantd files. Otherwise run the package-local coverage command directly before handoff. Repo checks typecheck/build the daemon in the workspace graph, execute its loopback-auth/routing tests plus the direct owner-package boundary regressions for `@murphai/assistant-engine` and CLI daemon-routing coverage through the root multi-project Vitest suite, and keep the single-vault loopback plus bearer-token trust boundary documented alongside the CLI runtime it fronts. |
| Changes under `apps/web` | `pnpm verify:acceptance`, or `pnpm test:diff <path ...>` when that diff-aware lane already covers the touched app slice truthfully | `apps/web test` is now the fast hosted-web Vitest lane for local iteration, split into five serial-safe workspace buckets with app-local worker caps defaulting to `MURPH_APP_VITEST_MAX_WORKERS`, then `MURPH_VITEST_MAX_WORKERS`, then `50%` locally or `25%` in CI. File-level Vitest parallelism is enabled locally by default, disabled in CI by default, and in-file suite concurrency is opt-in unless `MURPH_VITEST_SUITE_CONCURRENCY` explicitly enables it. `MURPH_VITEST_FILE_PARALLELISM` still overrides file parallelism, and `MURPH_VITEST_MAX_CONCURRENCY` / `MURPH_CLI_VITEST_MAX_CONCURRENCY` still cap concurrent tests within a file when suite concurrency is enabled. Full repo acceptance still reaches the heavier app-local lint, cold-boot `next dev` smoke under `apps/web/.next-smoke`, and production build under `apps/web/.next` through `pnpm test:apps` and the package-local `apps/web verify` script. For `apps/web`-scoped verification, lint is a standing required check now rather than an optional side effect of `verify`; use `pnpm --dir apps/web verify` as the preferred package-level superset when the lane is otherwise applicable. That hosted lane regenerates the ignored Health Commons catalog, performs one explicit `prisma generate`, and completes the root TypeScript 7 source check before starting the heavier checks. Next then uses the web-local TypeScript 5 compatibility compiler to validate its freshly generated route and page contracts, so both the guarded build and direct `next build` remain fail-closed. The local lane then starts `next build`, `pnpm dev:smoke`, `pnpm test`, and `pnpm lint` as sibling background jobs. CI keeps serial hosted-web substeps unless `MURPH_VERIFY_STEP_PARALLEL=1` is set, and `pnpm --dir apps/web verify:parallel` forces the same local parallel path explicitly. The dev-smoke helper now checks route types and Turbopack cache paths directly instead of recursively walking the whole `.next-smoke` tree, polls readiness every 250ms, and reuses its local Turbopack smoke cache by default; CI still prunes the cache, and `MURPH_HOSTED_WEB_SMOKE_PRUNE_CACHE=1` forces a cold local smoke when needed. It still covers route-type stub bootstrap from the tracked `next-env.d.ts` import, focused Vitest coverage for browser-auth/session helpers, hosted AI usage record import and local allowance accounting, the hosted verified-email sync route and Privy linked-account helpers, durable hosted execution outbox coverage across device-sync/onboarding dispatches, Privy-backed hosted onboarding routes, subscription onboarding Checkout, fixed one-time usage-credit Checkout, webhook-only credit fulfillment, usage blocking/settlement, and Stripe billing recovery paths, hosted Linq ingress routes, interactive-dev isolation under `apps/web/.next-dev`, and source-based workspace package resolution through the shared `config/workspace-source-resolution.ts` helper. Until `apps/web` exposes a narrower owner-level coverage script, keep app edits on `pnpm verify:acceptance` whenever `pnpm test:diff <path ...>` is not already a truthful coverage-bearing lane. |
| Changes under `apps/cloudflare` | `pnpm verify:acceptance`, or `pnpm test:diff <path ...>` when that diff-aware lane already covers the touched app slice truthfully | Repo checks now include hosted-runner app typecheck plus the focused hosted-runner verification surface under `apps/cloudflare verify`, which runs app-local typecheck once and then both the fast Node lane (`apps/cloudflare test`) and the smaller Workers-runtime Vitest lane (`apps/cloudflare test:workers`). That verify surface now runs through `apps/cloudflare/scripts/verify-fast.sh` and defaults locally to overlapping the Node and Workers lanes after the shared typecheck. CI keeps those substeps serial unless `MURPH_VERIFY_STEP_PARALLEL=1` is set, and `pnpm --dir apps/cloudflare verify:parallel` forces the same parallel path explicitly. The Node lane is now split into three serial-safe workspace buckets with the same app-local worker-cap fallback chain (`MURPH_APP_VITEST_MAX_WORKERS`, then `MURPH_VITEST_MAX_WORKERS`, then `50%` locally or `25%` in CI) so local runs can overlap safely without fully serializing the app; the `cloudflare-node-platform` bucket disables file-level parallelism because its container entrypoint tests exercise the shared HTTP server and hosted invocation lifecycle state. File-level Vitest parallelism remains enabled locally by default for other Cloudflare Node buckets, disabled in CI by default, and in-file suite concurrency is opt-in unless `MURPH_VITEST_SUITE_CONCURRENCY` explicitly enables it. `MURPH_VITEST_FILE_PARALLELISM` still overrides file parallelism where a bucket has not explicitly disabled it, and `MURPH_VITEST_MAX_CONCURRENCY` / `MURPH_CLI_VITEST_MAX_CONCURRENCY` still cap concurrent tests within a file when suite concurrency is enabled. That combined Cloudflare verification covers signed dispatch verification, `/health` plus internal route aliases, per-user runner retry/poison state transitions, mailbox-driven `member.activated` workspace initialization, hosted assistant profile seeding/adoption inside the restored runtime, fail-closed hosted assistant config errors, direct-R2 hosted workspace snapshot start/complete metadata routes with presigned PUT session wiring, legacy encrypted bundle/artifact restore compatibility, separate per-user runner env control/persistence handling, keyring-aware hosted ciphertext reads by stored `keyId`, direct Durable Object RPC/alarm coverage inside workerd, and the bounded hosted workspace invocation path that restores the hosted workspace snapshot, imports mailbox input, runs best-effort projection/enrichment, and then runs inbox/parser/assistant/device-sync seams through `@murphai/assistant-runtime`. The app-local no-emit typecheck includes the container-entrypoint and direct-invocation paths. The repo still does not verify a live `wrangler` deploy or Cloudflare-managed native-container provisioning path, but `pnpm --dir apps/cloudflare test:e2e:runner-python:local` now provides a targeted final-image Python PATH E2E that assembles the hosted-runner workspace closure, prepares the cached native base image, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, and checks as the non-root `runner` user from immutable `/app` with the baked runner PATH. `pnpm --dir apps/cloudflare runner:docker:smoke` remains the broader local final-image smoke: it overlays smoke entrypoints into a derived bundle, runs a smoke-local child process inside the container against a restored fixture vault, starts Codex App Server with the hosted shell env allowlist, exercises `vault-cli` through `command/exec` for default vault reads, explicit raw `--vault`, measurement and scheduled-measurement writes, representative list commands, and hidden-vault schema/LLM metadata, resolves and runs `python` / `python3` from the runner `PATH`, exercises the shared `@murphai/parsers` ffmpeg audio normalization/preparation pre-step, and separately proves the Poppler/file PDF toolchain (`file`, `pdfinfo`, `pdftotext`, and `pdftoppm`) against the restored smoke PDF under rebound `HOME`/`VAULT`, while recording metadata-only CLI proof counts rather than only proving those tools in a manual shell; hosted transcription is Worker-mediated Workers AI with no in-image speech model. The path-scoped `.github/workflows/cloudflare-runner-permission-sandbox.yml` lane rebuilds that production image on native `ubuntu-24.04` whenever the Codex permission, runner image, bundle, or smoke surfaces change, so the named-profile filesystem, network, and environment denial proof cannot be accepted only under ARM64 AMD64 emulation where inner seccomp installation is unavailable. For manual local E2E proof, root `pnpm hosted-local e2e` is the canonical hosted-local full suite, `pnpm hosted-local e2e <scenario ...>` runs one or more named scenarios in one prepared suite, `pnpm hosted-local e2e foreground-reply-priority --profile e2e:stub` runs the production-idle-floor foreground priority regression, and `pnpm hosted-local e2e vault-persistence --profile e2e:live` runs the opt-in real Codex app-server vault persistence scenario across a hosted-local restart with a `gpt-5.5` default overrideable through `MURPH_HOSTED_LOCAL_LIVE_E2E_MODEL`. `pnpm --dir apps/cloudflare test:e2e:local` adds the Workers-runtime lane after the generic hosted-local package alias. Private Murph Cloud wires targeted hosted-local E2E jobs into its `Public Murph Integration` workflow with loopback `postgres:17` services and explicit `pg_isready -U postgres -d murph_test` health checks via root `pnpm hosted-local e2e device-connect`, `pnpm hosted-local e2e codex-image-media-delivery`, `pnpm hosted-local e2e linq-delivery`, `pnpm hosted-local e2e linq-webhook`, `pnpm hosted-local e2e linq-scheduled-reminder`, `pnpm hosted-local e2e telegram`, `pnpm hosted-local e2e idle-checkpoint-deferred-progress`, `pnpm hosted-local e2e direct-r2-presigned-put`, `pnpm hosted-local e2e temporal-orchestration`, `pnpm hosted-local e2e foreground-reply-priority`, and `pnpm hosted-local e2e device-sync-junction-wearable-direct-resource-replay`, covering the hosted device-connect smoke, Codex image media delivery, Linq delivery, signed Linq webhook text/PDF/image handling, Linq scheduled reminder, Telegram delivery, idle-checkpoint deferred progress, direct-R2 presigned upload, Temporal orchestration, foreground reply priority, and Junction wearable replay guard flows on every private pull request and private `main` push; manual dispatch targets exact public refs. Compatible scenarios share one suite invocation and runner-image/smoke preparation; the routine Linq reminder/onboarding leg uses the explicit fast timing profile on pull requests and `main`, while the protected deployment gate leaves `MURPH_HOSTED_LOCAL_E2E_FAST_GATE` unset to retain the full profile. Both scheduled-reminder profiles use a 90-second setup lead; fast uses a 1ms idle checkpoint, full preserves the production-like 10-second idle checkpoint, and the scenario enforces at least 5 seconds of remaining runway before Temporal scheduling. Every leg keeps uploading per-job logs and redacted hosted-local state files instead of broadening the default `apps/cloudflare verify` surface to the entire serial E2E bundle or uploading every harness artifact. Until `apps/cloudflare` exposes a narrower owner-level coverage script, keep app edits on `pnpm verify:acceptance` whenever `pnpm test:diff <path ...>` is not already a truthful coverage-bearing lane. |
| Changes under `packages/assistant-runtime` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/assistant-runtime test:coverage` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched assistant-runtime files. Otherwise run the package-local coverage command directly before handoff. Repo checks include the package-local no-emit typecheck through the workspace scripts, plus package-local Vitest coverage through the root multi-project suite and the focused Cloudflare hosted-runner lanes that exercise the package through direct in-process hosted workspace execution, including hosted verified-email self-target reconciliation, the direct owner-package boundary checks for `@murphai/assistant-engine` and `@murphai/operator-config`, explicit runtime-env projection, Cloudflare-managed proxy env preservation, invocation-local writable cache/temp roots, and runtime wake coalescing. This package is the headless hosted execution surface for Cloudflare and should carry explicit runtime context rather than ambient process configuration. |
| Changes under `packages/cli` | Either `pnpm test:diff <path ...>`, or `pnpm typecheck` plus `pnpm --dir packages/cli verify:coverage` | Prefer `pnpm test:diff <path ...>` when it truthfully covers the touched CLI files. Otherwise run `pnpm --dir packages/cli verify:coverage` so the package stays on its prepared runtime and package-shape coverage lane instead of falling back to a no-coverage loop. Repo checks now run `packages/cli` typecheck plus package-local verification through `pnpm verify:cli`. The package-local `pnpm --dir packages/cli test` loop is source-first and no longer requires prepared runtime artifacts or package-shape verification just to start. `pnpm test:diff` keeps reverse-dependent CLI fanout on that same source-first lane by default and escalates into `pnpm verify:cli` only when the diff directly touches CLI artifact-sensitive surfaces such as the CLI package manifest/build/package-shape config, the CLI workspace Vitest configs, the prepared-runtime helper, or the root workspace manifests. Those built-runtime and package-shape checks live behind explicit acceptance commands (`pnpm --dir packages/cli verify`, `pnpm --dir packages/cli verify:coverage`, and the repo-composed `pnpm verify:cli`). The CLI Vitest surface runs through nine workspace buckets; the health-tail, read-model, assistant, and expansion buckets share the bounded root worker pool, while the five explicit `fileParallelism: false` smoke buckets retain separate serial phases. Local worker caps default to `MURPH_VITEST_MAX_WORKERS=75%` unless the environment overrides it, file-level Vitest parallelism is enabled locally by default but disabled in CI by default, and in-file suite concurrency is opt-in unless `MURPH_VITEST_SUITE_CONCURRENCY` explicitly enables it. `MURPH_VITEST_FILE_PARALLELISM` can force file parallelism, and `MURPH_VITEST_MAX_CONCURRENCY` / `MURPH_CLI_VITEST_MAX_CONCURRENCY` cap concurrent tests within a file when suite concurrency is enabled (default `2` locally, `1` in CI). The prepared acceptance lane still covers the required hosted-execution, runtime-state, core, importer, device-syncd, query, inboxd, parser, and CLI runtime artifacts, including the reusable `packages/cli/dist/cli-entry.js` module. The shared CLI runtime-artifact helper trusts a verified in-process artifact state instead of rechecking the full artifact set on every later invocation, and non-stdin CLI integration tests can reuse a persistent subprocess harness by default with `MURPH_CLI_TEST_PERSISTENT_HARNESS=0` as the escape hatch back to isolated per-command processes. |
| User explicitly says to skip checks | Skip checks for that turn only. | User instruction takes precedence. |

For the hosted product-feedback digest, focused Web proof includes the digest
service, authenticated cron route, shared operational-email config, production
cron allowlist, Prisma schema/migration inventory, and Web typecheck. The
service proof must exercise the Eastern daily window across both DST
transitions, the dedicated recipient list, fixed empty digest, day-keyed
idempotency key, the bounded three-kind summary read that selects only the
kind and summary columns with deterministic ordering, truthful grouped
per-kind totals with explicit omitted-remainder lines past the row cap,
observable missing configuration, and a
bounded same-hour retry. The
direct scenario must compose the production sender against an isolated
loopback Resend fake and prove identical request/key reuse plus one fake
delivery after an ambiguous failure. Routine tests must not call Resend or read
production feedback.

For hosted assistant-provider choice, the truthful diff lane must cover
`packages/hosted-execution`, `packages/operator-config`,
`packages/assistant-runtime`, `apps/web`, and `apps/cloudflare`. Focused
iteration should include the provider contract/config suites, hosted Web
preference/route/component/workspace tests, and Cloudflare egress plus deploy
preflight tests. Final proof remains `pnpm test:diff ...` across the touched
owners plus `pnpm verify:acceptance`, desktop/mobile design-catalog evidence,
and the routed review gates. Routine verification uses synthetic credentials
and must not call a paid provider.

Saved-card group-funding changes stay on the full `apps/web` acceptance lane.
Focused iteration must cover canonical card selection, durable PaymentIntent
binding before confirmation, exact-intent recovery after ambiguous responses,
account-deletion-before-bind cancellation, verified cancellation before
Checkout fallback, payer-owned sessionless cancellation, direct webhook
fulfillment, payerless refund/dispute convergence without a Checkout Session,
the shared dialog, and a real migrated-PostgreSQL account-deletion proof that a
sessionless fulfilled purchase detaches while missing PaymentIntent or Charge
lookup proof is rejected by the database constraint.
These provider-backed tests remain mocked; release proof still needs the
documented Stripe test-mode and desktop/mobile browser smokes.

The read-only Labs slice spans a provider trust boundary, two app surfaces, and
the hosted assistant runtime. Its local PR proof is therefore the union of
focused hosted-execution contract, hosted-web provider/API/UI, Cloudflare port,
assistant-runtime bridge, and assistant-engine tool/prompt tests. Exact-head CI
owns the broad diff and scenario-integrity surfaces; direct shared-default
pushes use `pnpm verify:acceptance`.
Capture authenticated, fixture-safe desktop and mobile `/labs` proof without
putting a real query or ZIP in a durable artifact. Complete the preliminary
ReviewGPT product-experience/prompt/frontend/coverage pass, the review-only
Fable or Opus UI pass, and the separate final ReviewGPT gate before handoff.
Live Junction calls are operator smoke only and must use environment-held
credentials with secret-safe aggregate output; routine CI stays stubbed.

The pull-request body proof workflow requires the four concrete `Architecture
and reuse` bullets on every PR. It validates rendered GitHub Markdown so hidden
comments, code blocks, and raw HTML cannot satisfy the requirement.

For every user-facing `apps/web` UI diff, verification also includes
`pnpm test:frontend-design-proof`, a production-component update on
`/design?tab=components` or a composed-section update on
`/design?tab=sections`, and desktop and mobile screenshots from that catalog
surface in the pull request. The pull-request workflow repeats the policy check
against the final base-to-head diff and PR body. Prefer an attached in-app
Browser for this proof when available, then fall back to the repository-installed
Playwright runtime against the local catalog when no tab is attached or the
connection is unusable. Browser attachment alone must not block completion when
Playwright can capture the required states. Treat that fallback as required:
attempt Playwright before asking for a browser attachment or reporting a
screenshot blocker, and record the exact command and failure only if Playwright
cannot capture the proof. Capture lossless PNGs at 2x device scale or higher,
crop to the changed component or section, and visually inspect both the local
file and the hosted `/designproof` Cloudflare Images variant at native
resolution. Do not use a long full-page capture that makes review text smaller
than the rendered UI.

## Scoped Verification Mode

Focused local proof is the default for PR-bound work and does not require a
pre-existing red repo baseline. The scoped-verification exception below applies
only when a non-PR task would otherwise require a broader local command. The
text-only docs/process fast path remains the default for eligible Markdown-only
docs work unless the change will be pushed directly to a shared default branch.

The local Frog autofix entrypoint uses `scripts/frog-autofix scan` for a
non-repairing live admission proof. The command may fetch `origin/main` and
query public issue metadata, but it must not create durable autofix state or a
worktree, start Codex, edit GitHub state, or print issue titles/bodies. Focused
implementation proof is:

```sh
pnpm exec vitest run scripts/frog-autofix.test.ts \
  --config scripts/vitest.config.ts --no-coverage
bash -n scripts/frog-autofix
scripts/frog-autofix scan
```

After the owning PR merges, installation proof must run from the exact clean
primary checkout: install with the intended Codex home, confirm `status`
reports `loaded=yes` and `interval_seconds=7200`, inspect the generated plist,
launcher, relative locators, lock, and bounded event log for owner-only modes
and identifier/credential absence, then invoke one manual `run`. When no
committed eligible binding exists, success is a no-worker event. When one does
exist, the exact GitHub PR/check/merge/issue lifecycle is the required end-to-
end proof; a locally successful child exit alone is not completion evidence.

## Hosted Temporal Replay Proof

Private `cobuildwithus/murph-cloud` owns the Temporal Workflows, Activities,
production bundle, replay fixtures, and package verification lane. Changes
there that add, remove, or reorder awaited command-producing Temporal APIs
require Worker Versioning or deployment pinning, TypeScript Workflow patching,
or a Temporal replay test against captured or synthetic pre-change histories.

Pure state-machine tests, mocked Activity tests, and local signal/timer tests
do not prove replay compatibility for existing Workflow histories. Captured
history fixtures must be redacted or synthetic and must not commit raw payloads,
prompts, transcripts, provider responses, secrets, local paths, or direct user
identifiers.

Public shared-contract changes that affect Workflow inputs, signals, queries,
or retry semantics require the private `Public Murph Integration` workflow
against the exact public ref in addition to public checks. The public
`hosted-temporal:guard` remains wired into `pnpm typecheck`; it prevents the
worker implementation from returning here and retains the Web/Cloudflare
architecture guards, while Murph Cloud owns patch-marker and replay gates.

Scoped verification may replace the repo-wide baseline only when all of the following are true:

1. The change is narrow and bounded to one subsystem or one docs/process lane rather than a broad refactor.
2. `pnpm typecheck` or `pnpm verify:acceptance` are already credibly known red for unrelated reasons in the current branch or working session.
3. You can name the exact failing command and failing target, and explain why your diff did not cause that failure.
4. You run the highest-signal scoped checks available for the touched surface and record the evidence in handoff.

Scoped verification is allowed for narrow changes such as:

- low-risk repo-internal workflow/tooling changes where `pnpm test:diff <path ...>` plus direct touched-file checks fully exercise the changed surface
- docs/process-only updates outside the text-only Markdown fast path when repo-wide checks are already known red and manual readback confirms the touched docs are internally consistent
- package-local or app-local fixes with a focused test, typecheck, verify, or scenario command that exercises the changed surface directly; for agent/local iteration on repo code, prefer `pnpm test:diff` first so the scope expands from changed owners to their workspace dependents automatically
- small config changes with a direct validation command or targeted test covering the changed contract

Scoped verification is not allowed when the change is broad, cross-cutting, or high-risk, including schema/storage changes, billing/auth/trust-boundary changes, deploy/runtime entrypoint changes, or refactors that touch multiple subsystems. Those changes still need the full repo-wide baseline unless the user explicitly says otherwise.

When using scoped verification, handoff must include:

- that scoped verification mode was used
- which repo-wide commands were omitted or left red
- the prior unrelated failing command(s) and target(s)
- the focused commands or direct scenario checks that were run instead

## Pnpm Guard

- Do not add `--config.verify-deps-before-run=false` to repo verification commands or package-local verification commands.
- If `pnpm` reports `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`, treat that as a real workspace-state problem to fix or report, not a guard to bypass.
- Verification evidence in plans, prompts, and handoff should use the normal command forms unless a user explicitly asks for a different command shape.

## Low-Risk Fast Path

Use the low-risk repo-internal workflow/tooling fast path when all of the following are true:

1. The diff stays within repo-internal docs/process/verification tooling paths such as `agent-docs/**`, `docs/**`, `scripts/**`, `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, `vitest.config.ts`, or root `tsconfig*.json`.
2. The change does not touch app/package runtime behavior, product behavior, persisted-state logic, auth/trust boundaries, or deploy surfaces.
3. Focused tests or direct touched-file checks are enough to exercise the
   changed surface locally.

When that fast path applies:

- Direct checks on the touched tooling files remain required.
- For a PR, `pnpm test:diff`, `pnpm test`, `pnpm verify:acceptance`, and explicit
  acceptance-only lanes such as `pnpm test:coverage` are optional and should be
  skipped unless the touched files or a CI failure need broader proof.
- A direct shared-default push still requires `pnpm verify:acceptance`.

## Current Command Meaning

Hosted-web production build memory: on Linux CI, `apps/web verify` defaults to
wrapping its production `next build` step with
`apps/web/scripts/build-memory-guard.sh`. The guard creates a root-level
cgroup-v2 child for accounting only, moves the build process into that cgroup,
and then execs the build as the invoking user with the caller's environment,
working directory, and stdio unchanged. In the current observe-only state it
does not write `memory.max`, `memory.swap.max`, or `memory.oom.group`. The
Vercel package build starts the parent Next process with a direct 1 GiB
old-space flag and appends a 3 GiB old-space flag to `NODE_OPTIONS`. Node applies
the direct flag to the parent; Next 16.3.0 rebuilds its non-isolated TypeScript
worker options from the parent arguments followed by `NODE_OPTIONS`, so the
mandatory generated-contract validation receives 3 GiB. Next removes the flag
from isolated static workers. The same script owns the Vercel package build and
CI memory-observation invocation. This bounds the compile parent without
weakening validation, but only repeated forced-cold Standard previews prove the
real Vercel boundary. A 2 GiB parent-bound candidate passed one forced-cold
preview but the next identical build was still killed by the 8 GB container
OOM boundary. Single
global 1 GiB and 1.5 GiB limits starved Next's generated-contract TypeScript
worker, and a 1 GiB parent / 2 GiB worker split did the same. A 1 GiB parent /
3 GiB worker split completed the full local build. Either failure mode still
invalidates the candidate. The first forced-cold Standard preview with that
split still exhausted the container during Turbopack compilation. Profiling
then found that `/design` made the entire catalog a client graph solely to own
its `tab` query parameter. Moving query parsing to the route Server Component,
using URL-backed tab links, and routing reachable client modules through narrow
client-safe public imports keeps the catalog shell server-owned; only the three
synthetic studies that pass callback props declare local client boundaries. A
cold local Turbopack compile then fell from roughly 4.4 minutes to 57 seconds
and completed all 229 static pages with the same heap policy. Repeated
exact-head Standard previews remain the external acceptance proof. The
next exact-head Standard preview still OOM-killed Turbopack, so the catalog
correction remains a boundary fix but was not sufficient capacity proof on
Next 16.2.6. Production and Linux CI now use Next 16.3's default Turbopack path
through the same shared production-build selector. The Workflow integration
runs through its native Next integration: exact-head CI proves the complete
compile, type-validation, static-generation, and directive-discovery path,
while focused Stripe and phone-call suites prove the existing
`workflow/api.start` wrappers and step contracts. Two forced-cold exact-head
Standard previews completed without OOM: compilation took 91 and 87 seconds,
TypeScript validation took 54 and 55 seconds, all 233 pages took 10.0 and 10.8
seconds, and each Vercel build stage completed in four minutes. These repeated
previews remain the external memory acceptance proof. The accepted Next 16.3
candidate preserves the heap policy and all route/type validation. The
advisory budget is a cgroup-unit machine model
for Vercel Standard's 8 GB build machine: 7.2 GB available to the build cgroup,
with a 0.8 GB reserve for OS/container overhead outside it at the ceiling. The
legacy-named guard budget override must stay strictly greater than the
6,000,000,000-byte cgroup floor
and less than or equal to 7,200,000,000 bytes, which preserves at least a 0.8 GB
reserve under that model. The floor comes from a fully working Linux CI run on
2026-07-06 where a 6.0 GB cgroup cap OOM-killed a build that the real Vercel 8
GB machine accepts, so caps at or below that floor are known false positives.
PR #349's 5.34 GB passing and 6.18 GB exit-137 failure numbers are historical
single-process RSS measurements only; they are not comparable to cgroup
accounting, which includes anonymous memory across all build workers plus page
cache. Live CI on 2026-07-07 showed enforcement cannot ship green yet:
`turbopackMemoryLimit=3GiB` produced the same cold-build anon ramp as the 4 GiB
(about 2.9 GB at 12 seconds, 5.5 GB at 27 seconds, and 6.9 GB at 42 seconds)
before an OOM-group kill. That historical result still prevents enabling the
hard cap until exact-head CI accounting proves a safe enforced budget. Next
16.2.6 discards that option when creating its native backend, so the experiment
changed no enforced target. The no-op option is now omitted. The
guard samples cgroup `memory.current` and selected `memory.stat`
fields about every 3 seconds, prints trajectory lines about every 15 seconds,
then reports sampled maxima before cgroup `memory.peak`, `memory.events`, and
selected final-read `memory.stat` values. If sampled max anon or `memory.peak`
exceeds the advisory budget, it prints a loud `WOULD EXCEED` warning while
preserving the wrapped build's exit status. It fails if cgroup v2, the root
memory controller, passwordless `sudo`, or peak accounting are unavailable.
Disabling the guard in Linux CI requires
`MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0` and logs a prominent warning that the
Vercel Standard-machine memory budget is not being measured. Local non-Linux
wrapper validation may use
`MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=passthrough`, but CI rejects
passthrough mode. Flipping back to enforcement means restoring the `memory.max`,
`memory.swap.max`, and `memory.oom.group` writes once the cold build fits under
the advisory budget.

- `pnpm build:workspace:clean`: clears the referenced workspace-build runtime-package outputs plus their project-reference `tsbuildinfo` files first, preserving `packages/importers/dist` during the clean step because package entrypoints can be loaded directly by release checks. It then runs the root TypeScript project-reference graph through one `tsc -b tsconfig.json` invocation and finishes with the importers package safe build, which compiles through a private staged config and refreshes `dist` with a complete directory swap only after importers TypeScript succeeds. Use this when the build itself needs clean-build semantics, such as release or CI proof.
- `pnpm build:workspace:incremental`: runs that same root TypeScript project-reference graph without first deleting outputs or incremental metadata, then refreshes `packages/importers/dist` through the package safe build, so warm local runs can reuse package-local `.tsbuildinfo` files while keeping published entrypoints current. The importers staged config is private to the package build helper; downstream package `tsconfig` references stay on the normal importers project boundary.
- `pnpm build:test-runtime`: clears the narrower runtime-package `dist/` outputs first, then runs the focused TypeScript project-reference graph in `tsconfig.test-runtime.json`, building only the workspace runtime artifacts needed for built CLI consumers and the root package Vitest lane. It also refreshes `packages/importers/dist` through the package safe build after the focused graph succeeds.
- `pnpm build:test-runtime:prepared`: reruns that same focused TypeScript project-reference graph without first deleting the existing runtime-package outputs, so repeated local CLI verification can reuse already-prepared runtime artifacts while still refreshing changed files. It now tries the incremental pass first, refreshes `packages/importers/dist` through the package safe build after successful TypeScript passes, falls back to a forced rebuild only when the post-build smoke check sees missing artifacts, verifies the reusable `packages/cli/dist/cli-entry.js` module alongside the existing built CLI runtime outputs, and acquires the same per-worktree workspace-artifact lock used by the explicit artifact-sensitive verify lanes so concurrent runs on one clone queue instead of clobbering shared emitted artifacts.
- `pnpm build`: runs package-local `build` scripts through pnpm's topologically sorted workspace runner with `MURPH_BUILD_WORKSPACE_CONCURRENCY` defaulting to `4`, so package-specific build hooks still run while sibling packages can build in parallel when their dependency edges allow it. Package-local TypeScript build scripts intentionally avoid `tsc -b --force`; pnpm's dependency order builds shared packages first, and non-forced project-reference builds avoid making parallel sibling packages rewrite the same dependency outputs.
- `pnpm clean`: removes workspace build artifacts such as `dist/`, `.next/`, `.next-dev/`, `.next-smoke/`, `.test-dist/`, and `*.tsbuildinfo` through the repo-owned `scripts/rm-paths.mjs` helper instead of the third-party `rimraf` package, then prunes untracked generated JS/declaration sidecars that sit next to tracked TypeScript source files under `packages/`, `apps/`, and `e2e/`. Hosted `apps/web` interactive dev uses `apps/web/.next-dev`; do not run `pnpm clean` beside a running interactive hosted dev server unless you intend to remove that cache. Smoke output remains disposable under `apps/web/.next-smoke`.
- `pnpm no-js`: first prunes untracked generated JS/declaration sidecars that sit next to tracked TypeScript source files, then fails if handwritten `.js`, `.mjs`, `.cjs`, or `.d.ts` source files remain under `packages/`, `apps/`, or `e2e/` outside the generated `apps/web/next-env.d.ts` allowlist plus the explicit `apps/web/{postcss,eslint}.config.mjs` framework config paths, or if tracked `.env` / `.env.*` private files or generated residue such as `dist/`, `.next`, `.next-dev`, `.next-smoke*`, `.test-dist`, or `*.tsbuildinfo` is committed there.
- `pnpm deps:guard`: validates the repo dependency policy by requiring the committed `pnpm-lock.yaml`, a pinned root `packageManager`, matching `engines.pnpm`, the root pnpm supply-chain settings in `pnpm-workspace.yaml`, `workspace:` protocol for internal packages, and registry-sourced third-party specs instead of git/url/file/alias shortcuts.
- `pnpm deps:audit`: runs `pnpm audit --audit-level=high` so dependency changes can be screened for known high-severity advisories before handoff.
- `pnpm deps:ignored-builds`: shows dependency install scripts that pnpm blocked so dependency updates can be reviewed instead of silently executing new lifecycle code.
- `pnpm deps:approve-builds`: records reviewed install-script approvals into `pnpm-workspace.yaml` after a trusted-machine dependency refresh.
- `pnpm typecheck`: validates shell syntax, syntax-checks the root `.mjs` release helpers, runs `pnpm deps:guard`, the workspace-boundary and package-cycle audits, hosted architecture/privacy guards, repo-owned TS tools typecheck, the contracts build, and every package/app no-emit typecheck. The canonical root and workspace `tsc` binary is stable TypeScript 7; the hosted web keeps a local TypeScript 5 dependency only for Next, ESLint, Workflow, and Solana tools that still require the legacy JavaScript compiler API or peer range. Repo-owned source-analysis checks use Babel's parser and do not depend on a TypeScript compiler API, so the web-local TypeScript 5 boundary can be deleted independently once its framework/tooling consumers support TypeScript 7. Tsconfig path-map discovery now reads root tsconfigs non-recursively and scans only `packages/**` plus `apps/**`; it no longer walks unrelated local residue. The repo-tools pass keeps an ignored `tsconfig.tools.tsbuildinfo` cache for warm runs. Independent preflight checks overlap the contracts prerequisite, then the package/app fanout runs with `MURPH_TYPECHECK_WORKSPACE_CONCURRENCY=min(logical CPUs, 8)` on an ordinary local host, `2` on CI or a local shared host, and no unnecessary topological ordering. The capable-host acceptance composition may use the wider local fanout inside its exclusive verification slot. The command retains the per-worktree artifact lock and clean contracts proof used by full acceptance.
- `pnpm test:diff`: the self-contained optional local lane for a diff-aware
  scoped check or CI diagnosis. It maps the requested worktree paths to
  workspace owners and reverse dependents, runs the relevant global guards,
  then batches affected typechecks through the existing bounded pnpm fanout and
  batches exact package-local test scripts through
  `MURPH_TEST_DIFF_WORKSPACE_CONCURRENCY` (up to four local processes by
  default). Each nested Vitest process receives an absolute worker budget
  derived from available CPUs; `MURPH_TEST_DIFF_VITEST_MAX_WORKERS` can override
  it. When Assistant Engine is selected, its test command runs separately with
  the same 6 GiB heap ceiling used by package coverage so the single-worker
  diff lane does not fall back to Node's insufficient 4 GiB default. Contracts
  build/test mutation stays behind the artifact lock, package-boundary
  follow-ups remain intact, and two affected apps reuse the parent-locked
  parallel `test:apps` lane. CLI source-first/escalation semantics are
  unchanged. Tooling-only diffs retain the narrow guard fast path, while root
  workspace manifests still broaden to the whole workspace. Because this lane
  already typechecks touched owners and reverse dependents, do not pair it with
  a separate root `pnpm typecheck` for narrow changes.
- `pnpm test`: runs the fast deterministic behavior loop under the artifact lock: warm-safe incremental contracts artifact verification, the root multi-project Vitest lane, and fixture/scenario-manifest verification without coverage. Full acceptance and release lanes retain clean contracts builds. Package projects share one bounded pool; the four independent CLI buckets share the next phase, while the five explicit `fileParallelism: false` smoke buckets remain isolated. Shared Vitest global setup places every ordinary package/app/repo-tool process beneath one marked private temp root inside a dedicated Murph owner directory, removes it on teardown even after test failures, and sweeps only old dead-owner marked roots before a later run without enumerating unrelated host temp entries. `MURPH_VITEST_MAX_WORKERS` now actually controls the root and ordinary package configs, defaulting to `75%` locally or `50%` in CI. Local runs overlap repo Vitest with scenario-manifest verification when `MURPH_TEST_LANES_PARALLEL` allows it; CI stays sequential by default.
- `pnpm docs:drift`: runs the manual durable-doc drift check. Use it when a task intentionally changes `agent-docs/**`, `ARCHITECTURE.md`, or other durable repo docs and you want the old index/truthfulness guard explicitly, without making every default `pnpm test` run sensitive to unrelated dirty-tree doc work. Doc gardening intersects unindexed findings with Git's tracked-file inventory, so ignored or otherwise untracked local documents cannot block acceptance. It also excludes immutable `agent-docs/exec-plans/completed/**` snapshots from live index enforcement; active plans and durable current docs remain governed.
- `pnpm test:packages`: uses the same incremental contracts prerequisite and bounded root multi-project Vitest suite as `pnpm test`, without fixture smoke. It covers every root-wired package project plus all nine CLI buckets, with the four independent CLI buckets sharing one phase and the five explicit serial buckets retaining separate phases. It leaves app verification and prepared CLI package-shape acceptance to their dedicated commands.
- `pnpm test:apps`: holds one parent artifact lock, prepares Health Commons output and the hosted-web Prisma client once, then executes `apps/web verify` and `apps/cloudflare verify` concurrently by default locally (serially in CI unless overridden). Both children consume the prepared inputs instead of racing their own generation and therefore realize the intended parallel app lane. Their existing internal parallelism, app-local worker caps, and acceptance skip flags remain unchanged.
- `pnpm test:packages:coverage`: prepares the built CLI/runtime inputs, enforces each package's coverage command, and runs built package-boundary checks. Standalone local outer fanout is CPU-aware and capped at six processes; the default per-process Vitest cap is the available CPU count divided by that outer fanout, avoiding the former multiplication of six 75%-of-machine pools. The capable-host acceptance composition protects subprocess-heavy CLI coverage with four workers and one concurrent two-worker package process, then refills to at most five two-worker package processes after CLI releases the two app pools. On the standard 16-vCPU profile that bounds the scheduled Vitest total at 14 workers after the protected phase instead of multiplying per-process percentages. On a resource-qualified static worker, the executor-owned profile instead protects CLI coverage with three workers and one concurrent two-worker package process, then refills to three two-worker package processes. Smaller or memory-unobservable static workers retain the two-process, two-worker serial fallback. Source environment overrides cannot change either static plan. CI remains one outer process with a 50% inner cap. `MURPH_PACKAGE_COVERAGE_CONCURRENCY`, `MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY`, `MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS`, and `MURPH_PACKAGE_COVERAGE_CLI_VITEST_MAX_WORKERS` remain explicit overrides for the default profile. Contracts and CLI artifact ordering, failure aggregation, and prepared acceptance behavior are unchanged.
- `pnpm test:coverage`: runs the explicit coverage-focused acceptance lane: repo/doc/artifact guards, prepared package coverage, scenario-integrity coverage, and app verification. Standalone local package coverage uses CPU-aware outer fanout capped at six processes and divides the worker budget across them; CI remains serial by default. The capable-host acceptance composition starts Web tests, lint, and dev smoke with package coverage under bounded worker budgets. CLI completion releases the hosted-web Next build and Cloudflare's serial app tests and independently releases package coverage from its protected phase into its full refill. The Assistant Engine coverage owner receives the repository-pinned `NODE_OPTIONS=--max-old-space-size=6144` already proven by release CI, while other package coverage commands retain their existing environment. Standalone coverage prepares its own generated inputs; `pnpm verify:acceptance` reuses the preceding typecheck's guards, contracts output, Health Commons catalog, and Prisma client. On a static worker with at least 10 logical CPUs and 24 GiB of detected physical memory, the executor-owned profile overlaps package coverage, fixture verification, and both apps. It gives each ordinary package two workers, the CLI three workers, and each app Vitest pool one worker; CLI completion still gates the Next build, Cloudflare tests, and the package refill from two to three processes. Smaller or memory-unobservable static workers retain the prior serial two-process/two-worker plan. The static profile ignores caller worker and overlap controls. The existing lane-parallelism, retry, and coverage-budget environment overrides remain available to the default and CI profiles, and source-artifact hygiene continues to reject private env files and generated residue.
- `pnpm verify:acceptance`: the canonical repo acceptance gate. It runs through the root workspace verifier so one lock covers the whole acceptance pass: first the full `typecheck` surface, then the coverage-heavy acceptance lane with already-proven repo guards skipped, `apps/cloudflare` app-local typecheck skipped, and the contracts artifact verification reusing the `packages/contracts` build from typecheck. On non-CI default-profile hosts with at least 12 logical CPUs, including a locally forced Codex/shared-host execution and the Blacksmith Testbox, its startup log reports the composed resource profile. Independent doc gardening and prepared-runtime setup overlap before coverage begins. Web tests/lint/dev smoke then start immediately while the protected CLI phase uses four CLI workers plus one two-worker package peer. CLI terminal success or failure publishes one invocation-scoped readiness marker: that releases Cloudflare's serial app tests and the hosted-web Next build without hiding the CLI result, lets package fanout refill to at most five two-worker processes, and is removed by the root owner at completion. The sanitized bootstrap does not set an app-step policy for that default profile; the root verifier alone assigns Web-parallel and Cloudflare-serial behavior. Static SSH is resource-qualified by construction: its entrypoint selects `profile=static-ssh`, and the verifier admits composition only with at least 10 logical CPUs and 24 GiB of detected physical memory. The `resources` line reports those measurements and the effective worker/overlap plan. Smaller or memory-unobservable static workers retain the serial fallback. Standalone `pnpm test:coverage`, smaller default-profile hosts, and CI retain their self-contained or conservative defaults unless explicitly overridden.
- `pnpm zip:src` and `scripts/package-audit-context.sh`: shell through `pnpm no-js`, which first prunes untracked generated JS/declaration sidecars that sit next to tracked TypeScript source files and then runs the tracked-artifact hygiene guard, before building the source/review bundle from git-visible files while scanning `config/**` alongside app/package code and filtering blocked local residue such as `.env` / `.env.*`, `dist/`, `.next/`, `.next-dev/`, `.next-smoke/`, `.test-dist/`, `*.tsbuildinfo`, and `packages/health-commons/generated/**` paths out of the manifest. This keeps ignored local artifacts out of the upload bundle without requiring a clean development worktree, while raw clone archives remain unsafe.
- `pnpm test:scenario-integrity`: the root command for fixture/scenario-manifest integrity verification. It is not executable end-to-end smoke.
- Automatic meal-photo capture spans `apps/web`, `packages/{cloudflare-hosted-control,hosted-execution,assistant-runtime,runtime-state,assistant-engine,core,vault-usecases,cli}`, and `apps/cloudflare`. Enrollment-contract changes additionally prove both arrival orders for schema-v2 enable/disable, missing-row tombstones, exact disabled replay, stale and duplicate conflict behavior, higher-revision prepare, lost-response inactivity, exact bodyless activation and retry, activation/deletion in both serialization orders, activation against direct access, consent, sponsored-member, and sponsoring-group loss under real PostgreSQL locks, schema-v1 revision-zero immediate activation, signed-32-bit parsing, complete prepared/active credentials, and exact expand/contract SQL against opt-in local PostgreSQL. PR-bound work runs focused route, companion bearer-consent recovery, current verified-email recipient authority, accepted-capture member-wide engagement, system-only cron/cleanup, foreground fairness, contract, storage, canonical-import, managed-automation, oldest-first closeout-work, and photo-retirement proof locally while exact-head CI owns broad acceptance. A direct shared-default push must use `pnpm verify:acceptance`. Neither automated path replaces a signed physical-iPhone opt-in/upload check because routine CI has neither iOS Photos authority nor production R2 access.
- `pnpm release:check`: assumes dependencies are already installed, syntax-checks the release helpers and final-tarball secret guard, runs the guard's focused Node tests, validates the fixed-version monorepo release manifest plus publish metadata, then runs `pnpm build:workspace:clean` and `pnpm verify:acceptance`. The tag-driven release workflow performs the one required install up front, opts the verify lanes into CI parallel execution through `MURPH_TEST_LANES_PARALLEL=1`, `MURPH_APP_VERIFY_PARALLEL=1`, and `MURPH_VERIFY_STEP_PARALLEL=1`, and leaves the actual tarball packing to the later dedicated pack step instead of repacking inside `release:check`. Packing scans the final tarballs before writing their manifest, npm publication scans them again before its first provider request, and GitHub Release creation scans the downloaded one-day handoff artifact before permanent upload. The manifest may live outside the checkout and point to the established external pack output, but it still records repository-relative `.tgz` paths and one exact shared-directory inventory. Treat `release:check` as the release-specific extension of `pnpm verify:acceptance`, with the extra clean-build proof layered on top.

## Incur-Backed CLI Guardrails

- Model nested CLI verbs with real incur router groups. Do not use argv rewrites or synthetic action args to mimic nested commands, because `--schema`, `--llms`, `skills add/list`, and command-map typegen only stay truthful when the router tree itself is truthful.
- Treat incur-owned transport and discovery features as framework behavior: `--format`, `--json`, `--full-output`, `--schema`, `--llms`, `skills add/list`, and `--mcp`. Command-surface docs should describe Murph semantics and payloads, not restate incur defaults command-by-command unless the repo is deliberately constraining them.
- Keep `packages/cli/src/index.ts` default-exporting the root CLI and refresh `packages/cli/src/incur.generated.ts` whenever command topology changes. If `incur gen` is blocked by an unrelated build failure, record that explicitly in the handoff instead of silently leaving stale generated types.
- `packages/cli/test/cli-test-helpers.ts` executes `packages/cli/dist/bin.js`, so source checks like `pnpm exec tsx packages/cli/src/bin.ts ...` are only a diagnostic shortcut. Final verification still needs the built CLI path or a clearly documented unrelated blocker.

## Runtime Status

- For local database inspection and debugging in the main checkout, use
  repo-local PostgreSQL/Prisma tooling with
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync`.
  Use `murph_test` only in test/E2E lanes that explicitly select it; secondary
  worktrees must use their isolated `murph_dev_<slug>` database. Most hosted
  Prisma `DateTime` columns are `TIMESTAMP(3)` / `timestamp without time zone`;
  Murph treats them as UTC-naive instants unless a migration explicitly uses
  `TIMESTAMPTZ`. When inspecting those columns, project the stored value as text
  with `to_char(column, 'YYYY-MM-DD HH24:MI:SS.MS')`, include
  `pg_typeof(column)::text` when the column type matters, and only use
  `column AT TIME ZONE 'UTC'` when the query is intentionally converting a
  UTC-naive value into a PostgreSQL `timestamptz`.
- The private `cobuildwithus/murph-cloud` repository owns the hosted Temporal
  worker's Render Blueprint, deployment workflow, production configuration, and
  integration check. This public repository retains the released contracts,
  hosted-local harness, and architecture guardrails only; it must not contain
  the worker implementation or define or trigger the production Render
  deployment. Rollback uses previously deployed private worker and Cloudflare
  versions. Murph Cloud verifies the private worker against the public
  hosted-local Temporal scenario before a protected `main` deployment.
- Repo-level checks execute canonical write/read paths in `core`, `importers`, `inboxd`, `parsers`, and `query`, build the shared `hosted-execution` and `runtime-state` packages, and build the CLI package through the same TypeScript workspace toolchain used for local development.
- Existing supplement-label databases receive the payload constraint as `NOT VALID`, which enforces new writes without blocking the retained pre-repair corpus. The exact guarded July 2026 repair validates it after correcting the known legacy rows; fresh tables create it as valid. `apps/web/README.md` owns the restore sequence and importer rollback floor.
- Shared `hosted-execution` helpers own the hosted control-plane auth/env/route/client seam plus phone-call start contracts between `apps/web` and `apps/cloudflare`, while `runtime-state` owns `.runtime` taxonomy/path resolution plus JSON/SQLite versioning defaults for query search, inboxd, device-syncd, and the CLI inbox/device layers.
- Generated-delivery ref changes cross `runtime-state`, `operator-config`, `hosted-execution`, `assistant-engine`, `assistant-runtime`, and CLI packaging. Focused verification must cover the shared exact-flat-ref predicate and portability descriptor, both persisted codecs, initial and retry reads with assistant-runtime permission adoption and identity revalidation, same-target post-approval cross-turn replacement rejection with pre-decision distinct-request and exact-ref retry preservation, fail-closed quiescent cleanup across every active outbox state, encrypted checkpoint inclusion, and portable-package exclusion with generic `exports/**` retention. Producer activation additionally requires reader-compatible protected-main deployment gates and exact runner-fingerprint convergence before the writer release, followed by a hosted approval/checkpoint/destroy/restore delivery scenario and the ordinary protected-main deploy gates.
- Query-owned strict reads and lexical search now share `.runtime/projections/query.sqlite`; inbox-owned local runtime is split between `.runtime/projections/inboxd.sqlite` and `.runtime/operations/inbox/*.json`.
- Device sync state lives only at `.runtime/operations/device-sync/state.sqlite`; Murph's CLI-managed daemon launcher state, logs, and a separate `0600` local control-token file live under `.runtime/operations/device-sync/`, with the bearer kept out of ordinary `launcher.json`; provider OAuth sessions and encrypted tokens remain outside the canonical vault.
- `vault-cli assistant ask|chat|deliver|status|doctor|run|stop|session` persist or inspect assistant runtime state under `vault/.runtime/operations/assistant/**`, including explicit conversation bindings, timestamps/turn counts, provider session references, local transcript files, inbox-routing and channel auto-reply cursors, enabled auto-reply channels, coarse turn receipts, replay-safe outbound intents, diagnostics events plus snapshots, and persisted assistant status snapshots. Hosted provider usage is not assistant runtime state; hosted runs record it directly into the web-owned usage ledger through the injected runtime platform. Durable user-facing memory now lives canonically in `bank/memory.md`, and durable scheduled assistant prompts live canonically in `bank/automations/*.md` through the top-level `memory` and `automation` command surfaces. If a datum is user-facing, queryable, or something future product features will build on, it must not start in assistant runtime first; it needs a canonical vault home or an explicit derived materialization from the start. Assistant runtime receipt/outbox/diagnostics/status mutations stay serialized under one shared assistant-runtime write lock. Scheduled newsletter parent intents may additionally carry the generated HTML and an address-free authorization proof; recipient addresses never enter this state, and the existing outbox child states remain the retry/terminal evidence. Provider-native transcript history plus channel-native send history may still stay external when adapters support them. Current outbound channel support covers Telegram, Linq, and AgentMail-backed email. Email setup can still reuse a discovered or explicit existing inbox when the API key cannot create new inboxes.
- Codex App Server assistant turns now default to `danger-full-access` plus `never` approvals. Murph still owns the shared prompt, transcript, tool/runtime planning, and session continuity, but Codex is treated as a privileged local adapter rather than a sandboxed authority boundary.
- When the built CLI artifact is present, canonical `memory` and runtime-safe assistant operations are exposed to Codex through the bounded local tool surface rooted at the active vault/session context; CLI fallback remains available for direct operator use, and the live provider path should use that tool surface rather than a separate localhost bridge.
- `vault-cli` and `murph` load local `.env.local` first and then `.env` from the launch cwd before command dispatch, while preserving already-exported shell variables as higher precedence. This keeps repo-local operator credentials out of the canonical vault without requiring manual `export` commands each shell session.
- `vault-cli assistant run` uses the saved Codex assistant backend and no longer accepts per-run model/provider endpoint flags. It performs configured channel auto-reply such as Telegram, Linq, or AgentMail email, dedicated self-chat flows can opt into self-authored captures plus age-based session rollover, and due canonical automations are processed while that loop stays active for the selected vault. Email auto-reply remains limited to direct threads and reuses the inbound AgentMail inbox id as the reply identity; Linq auto-reply remains limited to direct chats and reuses the inbound Linq chat id thread binding for replies.
- `vault-cli assistant status` and `vault-cli assistant doctor`, plus the root `vault-cli status` and `vault-cli doctor` shorthands, are read-only local diagnostics over assistant session files, transcripts, receipts, runtime automation state, outbox intents, diagnostics snapshots, and persisted status snapshots; they must tolerate missing or partially corrupted assistant runtime files without mutating vault data.
- `vault-cli assistant stop`, plus the root `vault-cli stop` shorthand, is the supported operator recovery path when `assistant run` / `murph run` is already active for the same vault. It targets the recorded run-lock PID with `SIGTERM`, escalates only if needed, and clears stale run-lock state when the recorded process is already gone.
- Onboarding attempts to provision an AgentMail inbox when `AGENTMAIL_API_KEY` is available through the shell or the CLI-loaded local `.env.local` / `.env` files, automatically reuses the single discovered inbox when create permission is forbidden but discovery succeeds, stores only the AgentMail inbox id plus email address in local inbox config, and uses mocked AgentMail HTTP interactions in repo automation rather than live sends.
- `vault-cli device ...` targets the local device control plane, defaults to `DEVICE_SYNC_BASE_URL` or `http://localhost:8788`, authenticates with `DEVICE_SYNC_CONTROL_TOKEN`, rejects non-loopback base URLs whenever that bearer path is used, and can now start or reuse a Murph-managed local daemon for the selected vault when no explicit control-plane target is provided. `vault-cli device daemon start|status|stop` is the explicit lifecycle surface for that managed process, and managed bearer reuse comes from the separate local secret file rather than persisted launcher JSON.
- `vault-cli assistant chat` uses an Ink-based stderr UI and expects `react` and `ink` to be installed in the CLI workspace.
- The built `vault-cli` binary can be exercised locally with `node packages/cli/dist/bin.js ...` when a change requires an end-to-end runtime check beyond the standard repo scripts. Installed `murph` / `vault-cli` shims are intentionally thin repo-root resolvers that `exec` the built entrypoint without wrapper-owned auto-build or stdio/signal mediation, but direct built-entry execution is still the clearest debugging path for stdin-sensitive behavior such as `--input -` because installed shims can lag until setup refreshes them.
- A dedicated onboarding entrypoint exists at `node packages/cli/dist/bin.js onboard ...`; it is routed from `packages/cli/src/bin.ts` instead of the main `vault-cli` manifest so installer-style host provisioning can happen without reshaping the data-plane command graph.
- The built CLI package shape exposes a `murph` bin alias that targets the same built entrypoint as `vault-cli`; `murph`, `murph --help`, and `murph onboard ...` route to the onboarding surface, while other commands continue through the main operator surface. Interactive TTY onboarding now opens a compact assistant/channel/wearable stepper with inline readiness badges for Telegram, Linq, AgentMail email, Oura, and WHOOP, restores canonical wearable selections from `bank/preferences.json`, can prompt for missing runtime credentials for the current onboarding run without persisting them, can discover and reuse an existing AgentMail inbox or prompt for an explicit inbox id before provisioning when the API key is scoped, persists the selected wearable providers back into that canonical preferences singleton, opens any selected wearable connect flow that is ready before handoff, defers scheduled-update preset installation until the operator later binds an explicit outbound destination, and then routes to `assistant run` when a configured auto-reply channel remains enabled. The repo's release flow now publishes only `@murphai/murph`, `@murphai/openclaw-plugin`, `@murphai/contracts`, `@murphai/hosted-execution`, and `@murphai/gateway-core` under one shared version and one git tag. Workspace-private runtime and owner packages such as `@murphai/assistant-engine`, `@murphai/operator-config`, `@murphai/runtime-state`, `@murphai/assistantd`, and `@murphai/device-syncd` remain installable from a checkout and are bundled into the relevant public tarballs when needed. The tag-driven GitHub Actions publish job relies on npm trusted publishing for that smaller package set, and npm trust is package-level rather than repo-level, so live npm publication depends on each public `@murphai/*` package being bound to `cobuildwithus/murph` and `.github/workflows/release.yml`. The repo ships `pnpm release:trust:github` to bootstrap those package-level bindings from an npm-authenticated maintainer shell; if a package is already bound incorrectly in npm, maintainers must revoke that package's existing trust entry before rerunning the bootstrap helper.
- Repo-local host bootstrap is handled by `scripts/setup-host.sh`, which delegates to the existing Homebrew-based `scripts/setup-macos.sh` path on macOS and can reuse or download Node 24.14.1+ locally on Linux before activating `pnpm` through corepack, installing workspace dependencies, building the workspace, and delegating to the built setup entrypoint. `scripts/setup-macos.sh` still hard-fails off macOS, `scripts/setup-linux.sh` hard-fails off non-Linux hosts, and `--dry-run` remains a wrapper-only planning mode for those shell entrypoints.
- GitHub Actions host-support CI now runs `.github/workflows/host-support.yml`, which exercises the focused CLI setup/inbox host-support suite on both `ubuntu-latest` and `macos-latest`. Its Ubuntu release gate preserves the `pnpm release:check` surface but splits it into parallel jobs for release metadata, clean workspace build, typecheck, artifact hygiene, doc gardening, package coverage shards, app verification, and fixture coverage, with a final `Release checks (ubuntu)` aggregator so required-check naming stays stable. The Ubuntu app-verification shard alone provisions loopback PostgreSQL 17 and injects the dedicated supplement-search test database variable; this runs the transactional 100+ case search corpus in PR and `main` CI without changing the unreachable hosted-web build database placeholder used by the rest of the app verification.
- Repo-local source-resolved workspace aliases are intentionally limited to the package allowlists exported from `config/workspace-source-resolution.ts`; within those allowlists, Vitest subpaths resolve only through explicit workspace entries plus package-declared public exports rather than wildcarding arbitrary internals. Packages outside that helper stay on their existing emitted-JS-shaped import conventions until a caller explicitly opts them into source resolution.
- `packages/device-syncd` exposes the local HTTP control plane for wearable OAuth/webhook/reconcile flows, binds `127.0.0.1` by default unless `DEVICE_SYNC_HOST` overrides it, rejects non-loopback control-route callers, requires a bearer token for `/providers/*`, `/accounts/*`, and other control routes, can expose only `/oauth/*/callback` plus `/webhooks/*` on a separate `DEVICE_SYNC_PUBLIC_HOST`/`PORT` listener when public ingress is needed, stores tokens outside the vault, serializes active jobs per account to avoid refresh-token races, and only allows cross-origin post-connect redirects when `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS` includes the requesting origin. Murph's CLI-managed launcher may provide the default control token, state DB path, and loopback base URL for the selected vault, but it still talks to the daemon strictly over that localhost HTTP boundary.
- The hosted integration control-plane entrypoint lives under `apps/web`; Prisma CLI configuration now lives in `apps/web/prisma.config.ts` for Prisma 7, the hosted production Next build uses the supported Webpack fallback with its explicit build worker and memory optimizations while interactive development remains on Turbopack, interactive hosted `next dev` uses `apps/web/.next-dev`, cold-boot smoke uses `apps/web/.next-smoke`, hosted-web modules that import the shared Prisma client now require `DATABASE_URL` at module load so missing DB env fails fast, package and app typecheck bootstrap the exact tracked Next route-type stub import before `tsc` so clean clones do not depend on leftover generated files, browser-authenticated device-sync routes trust only short-lived request-bound signed assertions from a trusted auth edge/proxy and consume each assertion nonce once to reject replay, hosted onboarding uses Privy as fresh proof for login, linking, and security-sensitive identity operations while successful completion mints a first-party opaque app session stored by hashed token in `HostedWebSession`; settings, account, billing, export, and deletion use that Murph app session, and identity sync routes require both the app session and fresh same-member Privy proof. Hosted onboarding stores only invite/member/billing metadata plus embedded-wallet linkage rather than canonical health data, hosted onboarding Checkout uses subscription mode while authenticated direct paid Pulse/Edge members may separately create fixed one-time usage-credit Checkout Sessions in Settings, hosted Stripe webhook ingress records minimal event receipts before authoritative subscription or usage-credit reconciliation, imports successful hosted assistant usage rows into `hosted_ai_usage` after the hosted commit succeeds so Postgres remains the canonical usage and append-only credit-ledger owner with no active Stripe meter cron, and blocks subsequent usage-bearing work when included plus purchased capacity is exhausted, hosted onboarding Linq ingress stores chat and recipient-line routing in `HostedMemberRouting`, records quota counters in `HostedLinqDailyState`, and appends canonical `conversation.message` ingress instead of using legacy `/api/linq` binding/event queues, and every Cloudflare-bound hosted execution mutation now appends canonical external ingress in the same transaction as the originating onboarding and device-sync state change so ordering, dedupe, mailbox sequencing, and checkpoint fencing stay web-owned instead of flowing through `execution_outbox`. Repo-local Next/Vitest resolution for workspace packages is centralized in `config/workspace-source-resolution.ts` and intentionally limited to the helper's explicit package lists plus package-declared public export entries.
- The hosted execution runner entrypoint lives under `apps/cloudflare`; it verifies callback-signed Temporal ensure-processing requests plus Vercel OIDC-authenticated browser-vault, deletion, and status control requests, coordinates per-user invocations through Durable Objects, stores encrypted hosted workspace checkpoint refs in object storage through direct R2 presigned PUT upload sessions, stores legacy encrypted artifact objects only for restore compatibility, stores per-user runner env overrides in a separate encrypted hosted object, restores a temporary local execution context for hosted workspace invocations, starts the native Cloudflare container attached to the per-user Durable Object, authenticates worker-side control routes with HMAC signatures instead of static worker control tokens, routes worker-side ensure-processing/status/browser-vault calls into direct Durable Object methods, keeps the runner container warm for its configured idle lifecycle after successful invocations while still destroying it on failed, stale, deploy-smoke, explicit-cleanup, or ambiguous cleanup paths, restores v2 direct-R2 snapshots plus legacy full/base workspace bundles and legacy working `{base, delta}` commits, imports mailbox items into the local runtime, keeps dirty foreground runtime state local until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint writes the updated workspace through web-owned CAS, treats RunnerContainer activity expiry as cleanup-only, drains the local outbox after checkpoint, records hosted assistant usage directly to the web-owned usage ledger through the injected runtime platform, decrypts stored snapshot/bundle/artifact/journal objects by their envelope `keyId` through the configured keyring so older ciphertext can remain readable during staged rotation, builds direct runtime config from an explicit frozen supervisor env while keeping supervisor-only secrets out of runtime env, and launches each hosted job in-process with per-user warm workspace roots and invocation-local writable cache/temp roots. Runtime internal-host requests use normal virtual hosts such as `results.worker` and `web-control.worker`; Cloudflare Container outbound interception dispatches those requests to Worker handlers and runtime write-fence headers prove invocation authority. Durable Object alarms are write-fence alarm cleanup only; Temporal reads hosted web reconciliation facts and owns runtime-returned `nextWakeAt` sleeps instead of Cloudflare rereading hosted web workspace status to decide whether runtime work is due. The Durable Object now keeps execution coordination, direct-R2 upload sessions, and opaque runtime residue only; canonical mailbox ordering, mailbox import watermarks, and workspace checkpoint fences remain web-owned.
- R2 write-admission changes require focused proof that `paused` returns a valid
  Temporal `retry_later` response before UserRunner dispatch, suppresses the
  direct OIDC `waitUntil` hint, and is visible in current Worker status. Also
  validate hosted-execution parsing, deploy rendering/preflight, and
  hosted-local defaults. Local proof cannot replace the runbook's live
  100-percent rollout, per-runner `inFlight=false`, and capability-drain checks.
- The hosted Temporal worker entrypoint, Workflows, Activities, production
  bundle, replay gates, and Render deployment live in private
  `cobuildwithus/murph-cloud`. Public root scripts retain
  `temporal:cli:setup`, `temporal:cli:check`, and `temporal:dev`; hosted-local
  starts the private package only when
  `MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR` is explicit, otherwise enabled
  Temporal fails before child startup and points to that variable or
  `MURPH_DEV_TEMPORAL=disabled`. The private integration workflow runs the
  public hosted-local E2E profiles with the external worker, and the
  non-manual `temporal-orchestration` scenario
  proves web signal, worker query handling, and Cloudflare ensure-processing;
  `linq-same-wake-batching` deterministically proves that one Temporal wake
  batches the already-arrived rapid Linq messages into one assistant turn.
  Murph Cloud's package build pre-bundles Workflow code into
  `dist/workflow-bundle.js`; local/dev workers use `workflowsPath`, while the
  Render production path uses `workflowBundle` through the package-local built
  start script instead of `tsx`. Production shutdown grace is explicitly capped
  below Render's 300 second shutdown-delay ceiling so the worker stops polling
  and lets in-flight Activities drain before force shutdown. The package build
  also fails closed when the Workflow bundle exceeds 2.25 MiB, loses inspectable
  inline source-map evidence, or pulls broad contracts/vault-share source
  closures into the Workflow graph. Production pins a 100-Workflow cache with
  reusable V8 contexts, and the private Render Blueprint pins two worker
  instances to the 2 GB Standard plan.
- `apps/cloudflare/wrangler.jsonc` remains the checked-in worker scaffold, but the generated deploy config from `apps/cloudflare/scripts/**` is authoritative for environment-specific bindings and required Worker secrets. The generated Worker secret list currently requires `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`, `HOSTED_LOG_FINGERPRINT_SECRET`, `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`, `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`, `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`, `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`, and `OPENAI_API_KEY`; optional provider secrets include `ELEVENLABS_API_KEY` for generated voice memos. The checked-in scaffold keeps only a tight local placeholder list. The deploy vars require the direct-R2 presign account and bucket names, with an optional account-scoped R2 HTTPS endpoint override; hosted-local dev, worker-only, and E2E profiles use a Docker MinIO sidecar plus local-only presign endpoint flags instead of relying on `wrangler dev` to emulate the R2 S3 API. The repo also ships the checked-in `apps/cloudflare/r2-bundles-lifecycle.json` transient-cleanup config plus `pnpm --dir apps/cloudflare r2:lifecycle:apply`, while private `cobuildwithus/murph-cloud` owns its protected GitHub Actions workflow for environment-driven config rendering, cached native runner base preparation, direct `wrangler deploy` execution, explicit `instance_type` pinning, and smoke checks that poll operator status until the Durable Object runner reaches idle and status exposes the latest workspace checkpoint ref. The deploy flow requires `CF_PUBLIC_BASE_URL` for normal deploy-and-smoke workflow runs, expects operators to apply the checked-in transient R2 lifecycle rules to the real bundles buckets as part of deploy setup, treats `CF_PLATFORM_ENVELOPE_KEY_ID` as single-key metadata for the active platform envelope key, and uses `wrangler deploy` as the direct-cut default deploy path. The deploy helper validates generated config, secrets, and runner bundle artifacts, runs direct Wrangler deploy, then reads `wrangler deployments status --json` for the smoke version and final traffic summary. That deploy flow prepares `apps/cloudflare/.deploy/runner-bundle/` ahead of time as a runtime leaf artifact and prepares a stable local base image from `Dockerfile.cloudflare-hosted-runner-base`; hosted-local E2E lanes may reuse the matching GHCR fingerprinted base image, but production-capable deploy paths force a local base build from the protected checkout before Wrangler's final image build copies the prepared bundle. The bounded direct hosted workspace invocation core still lives in `packages/assistant-runtime`. Protected-main Cloudflare deploy workflow jobs run on Blacksmith: normal predeploy E2E gates, runner smoke, the hosted Codex auth guard, and the production deploy job. The private workflow's immediate path skips the slower E2E and runner smoke gates, while the production deploy job still builds the runner bundle and native base image directly from its verified protected-main checkout before rendering secrets, dry-running/deploying through Wrangler, and smoking deployed endpoints.
- The same protected-main deploy workflow also exposes one reusable `preview`
  target through the existing GitHub `Preview` Environment. It keeps the
  generated deploy path as the single owner, derives the Vercel OIDC
  environment from the selected target, and skips paid live-model deploy smoke.
  Preview preflight runs before provider mutation and requires matching
  preview crypto/OIDC context, visibly staging-scoped Worker and R2 names, a
  distinct staging Web origin, public HTTPS/DNS, and a declared production
  origin used only as an inequality guard. An isolated Vercel preview
  database/crypto/control-plane boundary is a prerequisite; production Web or
  production stateful secrets are never a preview bootstrap fallback.
- `Dockerfile.cloudflare-hosted-runner-base` is the checked-in scaffold for the stable native Cloudflare container base image. It installs the common Linux parser dependencies, creates the non-login runner user, and sets the default parser/runtime environment; hosted transcription has no in-image model and routes through the Worker-owned Workers AI binding. `Dockerfile.cloudflare-hosted-runner` is the small app-layer scaffold that starts from that base image, patches the native bundled Codex model catalog so `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` support the OpenAI flex service tier, validates those entries, and copies the prebuilt `apps/cloudflare/.deploy/runner-bundle/` artifact into `/app`; the production deploy smoke uses the same catalog for one real `gpt-5.6-terra` turn. The image starts the private `apps/cloudflare/src/container-entrypoint.ts` bridge inside the container, serves `GET /health` plus `POST /internal/workspace-invocation` on that internal bridge only, and delegates bounded hosted workspace invocation directly to `packages/assistant-runtime`. The default execution path runs one hosted job at a time in-process, builds runtime config from explicit supervisor env plus worker-supplied runtime fields, and uses per-user warm workspace roots plus invocation-local writable cache/temp roots. The present expectation is Node `>=24.14.1`, the preassembled runner bundle plus its materialized production dependencies, writable temp storage for restore/snapshot work, `PORT`, optional `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS`, and shared worker/container allowlist extension vars for encrypted per-user env overrides when additional key names must be permitted.
- The local assistant daemon entrypoint lives under `packages/assistantd`; `murph-assistantd` binds to one vault, rejects non-loopback hosts, requires a bearer token on every route, sets `MURPH_ASSISTANTD_DISABLE_CLIENT=1` in its own process so daemon-local calls do not recurse back through HTTP, and now fronts the steady-state assistant session/message/options flows plus session/status/outbox/cron inspection and serializable automation control whenever the CLI invocation does not need local-only hooks such as live provider events, foreground inbox events, abort propagation, or local session/transcript snapshots.
- The current runner scaffold now ships as a preassembled deploy bundle copied into the native image rather than rebuilding the workspace from repo source inside Docker. `apps/cloudflare/DEPLOY.md` is the durable guide for the current staged manual deploy path.
- Before adding a runtime target, document entrypoints, environment assumptions, and operational guardrails here.
