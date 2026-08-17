---
title: 'ReviewGPT recovery rejects a duplicated exact assistant response'
severity: 'minor'
target: 'cobuildwithus/review-gpt'
---

## Observed

ReviewGPT 0.5.131 confirmed the ZIP before sending, then failed closed because the committed user turn reportedly retained 0/1 attachments. Its persisted exact-target recovery later found two assistant response snapshots and refused the wake as ambiguous. A structured diagnostic export showed one user turn with the expected codebase ZIP and one substantive completed response rendered twice under different DOM identifiers; both response snapshots had the same marker and content, and one owned the returned artifact button.

## Expected

Committed-turn verification should recognize the retained attachment. Exact-target recovery should canonicalize duplicate DOM representations of the same assistant response before enforcing uniqueness.

## Impact

A required preliminary review completed, but automatic response capture, exact wake, and artifact download all failed. Manual diagnostic inspection was required, and the returned test-only patch could not be downloaded.

## Workaround

Run `thread diagnose` against the exact browser endpoint and thread, validate the single user turn and duplicated response content manually, then implement an accepted textual finding without consuming the artifact. Do not resend the original review prompt.
