-- Expand first: legacy rows and a mixed-version deploy normalize NULL to epoch
-- one, while every explicit application write requires a positive integer.
ALTER TABLE "device_connection_source"
ADD COLUMN "lifecycle_epoch" INTEGER DEFAULT 1;
