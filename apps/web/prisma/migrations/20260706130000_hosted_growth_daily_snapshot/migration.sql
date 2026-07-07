CREATE TABLE "hosted_growth_daily_snapshot" (
    "snapshot_date" DATE NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "total_members" INTEGER NOT NULL,
    "paying_individuals" INTEGER NOT NULL,
    "paying_family_groups" INTEGER NOT NULL,
    "paying_family_seats" INTEGER NOT NULL,
    "paying_customers" INTEGER NOT NULL,
    "covered_members" INTEGER NOT NULL,
    "trialing_members" INTEGER NOT NULL,
    "mrr_usd_cents" INTEGER NOT NULL,

    CONSTRAINT "hosted_growth_daily_snapshot_pkey" PRIMARY KEY ("snapshot_date")
);
