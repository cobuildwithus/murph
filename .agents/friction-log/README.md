# Friction log

This directory contains unresolved developer friction encountered while working
in this repository. Frog publishes each pending entry as a GitHub issue and
keeps the active repository copy until that issue is resolved.

## Use

```sh
scripts/frog list
scripts/frog log
```

Run `list` before working around a papercut. Humans may use interactive `log`;
repository agents use `.agents/skills/frog/SKILL.md` for the noninteractive
entry format. The wrapper forces the repository file store and permits no local
publishing. It enters the repository root itself and rejects caller-supplied
`--cwd` and `--mcp` modes; the GitHub workflow is the sole issue and
reconciliation owner. Both paths use the exact Frog `1.1.0` dependency from
Murph's reviewed manifest and committed lockfile.

## Public-data boundary

Everything committed here and every issue Frog files is public repository
content. Use minimal synthetic reproduction steps. Never include user or
provider data, conversation or model transcripts, health information, member
identifiers, credentials, raw logs or command output, local usernames,
home-directory paths, or other private evidence.

Resolution is workflow cleanup, not data deletion. The public issue and Git
history remain, and Action-only reconciliation may retain an issue/path recovery
binding in `.agents/friction-log/.sync.json` so a reopened issue can restore its
entry. That journal does not store the report body in the pinned Frog version.

Murph's product-feedback, support-escalation, and runtime-issue pipelines remain
canonical for those signals. Frog is not for machine-specific, global, or
internal-model friction, and this repository does not accept inbound or
cross-repository Frog reports.

## Lifecycle

A friction-log change on `main` publishes pending entries. Frog-authored issue
closures and reopenings reconcile immediately, and a daily recovery sweep runs
at 00:17 UTC. Cleanup is written only to the reviewable `frog/sync` pull request,
never directly to `main`.
