-- Imported descriptors and existing registrations retain their product expiry.
-- New provisional upload rows explicitly set this false until registration.
ALTER TABLE "hosted_runtime_media" ADD COLUMN "registered" BOOLEAN NOT NULL DEFAULT true;
