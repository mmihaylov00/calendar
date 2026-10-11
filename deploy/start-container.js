// Container startup: prepare HA's private storage, then run the server as the node user.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function start() {
  if (process.env.MARCO_HOME_ASSISTANT === '1') {
    Object.assign(process.env, { DATA_DIR: '/data/marco', MARCO_UPDATE_CHECK: '0' });
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(process.env.DATA_DIR).isDirectory()) throw new Error('Marco data path must be a directory, not a symbolic link');
    if (process.getuid() === 0) {
      fs.chownSync(process.env.DATA_DIR, 1000, 1000);
      process.initgroups('node', 1000);
      process.setgid(1000);
      process.setuid(1000);
    }
  }
  await import('../server/index.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(`[container] cannot start Marco: ${err.message}`);
    process.exit(1);
  });
}
