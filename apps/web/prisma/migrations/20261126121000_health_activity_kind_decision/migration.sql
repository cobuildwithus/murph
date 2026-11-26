CREATE TABLE "health_activity_kind_decision" (
    "key" TEXT PRIMARY KEY,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('run', 'walk', 'sauna', 'cold_plunge', 'lift', 'other')),
    "route" BOOLEAN NOT NULL,
    "timer" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
