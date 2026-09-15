import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import app from '../src/index.js';

test('iOS 27 页面存在且内联脚本可解析', async () => {
  const response = await app.request('/ios27');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('WLOC · iOS 27 CoreDevice'));
  assert.ok(html.includes('location.set'));
  assert.ok(!html.includes("const SAVE_API = 'https://gs-loc.apple.com/wloc-settings/save'"));
  assert.ok(!html.includes("fetch(SAVE_API"));
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(x => x[1])
    .filter(x => x.trim());
  assert.ok(scripts.length > 0);
  for (const script of scripts) new vm.Script(script);
});

test('iOS 27 capabilities 明确 transport 仍为必需', async () => {
  const response = await app.request('/api/ios27/capabilities');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.coreDeviceFrontend, true);
  assert.equal(data.browserRawTcp, false);
  assert.equal(data.transportRequired, true);
  assert.equal(data.localDevVPNRole, 'device-tunnel-only');
  assert.deepEqual(data.coreDevicePath, ['RemotePairing', 'RSD', 'DVT', 'LocationSimulation']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
