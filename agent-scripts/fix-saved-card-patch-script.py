from pathlib import Path

path = Path(__file__).with_name("apply-saved-card-group-funding.py")
content = path.read_text()

metadata_old = "'''function assertHostedUsageCreditCheckoutMetadata(input: {\n  metadata: Prisma.JsonValue | Stripe.Metadata | null;"
metadata_new = "'''function assertHostedUsageCreditMetadata(input: {\n  metadata: Prisma.JsonValue | Stripe.Metadata | null;"
if content.count(metadata_old) < 1:
    raise RuntimeError("Saved-card patch metadata declaration context was missing.")
content = content.replace(metadata_old, metadata_new, 1)

authorization_old = '''    "input.checkoutAuthorization",
    "input.paymentAuthorization",
    expected=4,
)'''
authorization_new = '''    "input.checkoutAuthorization",
    "input.paymentAuthorization",
    expected=3,
)'''
if content.count(authorization_old) != 1:
    raise RuntimeError("Saved-card patch authorization count context was missing.")
content = content.replace(authorization_old, authorization_new)

path.write_text(content)
