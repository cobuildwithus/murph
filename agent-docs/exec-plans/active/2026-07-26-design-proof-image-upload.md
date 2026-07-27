# Worktree-safe Cloudflare Images design-proof uploader

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Give every repository worktree one safe command that uploads local design-proof
  screenshots to Cloudflare Images without copying secrets into that worktree.

## Success criteria

- The command accepts one or more local PNG, JPEG, or WebP screenshots.
- Existing process environment wins; otherwise only the required Cloudflare
  Images settings are read from the invoking checkout and then the primary
  checkout discovered through Git.
- The credential is never printed, copied, persisted, placed on a command line,
  or exported to a child process.
- Each upload is public, and the command prints a verified
  `https://imagedelivery.net/.../public` URL.
- Focused tests cover env precedence and parsing, linked-worktree discovery,
  input validation, Cloudflare request shape, sanitized failures, and rendered
  URL verification.
- The live design-proof workflow documents the command.

## Scope

- In scope: a root package command, its dependency-free Node implementation,
  focused repo-tool tests, and current operator documentation.
- Out of scope: hosted runtime image delivery, credential provisioning or
  replication, screenshot capture, PR-body editing, and Cloudflare account
  configuration.

## Constraints

- Technical constraints: use Node built-ins and Cloudflare's canonical Images
  upload endpoint; do not source shell env files; keep network calls bounded;
  validate public result URLs before printing them.
- Product/process constraints: screenshot files remain ignored local artifacts
  and must contain no private member data; unavailable credentials fail closed.

## Risks and mitigations

1. Risk: Reading the shared checkout env could leak or broaden secret access.
   Mitigation: resolve the primary checkout through Git, parse only two named
   values into local memory, preserve explicit environment precedence, and
   never spawn the uploader with a copied environment.
2. Risk: A generic file uploader could exfiltrate unrelated local files.
   Mitigation: require a regular non-symlink file, enforce a design-proof-sized
   limit, validate supported image signatures, and send a neutral remote name.
3. Risk: A successful API response could return an unusable or untrusted URL.
   Mitigation: require an HTTPS `imagedelivery.net` public variant and perform a
   bounded image response check before printing it.

## Tasks

1. Add the worktree-aware uploader and root command.
2. Add focused unit and integration-style tests using temporary Git worktrees
   and a local HTTP server.
3. Update the live design-proof and test-map documentation.
4. Run canonical diff verification, preliminary specialist review, final
   ReviewGPT with CI, and complete the scoped PR.

## Decisions

- Do not copy or symlink `.env` into task worktrees; discover and read the
  primary checkout only at invocation time.
- Keep the tool local and dependency-free rather than coupling it to the hosted
  Cloudflare application.
- Use the current clean checkout on a task branch because the ratcheted
  worktree guard refused checkout 101; do not bypass that guard or retire
  unrelated worktrees.

## Verification

- Commands to run: focused Node tests, `pnpm test:diff` for every touched path,
  secret/identifier diff scan, and the repository's required PR review gates.
- Expected outcomes: all checks pass without a live Cloudflare credential in
  routine tests; an operator smoke may use the local credential without logging
  it.
