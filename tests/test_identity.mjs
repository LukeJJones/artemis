import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ENTRY_PATH, UI_PATH, CONNECTION_PATH, OPEN_CONFIG_PATH, OPEN_QR_PATH, signInTargets, checkHermesSignIn } from '../dashboard/assets/signin.mjs';
const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const old = 'artemis-owner-proof';
test('manifest, dashboard tab, package version and SDK registry share the renamed identity', () => {
  assert.match(read('plugin.yaml'), /^name: artemis\r?$/m);
  assert.match(read('plugin.yaml'), /^version: 0\.0\.4\r?$/m);
  assert.match(read('plugin.yaml'), /^author: Matterweave Studio\r?$/m);
  assert.match(read('plugin.yaml'), /requires_hermes: '>=0\.23\.0'/);
  const manifest = JSON.parse(read('dashboard/manifest.json'));
  assert.equal(manifest.name, 'artemis'); assert.equal(manifest.tab.path, '/artemis');
  assert.equal(manifest.version, '0.0.4'); assert.equal(JSON.parse(read('package.json')).version, manifest.version);
  const registered = [], element = (tag, props, ...children) => ({ tag, props, children });
  vm.runInNewContext(read('dashboard/dist/index.js'), { window: { __HERMES_PLUGIN_SDK__: { React: { createElement: element } }, __HERMES_PLUGINS__: { register: (id, component) => registered.push([id, component()]) } } });
  assert.equal(registered.length, 1); assert.equal(registered[0][0], 'artemis');
  assert.equal(registered[0][1].children[0].children[0], 'Artemis');
});
test('all opening, private API and optional asset constants use the new supported namespace', () => {
  assert.equal(ENTRY_PATH, '/dashboard-plugins/artemis/open.html');
  assert.equal(UI_PATH, '/api/plugins/artemis/ui'); assert.equal(CONNECTION_PATH, '/api/plugins/artemis/connection');
  for (const p of [OPEN_CONFIG_PATH, OPEN_QR_PATH]) assert.ok(p.startsWith('/dashboard-plugins/artemis/'));
  for (const file of ['dashboard/open.html', 'dashboard/assets/index.html', 'dashboard/assets/app.mjs', 'dashboard/assets/signin.mjs', 'dashboard/dist/index.js']) assert.ok(!read(file).includes(old), file);
  assert.match(read('dashboard/assets/index.html'), /src="\/dashboard-plugins\/artemis\/assets\/app\.mjs"/);
  assert.match(read('dashboard/assets/app.mjs'), /new URL\('\/api\/plugins\/artemis\/connection', location.origin\)/);
});
test('login return and private UI preserve host, profile and view with the new entry only', () => {
  const targets = signInTargets('https://host.invalid:9443' + UI_PATH + '?artemis_profile=wash#view=chat');
  const login = new URL(targets.login), ui = new URL(targets.ui);
  assert.equal(login.origin, 'https://host.invalid:9443'); assert.equal(login.pathname, '/login');
  assert.equal(login.searchParams.get('next'), ENTRY_PATH + '?artemis_profile=wash&resume=1#view=chat');
  assert.equal(ui.pathname, UI_PATH); assert.equal(ui.searchParams.get('artemis_profile'), 'wash'); assert.equal(ui.hash, '#view=chat');
  assert.equal(targets.resume, true);
});
for (const value of ['https://host.invalid/dashboard-plugins/' + old + '/open.html', 'https://host.invalid/api/plugins/' + old + '/ui', 'https://host.invalid/dashboard-plugins/artemis', 'https://host.invalid/dashboard-plugins/artemis/', 'http://host.invalid' + ENTRY_PATH, 'https://user:secret@host.invalid' + ENTRY_PATH]) {
  test('old/unsupported/unsafe entry is refused without alias or transport: ' + value.replace('user:secret@', '[synthetic]@'), () => assert.throws(() => signInTargets(value)));
}
test('sign-in check uses only the new same-origin metadata route and preserves the owner protocol', async () => {
  const calls = [];
  assert.equal(await checkHermesSignIn('https://host.invalid', async (url, options) => { calls.push([url.href, options]); return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ authority: 'owner', protocol: 'artemis-owner-routing-v1' }) }; }), true);
  assert.equal(calls[0][0], 'https://host.invalid' + CONNECTION_PATH); assert.equal(calls[0][1].credentials, 'same-origin'); assert.equal(calls[0][1].redirect, 'error');
});
test('auth rejection is not a migration, automatic retry or blind resend', async () => {
  let calls = 0;
  assert.equal(await checkHermesSignIn('https://host.invalid', async () => { calls++; return { status: 401 }; }), false);
  assert.equal(calls, 1);
});
