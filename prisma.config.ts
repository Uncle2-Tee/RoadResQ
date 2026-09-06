import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const databaseUrl =
  process.env.USE_DIRECT_URL === 'true' ? env('DIRECT_URL') : env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
