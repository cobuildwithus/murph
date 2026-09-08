# Runner rollout admission and architecture correction

## Outcome

Complete safe runner releases without deployment-induced foreground waits or an
incidental reduction in supported serving capacity. Prefer native Cloudflare
ordering and existing runtime owners over extra allocation or retry machinery.

Current constraint: keep the existing total CPU and memory budget. A second full
fleet reservation and quota escalation are not the chosen solution. Preserve
the reviewed ordering and warm-retention fixes while proving a simpler release
contract that works within the existing aggregate capacity.

## Evidence and open questions

- The preceding change separated serving and candidate image targets and proved
  the original image-fingerprint mismatch in the actual readiness owner.
- Native creation of the inactive application failed quota admission before
  promotion. Local tests and previous reviews did not cover that constraint.
- An application creation quota error does not establish whether application
  ceilings reserve additive quota. Verify actual account limits and native
  behavior before deciding the capacity or architecture correction.
- The uploaded staging controller retains the existing serving release. Use a
  safe forward migration; do not change live ceilings or roll back implicitly.

## Work

1. Obtain the requested ReviewGPT architecture consultation against the guarded
   full snapshot; independently verify its relevant platform claims.
2. Read authoritative native account admission metadata through protected CI.
3. Implement the smallest supported correction, deleting superseded machinery.
4. Reproduce failed admission, delayed image availability, retained sessions,
   warm inventory, and repeated deployments at the composed owners.
5. Run relevant tests, typecheck, complexity checks, exact-head CI and final
   ReviewGPT; merge with the approved commit identity and deploy.
6. Verify live release state and bounded runtime health before claiming success.

## Product and verification

Journeys: a message during image preparation; an existing session during release;
an idle or new member after promotion; failed publication/admission; and the next
release reusing retained state. Readiness is Hold until the chosen implementation
has direct local proof and production release verification. No provider input or
assistant behavior change is intended.

## Progress

- Architecture consultation completed: separate native preparation from Worker
  publication, preserve valid warm previous sessions, and keep execution identity
  independent of deployment attempts. No live capacity reductions applied.
- Focused runtime regression suite: 301 tests passed, including promoted warm
  retention in all allocation modes, cold previous-release rejection, exact claim
  replay, and removal of deployment-specific restart retries.
- Deployment tests cover rejected native admission before Worker publication,
  interrupted native PATCH/rollout reconciliation, stable execution identity,
  candidate resumption, and Worker-only promotion. Final verification remains open.
- Read-only native quota diagnostics merged after review, exact-head CI, and
  local acceptance. The declared full overlap exceeds the reported account CPU
  and memory ceilings, and native creation independently failed admission.
  These observations do not establish the provider's quota accounting formula
  or prove that safe releases require more quota. No serving ceiling was reduced;
  the fixed-capacity follow-up below supersedes quota escalation.
- Final ReviewGPT identified a rebuilt-image retry dead end. Accepted and corrected
  in the existing artifact-preparation owner: verify requested public commit,
  fingerprints, execution configuration, and native namespace before reusing the
  admitted immutable image. A real manifest rewrite reproduces the old rejection
  and proves candidate identity/inventory survive the corrected resume path.
  Conflicting artifacts remain rejected, and smoke still gates promotion.
- The correction review identified successful native creation before legacy
  admission metadata is published. Accepted and corrected by distinguishing the
  legacy pointer from a fully identified candidate, then using the existing
  inactive-namespace drain/admission path. The composed test drops the accepted
  create response and proves a retry leaves serving configuration/capacity intact.
  The shipped base staging writer reproduces that fixture's legacy record shape.
- Final ReviewGPT passed with both recovery findings resolved. Required CI and
  full local acceptance passed on the reviewed implementation: workspace
  typechecks and package coverage, Web tests/build/smoke, Cloudflare Node and
  Worker tests, and scenario coverage. Base integration preserves every reviewed
  rollout source and test file; only the existing mailbox wake-ownership change
  is added. Its focused proof and exact integration-head CI gate the merge.
- Production activation and live release verification remain pending the native
  capacity gate. The separate live Stripe browser matrix on main already failed
  downgrade and family-conversion readiness before the quota diagnostic merged;
  this change does not modify those billing paths.

## Fixed-capacity follow-up

- The reviewed native-admission correction merged, but its two-full-target
  production activation did not proceed. No quota request was submitted.
- Revisit a single serving application whose native target changes without a
  replacement rollout, with consumer-first support for exact approved artifacts.
  Account for prefetched old instances and immutably pin the artifact actually
  admitted to an execution target; do not weaken member or write-fence identity.
- Prove bounded artifact retirement across successive releases. A target PATCH,
  a stopped instance, and absence of a currently running old process do not alone
  prove that the platform cannot assign an old prefetched image later.
- Obtain the requested architecture consultation under this constraint before
  choosing implementation changes. Distinguish fixing image-mismatch backoff
  from an unsupported guarantee of zero latency under every capacity condition.

## Release preparation

- The single-application architecture consultation completed against the merged
  correction. It identified an unresolved native contract for retiring old
  prefetched images without restarting live work. A PATCH-only implementation
  with two approved artifacts could block later releases indefinitely; do not
  ship that incomplete lifecycle or add a new capacity allocator to this fix.
- The reviewed runtime correction is already merged in PR 3037. PR 3036 also
  merged a separate bounded warm-handoff improvement. Both are included in the
  current integration base; no new runtime behavior is authored in this follow-up.
- Existing PR 3039 and private PR 119 own explicit Worker-only deployment. They
  preserve serving image identities and capacity and update only the Worker and
  existing smoke target. Keep their completion ownership separate. This mode
  can deliver compatible coordination fixes; it does not deliver new member
  runner images or resolve the capacity limit for later image replacement.
- Extend the actual container-readiness regression with a Worker-only case:
  the Worker advertises newly built fingerprints, the selected release retains
  the previous image, and the existing warm process passes one health check
  without a native start or destroy. Keep the original mismatch reproduction
  and staged/promoted image cases intact.
- Verification: 404 focused container, fleet-lifecycle, identity and standby
  tests passed after integrating the current main changes. Cloudflare typecheck
  passed. The new proof adds no production code, dependency or persisted state.
- Release readiness remains Hold until the owned release path has merged,
  protected deployment succeeds, and live Worker/image receipts are verified.
  Worker-only mode must not change quotas, roll back production, or replace
  member runner images.
