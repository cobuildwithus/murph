from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "apps/web/prisma/schema.prisma",
    '  configurationDigest        String   @map("configuration_digest")\n'
    '  publicAliasEncrypted       String?  @map("public_alias_encrypted")',
    '  configurationDigest        String   @map("configuration_digest")\n'
    '  creativeRequestEncrypted   String?  @map("creative_request_encrypted")\n'
    '  publicAliasEncrypted       String?  @map("public_alias_encrypted")',
    "Prisma creative request field",
)

components = "apps/web/app/design/components-content.tsx"
replace_once(
    components,
    '''            Personal, Family, and group funding use a saved card when available
            and send card entry or verification to Stripe only when needed.
            Family owners reuse the standard amount dialog with an exact member
            label and status-only recovery when another target owns the active
            checkout. Credit is added only after Stripe confirms payment.''',
    '''            Personal, Family, and group funding use a saved card when available
            and send card entry or verification to Stripe only when needed.
            Group funding stays quiet by default; an authorized participant can
            optionally request one message, poem, or 15-second song, including a
            song genre or high-level style reference. Family owners reuse the
            standard amount dialog with an exact member label and status-only
            recovery when another target owns the active checkout. Credit is
            added only after Stripe confirms payment.''',
    "design catalog description",
)
replace_once(
    components,
    '''                        checkoutUrl="/api/design/usage-credit-preview"
                        customizationAllowed
                        inert
                        mode="monthly"''',
    '''                        checkoutUrl="/api/design/usage-credit-preview"
                        customizationAllowed
                        mode="monthly"''',
    "interactive monthly design preview",
)
replace_once(
    components,
    '''                        checkoutUrl="/api/design/usage-credit-preview"
                        customizationAllowed
                        inert
                        mode="one_time"''',
    '''                        checkoutUrl="/api/design/usage-credit-preview"
                        customizationAllowed
                        mode="one_time"''',
    "interactive one-time design preview",
)

plan = Path(
    "agent-docs/exec-plans/active/2026-08-07-optional-group-sponsorship-moments.md",
)
text = plan.read_text()
text = text.replace(
    "- Implementation and focused verification are complete; the pull request is awaiting review.",
    "- The verified implementation is rebased onto current main; exact-head CI, rendered proof, and review remain pending.",
)
plan.write_text(text)

Path("scripts/prepare-final-optional-sponsorship-moments.py").unlink()
