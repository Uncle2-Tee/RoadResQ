const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const migrationName = '0_baseline';
const migrationDirectory = path.join(projectRoot, 'prisma', 'migrations', migrationName);
const migrationFile = path.join(migrationDirectory, 'migration.sql');

process.env.USE_DIRECT_URL = 'true';

if (fs.existsSync(migrationFile)) {
  console.log(`Baseline migration already exists at ${path.relative(projectRoot, migrationFile)}.`);
  process.exit(0);
}

fs.mkdirSync(migrationDirectory, { recursive: true });

const diff = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  { cwd: projectRoot, encoding: 'utf8' },
);

if (diff.status !== 0) {
  process.stderr.write(diff.stderr || 'Prisma could not generate the baseline migration.\n');
  process.exit(diff.status || 1);
}

fs.writeFileSync(migrationFile, diff.stdout, 'utf8');

const resolve = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prisma', 'migrate', 'resolve', '--applied', migrationName],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (resolve.status !== 0) {
  process.exit(resolve.status || 1);
}

const generate = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prisma', 'generate'],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (generate.status !== 0) {
  process.exit(generate.status || 1);
}

console.log(`Created and marked ${path.relative(projectRoot, migrationFile)} as applied.`);