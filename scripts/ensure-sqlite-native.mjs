import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export function isNodeAbiMismatch(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /NODE_MODULE_VERSION\s+\d+[\s\S]*?requires\s+NODE_MODULE_VERSION\s+\d+/i.test(message)
    || /compiled against a different Node\.js version/i.test(message);
}

export function ensureSqliteNative(options = {}) {
  const loadDatabase = options.loadDatabase ?? (() => require('better-sqlite3'));
  const rebuild = options.rebuild ?? (() => {
    execFileSync('corepack', ['pnpm', 'rebuild', 'better-sqlite3'], { stdio: 'inherit' });
  });

  try {
    probeDatabase(loadDatabase());
    return false;
  } catch (error) {
    if (!isNodeAbiMismatch(error)) throw error;
    rebuild();
    try {
      probeDatabase(loadDatabase());
      return true;
    } catch (cause) {
      throw new Error(`better-sqlite3 remains incompatible with Node ${process.version} after rebuilding.`, { cause });
    }
  }
}

function probeDatabase(Database) {
  const database = new Database(':memory:');
  try {
    database.prepare('SELECT 1').get();
  } finally {
    database.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureSqliteNative();
}