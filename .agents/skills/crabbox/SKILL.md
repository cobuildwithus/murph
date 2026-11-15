---
name: crabbox
description: Run Murph's heavy completion checks (`pnpm test:diff`, `pnpm verify:acceptance`) on the dedicated static macOS SSH worker instead of this machine. Use for a finite, CPU-heavy check; edits, review, commits and anything that needs local environment state stay local.
license: Apache-2.0
---

# Murph Crabbox verification

Run the normal commands. They are local by default, and setting the executor
sends the same command to the worker:

```bash
pnpm test:diff <changed-path ...>
pnpm verify:acceptance

MURPH_VERIFY_EXECUTOR=ssh \
MURPH_VERIFY_SSH_HOST=verification-worker.local \
MURPH_VERIFY_SSH_USER=verification-worker \
MURPH_VERIFY_SSH_PORT=22 \
pnpm verify:acceptance
```

The dispatcher freezes the current Git candidate, runs it on the worker and
cleans up after itself. To use it:

- It refuses a checkout with untracked, intent-to-add or unmerged files, or
  with additions changed after staging. Stage new source files fully so they
  are part of the candidate. Never stage private data to get past the refusal.
- No secrets go to the worker. Leave out `--allow-env`, `--env-from-profile`,
  env globs, `.env` files and every token; routing is the three
  `MURPH_VERIFY_SSH_*` values plus the local SSH key configuration. A check
  that needs Vercel development state stays local: set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1`.
- The worker runs one job at a time. A busy worker fails at once, without
  waiting or falling back to local; rerun later or run locally.
- The root verifier decides scheduling and worker counts, so don't swap in
  ad-hoc `crabbox run` commands or worker overrides.
- Use one remote run per head: remote acceptance when acceptance is required,
  otherwise remote `test:diff`. Retry an unchanged head only after an
  infrastructure failure, and say why.

In evidence, record the command, result, timing and the `profile=static-ssh`
resources line. Leave out the host, account and local paths.

`agent-docs/operations/verification-and-runtime.md` § Dedicated static macOS
worker owns setup and recovery.
