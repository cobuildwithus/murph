\set ON_ERROR_STOP on
\if :{?end_utc}
\else
\set end_utc now
\endif
SELECT :'end_utc'::timestamptz AT TIME ZONE 'UTC' AS until_utc,
       (:'end_utc'::timestamptz AT TIME ZONE 'UTC') - interval '1 hour' AS since_utc
\gset

\echo 'Persisted Linq events by webhook receipt in the hour ending' :until_utc 'UTC'
SELECT count(*) AS events,
       count(*) FILTER (WHERE event_type = 'message.received') AS inbound_messages,
       max(received_at) AS latest_event_utc
FROM hosted_linq_provider_event
WHERE received_at >= :'since_utc' AND received_at < :'until_utc';

\echo 'Inbound messages among the newest 100 accepted Linq traces in the same hour (UTC)'
WITH recent AS (
  SELECT mailbox_item_id, user_id, webhook_received_at, provider_start_at, linq_delivery_id,
         phase_breakdown_json #>> '{orchestration,ingressConversationIsGroup}' AS is_group
  FROM hosted_ingress_latency_trace
  WHERE source = 'linq' AND accepted_at >= :'since_utc' AND accepted_at < :'until_utc'
  ORDER BY accepted_at DESC, id DESC
  LIMIT 100
)
SELECT recent.is_group, mailbox.occurred_at AS message_utc,
       event.provider_created_at AS event_utc,
       recent.webhook_received_at AS webhook_utc,
       event.provider_created_at - mailbox.occurred_at AS message_to_event,
       recent.webhook_received_at - event.provider_created_at AS event_to_webhook,
       recent.provider_start_at - recent.webhook_received_at AS webhook_to_model,
       delivery.status AS reply_status,
       delivery.delivered_at AS reply_delivered_utc
FROM recent
JOIN hosted_mailbox_item AS mailbox
  ON mailbox.id = recent.mailbox_item_id AND mailbox.user_id = recent.user_id
JOIN hosted_linq_provider_event AS event
  -- The mailbox dedupe key identifies the exact webhook, including on retry.
  -- Match the s1 lookup used by the runtime typing alert for raw and blinded keys.
  ON event.event_id = CASE WHEN mailbox.dedupe_key ~ '^hbid:linq[.]provider-event:s1:[0-9a-f]{64}$'
    THEN mailbox.dedupe_key
    ELSE 'hbid:linq.provider-event:s1:' || encode(sha256(
      convert_to('murph.hosted-linq-observability', 'UTF8') || decode('00', 'hex') ||
      convert_to('linq.provider-event', 'UTF8') || decode('00', 'hex') ||
      convert_to(mailbox.dedupe_key, 'UTF8')), 'hex')
  END AND event.event_type = 'message.received'
LEFT JOIN hosted_linq_delivery AS delivery ON delivery.id = recent.linq_delivery_id
ORDER BY recent.webhook_received_at DESC NULLS LAST, mailbox.id;
