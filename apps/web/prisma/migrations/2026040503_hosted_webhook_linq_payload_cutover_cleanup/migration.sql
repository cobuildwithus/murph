delete from "execution_outbox"
where "source_type" = 'hosted_webhook_receipt'
  and "source_id" in (
    select "source" || ':' || "event_id"
    from "hosted_webhook_receipt"
    where "source" = 'linq'
  );

delete from "hosted_webhook_receipt"
where "source" = 'linq';
