// Offline-only deterministic embedding. The rest of app.mjs stays hand-authored.
import fs from 'node:fs';
import path from 'node:path';

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2); const value = flag => args[args.indexOf(flag) + 1];
if (!args.includes('--esbuild') || !args.includes('--receipt')) throw new Error('Explicit existing --esbuild and --receipt paths required; no automatic install');
const binary = path.resolve(value('--esbuild')); const receipt = path.resolve(value('--receipt'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const pin = JSON.parse(fs.readFileSync(path.join(root, 'tools/markdown/esbuild-pin.json')));
if (hash(fs.readFileSync(binary)) !== pin.binary_sha256) throw new Error('Unapproved offline build tool');
if (spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim() !== pin.version) throw new Error('Build tool version mismatch');
const vendor = path.join(root, 'tools/markdown/vendor/markdown-it-15.0.3.mjs');
const notices = fs.readFileSync(path.join(root, 'tools/markdown/vendor/LICENSES.txt'), 'utf8');
if (hash(fs.readFileSync(vendor)) !== 'd5432491790141da046b1197353705db03264f40b5727f3b4b591f5aba193e30') throw new Error('Parser pin mismatch');
if (hash(Buffer.from(notices)) !== 'e225f2e144df797c041f15685f934552a214b3494eb39a4e3cb00da6f93f78d5' || notices.includes('*/')) throw new Error('Notice pin mismatch');
if (!process.env.TMPDIR) throw new Error('Set TMPDIR to an existing temporary build directory');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR, 'artemis-markdown-build-'));
try {
  const outputs = []; const metadata = [];
  for (let i = 0; i < 2; i++) {
    const output = path.join(scratch, 'runtime.js'); const meta = path.join(scratch, 'meta.json');
    const command = ['tools/markdown/render.mjs', '--bundle', '--format=iife', '--global-name=ArtemisMarkdown', '--platform=browser', '--target=es2022', '--charset=utf8', '--legal-comments=inline', '--log-level=warning', '--outfile=' + output, '--metafile=' + meta];
    const result = spawnSync(binary, command, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'Offline bundle failed');
    const m = JSON.parse(fs.readFileSync(meta));
    const inputNames = Object.keys(m.inputs).sort();
    if (JSON.stringify(inputNames) !== JSON.stringify(['tools/markdown/render.mjs', 'tools/markdown/vendor/markdown-it-15.0.3.mjs'])) throw new Error('Unexpected build input');
    const only = Object.values(m.outputs); if (only.length !== 1 || only[0].imports.length) throw new Error('Runtime must be self-contained');
    outputs.push(fs.readFileSync(output, 'utf8')); metadata.push({ inputs: m.inputs, output: only[0] });
  }
  if (outputs[0] !== outputs[1] || JSON.stringify(metadata[0]) !== JSON.stringify(metadata[1])) throw new Error('Non-deterministic bundle');
  const appFile = path.join(root, 'dashboard/assets/app.mjs');
  const app = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
  const begin = '    // BEGIN GENERATED SAFE MARKDOWN RUNTIME\n'; const end = '    // END GENERATED SAFE MARKDOWN RUNTIME';
  const a = app.indexOf(begin), b = app.indexOf(end);
  if (a < 0 || b <= a || app.lastIndexOf(begin) !== a || app.lastIndexOf(end) !== b) throw new Error('Unambiguous generated region required');
  const embedded = '/*!\n' + notices + '\n*/\n' + outputs[0];
  const next = app.slice(0, a + begin.length) + embedded.split('\n').map(line => line ? '    ' + line : '').join('\n') + '\n' + app.slice(b);
  if (args.includes('--check')) { if (app !== next) throw new Error('Embedded Markdown runtime is stale'); }
  else fs.writeFileSync(appFile, next);
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, JSON.stringify({ tool: pin, scope: 'Only Markdown helper/parser bundled; existing app/recovery code is NOT rebundled', parser_input_sha256: hash(fs.readFileSync(vendor)), notices_sha256: hash(Buffer.from(notices)), renderer_input_sha256: hash(fs.readFileSync(path.join(root, 'tools/markdown/render.mjs'))), runtime_sha256: hash(Buffer.from(outputs[0])), embedded_app_sha256: hash(Buffer.from(next)), embedded_app_bytes: Buffer.byteLength(next), deterministic_two_builds: true, runtime_external_imports: [], no_download_install_lifecycle_or_network: true, check: args.includes('--check'), metadata: metadata[0] }, null, 2) + '\n');
  console.log(JSON.stringify({ app_sha256: hash(Buffer.from(next)), app_bytes: Buffer.byteLength(next), deterministic_two_builds: true, check: args.includes('--check') }));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
