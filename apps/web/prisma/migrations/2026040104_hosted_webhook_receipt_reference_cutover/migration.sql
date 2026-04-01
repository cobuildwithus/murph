-- Hard cutover: hosted webhook receipts now retain only sparse reference payloads from creation
-- time, and receipt hydration no longer supports the legacy inline-dispatch shape.
-- Since there is no stored data to preserve, drop any existing hosted webhook receipt/outbox rows
-- instead of carrying runtime compatibility branches for them.

delete from "execution_outbox"
where "source_type" = 'hosted_webhook_receipt';

delete from "hosted_webhook_receipt";
