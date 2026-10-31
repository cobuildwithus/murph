-- Requested fixed-target recovery. Run only after the compatible
-- Web deployment has converged, through the existing postdeploy runner.
-- No model, ciphertext, mailbox, or provider work belongs in this transaction.
DO $$
DECLARE
  target_game CONSTANT text := '5325824e-9e5f-48a1-91b0-2fe954e616c7';
  -- Canonical game-recap:<gameId> lookup key and buildHostedLinqDeliveryId.
  receipt_key CONSTANT text := 'hbid:linq.delivery-idempotency:s1:ffa9925c44b84b7b899af257b29a6ea8b0b7a733195ff4983b1e7f0bab3a6269';
  receipt_id CONSTANT text := 'hld_2c0638fe083bc879fef06495bf1ae472';
  pair text[];
  locked_pair text[];
  target game%ROWTYPE;
BEGIN
  SELECT array_agg(member_id ORDER BY member_id COLLATE "C") INTO pair
  FROM (SELECT member_id FROM game_player WHERE game_id = target_game LIMIT 3) players;
  IF cardinality(pair) IS DISTINCT FROM 2 THEN RETURN; END IF;

  -- Same lock order as sealGameRecap and game joins/blocks: pair, then row.
  PERFORM pg_advisory_xact_lock(hashtext('weekly-game-pair'), hashtext(array_to_string(pair, ':')));
  SELECT * INTO target FROM game WHERE id = target_game FOR UPDATE;
  IF NOT FOUND OR target.status <> 'settled' OR target.recap_encrypted IS NOT NULL
    OR target.departed_player IS NOT NULL OR target.chat_container_member_id IS NULL
    THEN RETURN; END IF;
  SELECT array_agg(member_id ORDER BY member_id COLLATE "C") INTO locked_pair
  FROM (SELECT member_id FROM game_player WHERE game_id = target_game LIMIT 3) players;
  IF locked_pair IS DISTINCT FROM pair THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM game_block
    WHERE (blocker_member_id = pair[1] AND blocked_member_id = pair[2])
       OR (blocker_member_id = pair[2] AND blocked_member_id = pair[1])) THEN RETURN; END IF;

  -- Never re-arm any existing receipt, including skipped/failed/sent work.
  INSERT INTO hosted_linq_delivery
    (id, idempotency_key, source, source_ref, template, status, target_kind, attempted_at, updated_at)
  SELECT receipt_id, receipt_key, 'game_lifecycle', target_game, 'game_recap',
    'awaiting_generation', 'thread', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  WHERE NOT EXISTS (SELECT 1 FROM hosted_linq_delivery
    WHERE source = 'game_lifecycle' AND source_ref = target_game AND template = 'game_recap')
  ON CONFLICT DO NOTHING;
END $$;
