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

purpose_old = "'''  if (\n    normalizeNullableString(metadata?.purpose) !==\n      HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE\n  ) {"
purpose_new = "'''  if (\n    normalizeNullableString(metadata?.purpose) !==\n    HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE\n  ) {"
if content.count(purpose_old) != 1:
    raise RuntimeError("Saved-card patch purpose context was missing.")
content = content.replace(purpose_old, purpose_new)

signature_old = "''')}): Promise<HostedUsageCreditPreparedStripeEvent> {"
signature_new = "'''}): Promise<HostedUsageCreditPreparedStripeEvent> {"
if content.count(signature_old) != 1:
    raise RuntimeError("Saved-card patch prepare signature context was missing.")
content = content.replace(signature_old, signature_new)

nullable_signature_old = "''')}): Promise<HostedUsageCreditPreparedStripeEvent | null> {"
nullable_signature_new = "'''}): Promise<HostedUsageCreditPreparedStripeEvent | null> {"
if content.count(nullable_signature_old) != 1:
    raise RuntimeError("Saved-card patch nullable prepare signature context was missing.")
content = content.replace(nullable_signature_old, nullable_signature_new)

path.write_text(content)
