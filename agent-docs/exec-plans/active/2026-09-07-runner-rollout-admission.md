# Runner rollout admission and architecture correction

## Outcome

Complete safe runner releases without deployment-induced foreground waits or an
incidental reduction in supported serving capacity. Prefer native Cloudflare
ordering and existing runtime owners over extra allocation or retry machinery.

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
  local acceptance. Protected production preflight confirmed that account CPU
  and memory limits cannot admit the declared full release overlap. Native
  creation has independently failed admission. No serving ceiling was reduced;
  an external quota increase remains required before production activation.
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
