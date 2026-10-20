CREATE TABLE "companion_push_route" (
  "user_id" TEXT PRIMARY KEY REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "installation_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "environment" TEXT NOT NULL CHECK ("environment" IN ('development', 'production')),
  "topic" TEXT NOT NULL,
  "alerts_allowed" BOOLEAN NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "companion_wearable_link" (
  "user_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "wearable" TEXT NOT NULL CHECK ("wearable" IN ('whoop', 'garmin')),
  "installation_id" TEXT NOT NULL,
  "link_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("user_id", "wearable")
);
