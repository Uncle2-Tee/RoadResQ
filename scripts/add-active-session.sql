ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeSessionStartedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'User_activeSessionId_key'
  ) THEN
    CREATE UNIQUE INDEX "User_activeSessionId_key" ON "User"("activeSessionId");
  END IF;
END $$;
