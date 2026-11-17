ALTER TABLE "hosted_member"
  ADD COLUMN "companion_app_platform" TEXT,
  ADD COLUMN "companion_app_version" TEXT,
  ADD COLUMN "companion_app_build" TEXT,
  ADD COLUMN "companion_os_version" TEXT,
  ADD COLUMN "companion_device_model" TEXT;
