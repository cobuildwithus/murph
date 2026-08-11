# Remove Cloudflare Container SSH

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Remove Murph's Wrangler SSH access path from every Cloudflare Container and
  make future deploy rendering fail closed with SSH explicitly disabled.

## Success criteria

- Checked-in and generated container configs set `ssh.enabled` to `false` for
  both runner classes and contain no authorized keys.
- Deploy automation no longer accepts, validates, exports, or documents
  container SSH key inputs, while retaining independent PID-namespace
  isolation.
- Focused tests prove environment inputs cannot re-enable SSH and every
  rendered container remains disabled.
- The private deploy workflow stops forwarding the retired inputs so public and
  private deploy contracts remain aligned.
- Exact-head CI, preliminary coverage review, final ReviewGPT, and parent final
  review have no unresolved accepted findings.

## Scope

- In scope: Cloudflare deploy environment parsing, Wrangler config rendering,
  checked-in config, deploy docs, focused tests, and private workflow
  pass-through cleanup.
- Out of scope: rewriting Git history, exporting or rotating private keys,
  deploying before review, or changing unrelated container lifecycle behavior.

## Constraints

- Remove the capability instead of retaining a dormant operator switch.
- Preserve the existing runner and deploy-smoke topology.
- Do not print, persist, or publish private key material or environment values.
- Keep unrelated changes in the primary checkout and sibling worktrees intact.

## Tasks

1. Map every public and private SSH capability owner and confirm Cloudflare's
   current default-enabled behavior.
2. Delete the key/input path and render explicit SSH disablement for each
   container, with focused regression coverage and durable-doc cleanup.
3. Remove the private workflow pass-through and verify both diffs.
4. Run focused tests, typecheck, config rendering/direct proof, and final diff
   privacy inspection.
5. Commit, push, open the PRs, run preliminary and final ReviewGPT with CI,
   resolve accepted findings, and complete parent final review.

## Verification

- Focused Cloudflare deploy-automation tests.
- Cloudflare app typecheck.
- Generated-config assertion that every container has `ssh.enabled: false`, no
  `authorized_keys`, and no SSH-only compatibility flag.
- Exact-head GitHub Actions plus preliminary ReviewGPT coverage lens and final
  ReviewGPT security/deploy gate.
