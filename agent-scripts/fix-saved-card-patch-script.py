from pathlib import Path

path = Path(__file__).with_name("apply-saved-card-group-funding.py")
content = path.read_text()
old = "'''function assertHostedUsageCreditCheckoutMetadata(input: {\n  metadata: Prisma.JsonValue | Stripe.Metadata | null;"
new = "'''function assertHostedUsageCreditMetadata(input: {\n  metadata: Prisma.JsonValue | Stripe.Metadata | null;"
if content.count(old) < 1:
    raise RuntimeError("Saved-card patch metadata declaration context was missing.")
path.write_text(content.replace(old, new, 1))
