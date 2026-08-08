ALTER TYPE "HostedUsageCreditEntryKind"
  ADD VALUE IF NOT EXISTS 'starter_grant' BEFORE 'purchase_grant';
