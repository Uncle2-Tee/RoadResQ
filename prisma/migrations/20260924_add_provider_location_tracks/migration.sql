CREATE TABLE "ProviderLocationTracks" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy" DECIMAL(10,2),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderLocationTracks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderLocationTracks_providerId_recordedAt_idx"
    ON "ProviderLocationTracks"("providerId", "recordedAt");

ALTER TABLE "ProviderLocationTracks"
    ADD CONSTRAINT "ProviderLocationTracks_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
