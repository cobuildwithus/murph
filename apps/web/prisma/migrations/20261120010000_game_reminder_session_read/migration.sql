CREATE TABLE "game_reminder_session_read" (
  "model" "HostedAuthModel" NOT NULL DEFAULT 'session' CHECK ("model" = 'session'),
  "session_id" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  PRIMARY KEY ("model", "session_id"),
  FOREIGN KEY ("model", "session_id") REFERENCES "hosted_auth_record" ("model", "id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
