-- Expand first: application reads normalize legacy NULL/zero values to epoch 1,
-- while every explicit application write requires a positive integer.
ALTER TABLE "device_connection_source"
ADD COLUMN "lifecycle_epoch" INTEGER DEFAULT 1;
