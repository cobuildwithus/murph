CREATE TABLE "hosted_thread_container_participant" (
    "container_member_id" TEXT NOT NULL,
    "participant_member_id" TEXT NOT NULL,
    "handle_lookup_key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_thread_container_participant_pkey" PRIMARY KEY ("container_member_id", "participant_member_id")
);

CREATE INDEX "hosted_thread_container_participant_container_member_id_idx" ON "hosted_thread_container_participant"("container_member_id");

ALTER TABLE "hosted_thread_container_participant" ADD CONSTRAINT "hosted_thread_container_participant_container_member_id_fkey" FOREIGN KEY ("container_member_id") REFERENCES "hosted_thread_container"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosted_thread_container_participant" ADD CONSTRAINT "hosted_thread_container_participant_participant_member_id_fkey" FOREIGN KEY ("participant_member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
