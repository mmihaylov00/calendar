// Internal save recovery only. Home Assistant manages application backups.
import path from 'node:path';
import { paths, writeFileAtomic } from './store.js';

export function backupBeforeSave(current) {
  if (!current) return;
  writeFileAtomic(path.join(paths.backups, 'config-previous.json'), JSON.stringify(current, null, 2));
}
