// Dependency-free syntax and local JSON checks. Does not launch Hermes or make network calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.evidence', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(m?js|json)$/.test(entry.name)) files.push(file);
  }
}
walk(root);
for (const file of files) {
  if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(path.relative(root, file) + '\n' + result.stderr);
  }
}
console.log(JSON.stringify({ checked: files.length, syntaxAndJson: 'pass' }));
