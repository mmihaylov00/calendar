// Container startup: Supervisor options and writable storage, then the existing server as the node user.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OPTION_ENV = {
  public_url: 'PUBLIC_URL',
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
  allowed_hosts: 'ALLOWED_HOSTS',
  trust_proxy: 'TRUST_PROXY',
  lan_address: 'LAN_ADDRESS',
};

export function homeAssistantEnvironment(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Home Assistant options must be an object');
  const env = {};
  for (const [key, name] of Object.entries(OPTION_ENV)) {
    if (options[key] === undefined) continue;
    if (typeof options[key] !== 'string') throw new Error(`Home Assistant option ${key} must be a string`);
    env[name] = options[key];
  }
  if (env.PUBLIC_URL) {
    let url;
    try { url = new URL(env.PUBLIC_URL); } catch { throw new Error('public_url must be an HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('public_url must be an HTTP or HTTPS origin without a path, query or credentials');
    }
    env.PUBLIC_URL = url.origin;
  }
  return env;
}

async function start() {
  if (process.env.MARCO_HOME_ASSISTANT === '1') {
    const options = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    Object.assign(process.env, homeAssistantEnvironment(options), { DATA_DIR: '/data/marco', MARCO_UPDATE_CHECK: '0' });
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
