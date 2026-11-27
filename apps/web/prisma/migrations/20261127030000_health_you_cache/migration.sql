CREATE TABLE "health_you_cache" (
    "member_id" TEXT PRIMARY KEY REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "revision" UUID NOT NULL,
    "dependency" TEXT NOT NULL,
    "views_encrypted" TEXT NOT NULL
);
