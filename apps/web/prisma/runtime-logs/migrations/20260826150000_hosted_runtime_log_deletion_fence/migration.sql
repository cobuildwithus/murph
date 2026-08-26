CREATE TABLE "hosted_runtime_log_deletion_fence" (
    "subject_key" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_runtime_log_deletion_fence_pkey" PRIMARY KEY ("subject_key")
);
