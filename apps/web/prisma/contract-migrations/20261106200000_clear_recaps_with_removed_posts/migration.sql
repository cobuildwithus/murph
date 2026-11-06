-- After old functions drain, clear legacy stories that may quote removed posts.
UPDATE game SET recap_encrypted = NULL
WHERE recap_encrypted IS NOT NULL
  AND EXISTS (SELECT 1 FROM game_entry WHERE game_entry.game_id = game.id AND game_entry.withdrawn_reason = 'removed')
  AND NOT EXISTS (SELECT 1 FROM game_event WHERE game_event.game_id = game.id AND game_event.type = 'recap_witness');
