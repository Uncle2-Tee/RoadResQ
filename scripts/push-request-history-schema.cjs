require('dotenv/config');

const { Client } = require('pg');

const ddl = `
DO $$
BEGIN
  CREATE TYPE "RequestType" AS ENUM ('SERVICE', 'TOW');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ACCEPTED', 'DECLINED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RequestHistory" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "type" "RequestType" NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "driverId" TEXT,
  "driverName" TEXT NOT NULL,
  "driverPhone" TEXT,
  "driverLocation" TEXT,
  "mechanicId" TEXT,
  "providerName" TEXT NOT NULL,
  "providerPhone" TEXT,
  "problemDescription" TEXT,
  "price" DECIMAL(10, 2),
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "estimatedTime" INTEGER,
  "acceptedBy" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequestHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RequestHistory_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestHistory_requestId_key" ON "RequestHistory"("requestId");
CREATE INDEX IF NOT EXISTS "RequestHistory_driverId_idx" ON "RequestHistory"("driverId");
CREATE INDEX IF NOT EXISTS "RequestHistory_mechanicId_idx" ON "RequestHistory"("mechanicId");
CREATE INDEX IF NOT EXISTS "RequestHistory_type_idx" ON "RequestHistory"("type");
CREATE INDEX IF NOT EXISTS "RequestHistory_status_idx" ON "RequestHistory"("status");
CREATE INDEX IF NOT EXISTS "RequestHistory_requestedAt_idx" ON "RequestHistory"("requestedAt");
`;

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(ddl);
    await client.query('COMMIT');

    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'RequestHistory'
      ORDER BY ordinal_position
    `);

    console.log('RequestHistory schema pushed.');
    console.log(`columns=${result.rowCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
