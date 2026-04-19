ALTER TABLE "hosted_wake_terminal"
    ADD COLUMN "fetched_cursor_version" BIGINT NOT NULL DEFAULT -1;

ALTER TABLE "hosted_wake_terminal"
    ALTER COLUMN "fetched_cursor_version" DROP DEFAULT;
