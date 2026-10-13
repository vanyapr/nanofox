/* Verify that the checked-in browser artifact exactly matches nanofox.ts. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'nanofox-artifact-'));
const tsc = process.platform === 'win32'
  ? fileURLToPath(new URL('../node_modules/.bin/tsc.cmd', import.meta.url))
  : fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));

try {
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--outDir', temporary], {
    cwd: root, encoding: 'utf8', shell: false
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'TypeScript build failed.\n');
    process.exitCode = result.status || 1;
  } else {
    const generated = readFileSync(join(temporary, 'nanofox.js'));
    const checkedIn = readFileSync(new URL('../nanofox.js', import.meta.url));
    if (!generated.equals(checkedIn)) {
      process.stderr.write('nanofox.js is stale. Run npm run build and commit the result.\n');
      process.exitCode = 1;
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
