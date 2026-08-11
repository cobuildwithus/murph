---
name: frog
description: Record repository-actionable developer friction with Frog. Use when tooling, documentation, APIs, tests, builds, or repository conventions force a workaround, waste time, or repeatedly confuse an agent; inspect unresolved entries before improvising around the problem.
---

# Frog

Capture developer friction while the evidence is fresh without mixing it with
Murph's product-feedback or runtime-issue systems.

## Authority

Use this skill only when the current request authorizes repository edits.
Creating or updating a tracked plan file is edit-authorized repository work and
follows the normal Frog flow. During review-only, planning-only, or other work
that does not authorize repository edits, do not create an entry; mention the
friction in the handoff instead. Logging must not delay or replace the requested
outcome.

## Before a workaround

Run:

```sh
scripts/frog list
```

Use an existing entry or linked issue when it already covers the problem. Do
not create a title variant for the same friction.

## Log new friction

When the friction is new, reproducible, and actionable in this repository, pipe
a specific title, a blank line, and a completed body into Frog:

```sh
cat <<'FROG' | scripts/frog log
Specific searchable title

## Expected Behavior

Describe what should happen.

## Current Behavior

Describe what happens instead.

## Possible Solution

Optional.

## Minimal Reproducible Example

Use synthetic steps or code.

## Context

Describe the impact and task.
FROG
```

Replace the example text with the actual public-safe report. Keep possible
solutions optional; record the problem even when the correct fix is not yet
known. Do not create an empty or synthetic "no friction" entry when nothing
qualifies.

## Commit the entry

A Frog entry created or modified during a task is part of that task's output.
Read back the returned `friction.md`, verify the public-data boundary below,
and include it in the same scoped task commit. Do not complete the task with
that entry untracked, unstaged, or omitted from the commit. If a safe scoped
commit is blocked, preserve the entry and report the exact blocker instead of
dropping it.

The wrapper permits only file-backed `list` and `log`; it rejects direct
publishing, enters the repository root itself, and rejects caller-supplied
`--cwd` and `--mcp` modes. Local and Action execution use the exact Frog
`1.1.0` dependency from Murph's reviewed manifest and committed lockfile. The
Action-only workflow is the sole issue and reconciliation owner. It uses a
short-lived token from a dedicated GitHub App installed only on this repository;
the private key is available only through the main-branch-restricted
`frog-reconciliation` environment, and the built-in `GITHUB_TOKEN` remains
read-only. The App can write repository contents, issues, and pull requests,
but it has no rule-bypass or repository-administration authority, and the
workflow performs no approval or merge operation. Reconciliation remains
reviewable and human-merged through the `frog/sync` pull request.

## Public-data boundary

Treat every entry, artifact, and Frog-filed issue as public repository content.
Use synthetic reproduction data only. Never include user or provider data,
conversation or model transcripts, health information, member identifiers,
credentials, raw logs or command output, local usernames, home-directory
paths, or other private evidence. Closing an issue is not data deletion: its
public issue, Git history, and issue/path recovery binding can remain.

Do not use Frog for product feedback, support escalation, observed production
runtime failures, machine-specific setup, global tooling complaints, or
internal-model friction. Murph's existing owners remain canonical for those
signals. Inbound and cross-repository Frog reporting are disabled.
