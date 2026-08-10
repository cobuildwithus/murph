# Local Storage Lifecycle

Last verified: 2026-07-19

## Purpose

Keep rebuildable local test and checkout residue bounded without putting
research data, active work, or arbitrary files under an automatic deletion
rule.

## Proven leak sources

The July 2026 storage incident had four distinct sources:

1. Package tests created thousands of top-level `mkdtemp()` vaults beneath the
   host temp directory. Large core, importer, and query suites commonly created
   one or more vaults per case, and many files had no suite-level teardown.
2. Agent and review workflows created full Murph checkouts directly beneath
   `/private/tmp`. Those standalone clones were invisible to Git's registered
   worktree list and therefore invisible to `scripts/retire-worktree`.
3. A few temporary checkouts installed dependencies into standalone pnpm stores
   instead of reusing the ordinary machine store.
4. iOS experiments retained rebuildable DerivedData, Swift `.build`, result
   bundles, and device-build output after their branches and PRs were inactive.

APFS clone accounting can make the apparent total from `du` larger than the
physical space that deletion returns. File-count growth and deletion cost are
real even when apparent bytes are shared.

## Vitest temp ownership

All normal package, app, and repo-tool Vitest configurations route through
`config/vitest-temp-global-setup.ts`. Murph owns a dedicated directory beneath
the host temp root, so startup never scans unrelated application residue.

- One Vitest process owns one private `r-*` run root beneath the dedicated
  `mv` owner directory. The short names leave room for macOS Unix-domain socket
  paths created by nested test tools.
- The setup writes `.murph-vitest-temp-v1.json` with the schema, owner PID, and
  creation time, then points `TMPDIR`, `TMP`, and `TEMP` at that root before
  workers start.
- Tests may continue using ordinary `os.tmpdir()` and `mkdtemp()`. Their output
  is contained beneath the run root instead of becoming thousands of unrelated
  top-level directories.
- Global teardown recursively removes the exact owned run root after passing or
  failing tests.
- A hard-killed runner can skip teardown. The next test run performs a bounded
  stale sweep, and operators can invoke the same owner manually:

```sh
pnpm exec tsx scripts/cleanup-test-temp.ts
pnpm exec tsx scripts/cleanup-test-temp.ts --apply
```

The command is dry-run by default. Apply considers only marked roots older than
24 hours whose recorded owner is gone and which no current-user process uses as
its working directory. Invalid markers, unmarked directories, live owners,
young runs, process-CWD matches, and unsupported process inspection all stay in
place. `--older-than-hours <hours>` may raise or lower the age gate for an
explicit operator run; it never weakens marker, owner, or CWD proof.

Do not add individual test cleanup merely to duplicate this process owner.
Keep test-local teardown when the test must prove cleanup behavior, release a
resource before later cases, or restore process-global state.

Private or ignored data/research test configurations are not part of the
tracked workspace-config inventory, but they must still import
`murphVitestTempGlobalSetup` from `config/vitest-temp-lifecycle.ts`. That owner
contains only test scratch. Persistent downloads, cohort inputs, parsed
research datasets, and other intentional data must use an explicit
data/research root and must not be placed under `os.tmpdir()`.

## Checkout ownership

Never create a Murph task clone or worktree directly under a temp directory.
Use `scripts/create-worktree`; use `--data-research <reason>` only for genuinely
large data or research work. Registered worktrees remain visible to the normal
open-PR, plan, cleanliness, process-CWD, and retirement gates.

`scripts/worktree-storage-guard` scans only conventional direct-child
`murph-*` Git checkouts in the system `/tmp` roots by default and matches the
current repository by normalized origin. Tests and specialized hosts can set
`MURPH_WORKTREE_TEMP_ROOTS` to a colon-delimited root list. The hook does not
scan the macOS per-user temp root because enumerating unrelated application
residue there made every commit unbounded. Its machine-local state stores
hashed checkout identities, not paths; filesystem identity makes a replacement
clone at the same path a new checkout. On rollout it accepts the already-
present legacy set, then rewrites the set downward as those checkouts retire.
Any new unmanaged identity fails the guard even if another legacy clone
disappeared at the same time. Registered worktrees, including locked
`data/research:` worktrees, do not count as unmanaged.

Registered-worktree authorization is checkout-scoped at commit time. The
branch-independent hook supplies the committing checkout, so a raw worktree
fails its own commit without blocking an authorized sibling. Sanctioned
creation may also continue while a raw sibling exists because every registered
worktree still consumes the global numeric and disk budget. During a
mixed-version rollout, the current guard adds a current isolation marker and a
legacy authorization marker to a raw worktree. The legacy marker lets an
already-authorized historical checkout keep using its branch-local installer,
committer, and creation helper; the current shared hook and primary guard honor
the isolation marker and continue rejecting the raw checkout. Running the
primary checkout's `scripts/worktree-storage-guard` without a scoped checkout
remains the explicit global audit and reports every isolated registered
worktree.

The ratchet does not delete a checkout. Preserve active/open-PR or dirty work.
Retire a clean registered checkout with `scripts/retire-worktree` after its
terminal gate is satisfied. A standalone legacy clone needs explicit operator
authorization plus immediate Git, PR, active-work, and process-CWD proof before
exact-path removal.

## Package stores

Use the ordinary machine pnpm store. Do not pass a temp directory through
`--store-dir`, `PNPM_STORE_DIR`, or equivalent task-local configuration. The
worktree guard fails when a conventional direct-child `murph-*pnpm*store*`
directory exists beneath the configured system temp roots, so it cannot become
unowned post-task residue. A checkout's normal `node_modules` remains owned by
that checkout and retires with it.

## Build outputs

Rust `target`, Xcode DerivedData, Swift `.build`, `.next`, and similar outputs
are rebuildable, but their source checkout is not. Before removing build output:

1. Resolve the exact checkout and exact child output path without a glob.
2. Prove the checkout is clean or limit deletion to ignored output only.
3. Check current PR and active-task state.
4. Check for a current-user process working inside or referring to the output.
5. Delete only the resolved output child; preserve source and branches.

Independent exact roots may be deleted with bounded parallelism. Do not recurse
over a home directory, workspace root, temp root, unresolved variable, or broad
name match to make deletion faster.
