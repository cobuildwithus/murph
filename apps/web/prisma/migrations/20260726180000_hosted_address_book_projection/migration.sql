CREATE TABLE "hosted_address_book_projection" (
    "member_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL,
    "last_mutation_id" TEXT NOT NULL,
    "last_mutation_operation" TEXT NOT NULL,
    "last_replaced_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_address_book_projection_pkey" PRIMARY KEY ("member_id"),
    CONSTRAINT "hosted_address_book_projection_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "hosted_address_book_projection_mutation_id_check"
      CHECK ("last_mutation_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "hosted_address_book_projection_operation_check"
      CHECK ("last_mutation_operation" IN ('replace', 'delete')),
    CONSTRAINT "hosted_address_book_projection_state_check"
      CHECK (
        (
          "enabled"
          AND "last_mutation_operation" = 'replace'
          AND "last_replaced_at" IS NOT NULL
          AND "disabled_at" IS NULL
        )
        OR
        (
          NOT "enabled"
          AND "last_mutation_operation" = 'delete'
          AND "disabled_at" IS NOT NULL
        )
      )
);

CREATE TABLE "hosted_address_book_contact" (
    "member_id" TEXT NOT NULL,
    "phone_token_version" INTEGER NOT NULL,
    "phone_token" TEXT NOT NULL,
    "advisory_name_encrypted" TEXT NOT NULL,

    CONSTRAINT "hosted_address_book_contact_pkey"
      PRIMARY KEY ("member_id", "phone_token_version", "phone_token"),
    CONSTRAINT "hosted_address_book_contact_token_version_check"
      CHECK ("phone_token_version" > 0 AND "phone_token_version" <= 65535),
    CONSTRAINT "hosted_address_book_contact_token_check"
      CHECK ("phone_token" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "hosted_address_book_contact_name_ciphertext_check"
      CHECK (length("advisory_name_encrypted") > 0)
);

CREATE INDEX "hosted_address_book_contact_phone_token_version_idx"
  ON "hosted_address_book_contact"("phone_token_version");

ALTER TABLE "hosted_address_book_projection"
  ADD CONSTRAINT "hosted_address_book_projection_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_address_book_contact"
  ADD CONSTRAINT "hosted_address_book_contact_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_address_book_projection"("member_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
