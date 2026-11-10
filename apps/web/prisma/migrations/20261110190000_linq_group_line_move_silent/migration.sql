-- Retain the column for old Web readers during rollout. Silent moves do not use it.
ALTER TABLE "hosted_linq_group_line_move" ALTER COLUMN "notice_text_hash" DROP NOT NULL;
