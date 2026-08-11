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

## Workflow authority

The repository-wide `GITHUB_TOKEN` remains read-only and is not allowed to
create pull requests. The workflow instead mints a short-lived installation
token for a dedicated GitHub App installed only on this repository. The App has
only Contents, Issues, and Pull requests read/write permissions; it has no rule
bypass, organization, or administration authority. The workflow contains no
approval or merge operation, so review and merge remain human-owned. Its token
is explicitly narrowed to those three repository permissions for each run and
is revoked when the job ends.

Repository administrators provide `FROG_APP_CLIENT_ID` and
`FROG_APP_BOT_LOGIN` as Actions variables and `FROG_APP_PRIVATE_KEY` as a
secret in the `frog-reconciliation` environment. That environment is limited
to the `main` branch, and the workflow opts out of deployment records because
this is credential access rather than a deployment. `FROG_APP_BOT_LOGIN` is
the App's exact bot login, including the `[bot]` suffix. Never commit or print
the private key. Missing credentials fail the workflow closed; Frog does not
fall back to `GITHUB_TOKEN`.
