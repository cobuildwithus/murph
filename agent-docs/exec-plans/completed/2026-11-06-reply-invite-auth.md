# Reply email authority and invite privacy

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and invariant

A reply alias selects a destination, never member authority. Private assistant
input requires provider-authenticated sender identity matching the current
verified owner. Anonymous invite status must not disclose saved email addresses
or member setup state; expired invites return no contact hints.

## Evidence and owners

The Worker omits sender facts for personal alias callbacks, and Web accepts the
alias alone. The production verifier returns null. Invite status projects full
pending email and messaging flags independently of session ownership or expiry.
Fix the existing Worker verification seam and Web admission/status owners.
No new state, dependencies, prompts, or model-controlled approval is needed.
Cloudflare documents its first event Authentication-Results header as trusted;
raw MIME headers and later results remain untrusted.

## Product UX

Outcome: Preserve authenticated email conversations and invite sign-in while
rejecting leaked-link authority.
Reaches: verified owner, outsider with alias, forged sender, anonymous/wrong
session invite visitor, expired invite, matching signed-in member.
Proof: provider-shaped ingress through storage/wake boundary, signed Web
callbacks, and status service through serialized response. Anonymous email
invite visitors enter their own email in the existing auth form.

## Tasks

1. Add sender-verification and owner-binding regressions; implement admission.
2. Add invite projection regressions; restrict private and expired output.
3. Run focused tests/typechecks, review diff and deployment skew, scoped commit.

## Deployment and failure

Deploy Web enforcement before the Worker: old alias-only callbacks fail closed
until the new Worker supplies sender proof. No schema changes. Reverting Web
reopens the gap. Unverified or mismatched messages stop before raw persistence
and mailbox append. Existing accepted mailbox items predate this admission fix;
no production queue mutation is authorized by this task.

## Verification

Completed local proof:
- Worker route, ingress and email suites: 76 tests passed across three files.
- Web callback, invite privacy, status-route and invite UI/state suites: 100
  tests passed across six files (including the final extra owner-miss case).
- Eleven focused authorization/privacy cases fail against the original source
  and pass after restoring the fixes.
- `pnpm --dir apps/cloudflare typecheck` and `pnpm --dir apps/web typecheck`
  passed; prepared Web typecheck repeated after final edits.
- `pnpm complexity:diff` passed: changed-source complexity debt decreased.
  The remaining Worker ingress hotspot predates this patch.
- `git diff --check` and authored-content privacy scan passed.

Product UX: Ready for review. Synthetic production-handler tests prove
provider-result acceptance, raw-header forgery rejection, no storage/wake on
failed proof, and normal personal/group delivery preservation. Signed callback
tests prove current-owner equality, verified-email miss, inactive-owner denial,
and legacy callback denial. Status tests prove anonymous/wrong-session and
expired-link privacy, with matching-member continuation preserved. Existing
first-party auth rendering accepts manual email entry without a saved target.
No production data, actual member mail, or deployed end-to-end test was used.
Parent review found no remaining local implementation issue.
PR publication, external review and deployment are separate from local fixes.

## Scope decisions

Group aliases use the same authenticated-sender boundary before their existing
membership/grant checks, preventing the adjacent spoofed-sender admission path.
The new private-owner lookup uses the existing core-only blinded email index:
one additional bounded DB query, no decryption/provider calls or transactions.
No assistant input/schema changes for accepted messages; live-model proof is
not applicable to this pre-model admission fix. Initial provider input is unchanged
for both personal and group authorized turns.

Changelog: not applicable. Sensitive authorization hardening; publication of
exploit details before rollout is not a safe member-facing release note.

## Handoff

Local implementation is complete. No PR was requested or opened, and no
production change was made. Required sensitive-change ReviewGPT and exact-head
CI remain release gates when this branch is published as a PR. Confirm the
first platform authentication result with a controlled verified-inbox smoke
at rollout, and confirm outsider rejection before storage/wake. Domains or
forwarders without passing DMARC and exact envelope/Header From equality are
rejected; use the member's verified sending address or another authenticated
channel. Previously accepted mailbox content is outside this admission fix.
Completed: 2026-11-06
