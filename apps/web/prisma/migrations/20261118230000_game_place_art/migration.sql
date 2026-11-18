-- Shared place art: posters of public places and painted route maps. No member column.
CREATE TABLE "game_place_art" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bytes" BYTEA,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "failure_code" TEXT,
    CONSTRAINT "game_place_art_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "game_place_art_kind_check" CHECK ("kind" IN ('poster', 'map')),
    CONSTRAINT "game_place_art_status_check" CHECK ("status" IN ('making', 'ready', 'failed')),
    CONSTRAINT "game_place_art_ready_bytes_check" CHECK (("status" = 'ready') = ("bytes" IS NOT NULL)),
    CONSTRAINT "game_place_art_failure_code_check" CHECK ("failure_code" IN ('generation_failed', 'timeout', 'refused', 'drifted'))
);

-- Every admitted attempt, retries included, counts against its UTC day.
CREATE TABLE "game_place_art_budget" (
    "day" DATE NOT NULL,
    "attempts" INTEGER NOT NULL,
    CONSTRAINT "game_place_art_budget_pkey" PRIMARY KEY ("day")
);
