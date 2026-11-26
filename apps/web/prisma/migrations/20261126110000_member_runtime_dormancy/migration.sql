ALTER TABLE hosted_member
  ADD COLUMN runtime_last_interaction_at TIMESTAMP(3),
  ADD COLUMN runtime_dormant BOOLEAN NOT NULL DEFAULT false;
