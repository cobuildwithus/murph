CREATE TABLE "hosted_group" (
    "id" TEXT NOT NULL,
    "owner_member_id" TEXT NOT NULL,
    "runtime_member_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "display_name" TEXT,
    "join_code" TEXT,
    "join_code_created_at" TIMESTAMP(3),
    "join_policy_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hosted_group_member" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_group_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_group_runtime_member_id_key" ON "hosted_group"("runtime_member_id");
CREATE UNIQUE INDEX "hosted_group_join_code_key" ON "hosted_group"("join_code");
CREATE INDEX "hosted_group_owner_member_id_idx" ON "hosted_group"("owner_member_id");
CREATE INDEX "hosted_group_kind_idx" ON "hosted_group"("kind");
CREATE UNIQUE INDEX "hosted_group_member_group_id_member_id_key" ON "hosted_group_member"("group_id", "member_id");
CREATE INDEX "hosted_group_member_member_id_idx" ON "hosted_group_member"("member_id");
CREATE INDEX "hosted_group_member_group_id_idx" ON "hosted_group_member"("group_id");

ALTER TABLE "hosted_group" ADD CONSTRAINT "hosted_group_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "hosted_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hosted_group" ADD CONSTRAINT "hosted_group_runtime_member_id_fkey" FOREIGN KEY ("runtime_member_id") REFERENCES "hosted_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hosted_group_member" ADD CONSTRAINT "hosted_group_member_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "hosted_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_group_member" ADD CONSTRAINT "hosted_group_member_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
