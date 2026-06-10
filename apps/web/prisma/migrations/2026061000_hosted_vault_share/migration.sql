-- CreateTable
CREATE TABLE "hosted_vault_share" (
    "id" TEXT NOT NULL,
    "grantor_member_id" TEXT NOT NULL,
    "projection_kind" TEXT NOT NULL,
    "destination_member_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'granted',
    "source" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_vault_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_vault_share_grantor_member_id_projection_kind_desti_key" ON "hosted_vault_share"("grantor_member_id", "projection_kind", "destination_member_id");

-- CreateIndex
CREATE INDEX "hosted_vault_share_grantor_member_id_status_idx" ON "hosted_vault_share"("grantor_member_id", "status");

-- CreateIndex
CREATE INDEX "hosted_vault_share_destination_member_id_status_idx" ON "hosted_vault_share"("destination_member_id", "status");

-- AddForeignKey
ALTER TABLE "hosted_vault_share" ADD CONSTRAINT "hosted_vault_share_grantor_member_id_fkey" FOREIGN KEY ("grantor_member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosted_vault_share" ADD CONSTRAINT "hosted_vault_share_destination_member_id_fkey" FOREIGN KEY ("destination_member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
