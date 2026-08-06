# Restore the hosted runner deploy gate

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Restore protected Cloudflare runner deployment after reviewed runtime growth
  exceeded the ratcheted total bundle-byte ceiling.

## Success criteria

- Two clean packaged assemblies establish the current cross-platform bundle
  measurement.
- The total ceiling uses the higher measured value plus the existing 32 KiB
  reviewed-addition allowance.
- Entry-chunk, static-closure, and forbidden-input guards remain unchanged.
- Focused tests, exact packaged assembly, required PR review, and exact-head CI
  pass before merge.
- The PR contract records that the prerequisite runner must deploy with an
  immediate rollout and prove its fingerprint before the stacked Web
  support-email formatter merges.

## Scope

- In scope: the runner entrypoint total byte baseline, its policy comment, the
  matching locked test expectation, verification, PR gates, and deployment.
- Out of scope: changing bundle contents, loosening entry/static guards,
  dependency changes, runtime behavior, or the stacked Web formatter.

## Constraints

- Preserve the exact measured-plus-32-KiB policy and existing source of truth.
- Keep this unblocker independent from the stacked support-email PR so deploy
  ordering remains fail closed.
- Preserve unrelated work in all other checkouts.

## Risks and mitigations

1. An arbitrary ceiling increase could hide boot-graph creep. Derive the
   baseline from repeatable packaged assembly and retain only the established
   allowance.
2. Platform variance could make one local measurement insufficient. Retain the
   higher clean measurement and require Linux exact-head CI plus protected
   predeploy assembly.
3. Merging the Web formatter before runner convergence could violate the
   documented release order. Do not merge it until managed-container smoke
   reports the new runner fingerprint.

## Tasks

1. Measure the exact current-main packaged bundle twice and inspect its largest
   boot inputs.
2. Update only the total baseline comment/constant and matching unit test.
3. Run focused tests and packaged assembly, then complete the PR review and CI
   gates.
4. Prepare the exact candidate for the required PR review and CI gates, with
   the immediate-rollout and fingerprint proof recorded as the merge follow-up.

## Decisions

- Use 10,273,373 bytes as the total baseline. Two consecutive clean macOS
  packaged assemblies produced that exact value; protected Linux predeploy
  assembly produced 10,222,070 bytes from the same source snapshot.
- Preserve the existing 32 KiB allowance and leave the entry-chunk,
  static-closure, and forbidden-input guards unchanged.

## Verification

- Focused runner entrypoint bundle policy test: 34 tests passed.
- Cloudflare package typecheck: passed.
- Docs drift: passed.
- Full packaged runner assembly: passed at 10,273,373 bytes under the new
  10,306,141-byte ceiling.
Completed: 2026-08-05
