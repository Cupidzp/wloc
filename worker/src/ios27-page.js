import { SOURCE_URL } from "./project.js";

export function getIos27PageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>WLOC iOS 27 CoreDevice</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="WLOC 27">
<style>
:root { --blue:#007aff; --green:#34c759; --red:#ff3b30; --orange:#ff9500; --gray:#8e8e93; --bg:#f2f2f7; }
* { box-sizing:border-box; }
body { margin:0; font-family:-apple-system,system-ui,"SF Pro","Helvetica Neue",sans-serif; background:var(--bg); color:#111; }
main { max-width:640px; margin:0 auto; padding:18px 14px 48px; }
h1 { font-size:24px; margin:4px 0 6px; }
p { line-height:1.55; }
.card { background:#fff; border-radius:14px; padding:16px; margin-top:12px; box-shadow:0 1px 3px rgba(0,0,0,.07); }
.badge { display:inline-block; border-radius:999px; padding:4px 8px; font-size:12px; font-weight:600; background:#fff2d6; color:#8a5700; }
.badge.ok { background:#e6f8ea; color:#177a2f; }
.badge.bad { background:#ffe7e5; color:#a32119; }
.small { font-size:12px; color:var(--gray); }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
label { display:block; font-size:12px; color:var(--gray); margin-bottom:5px; }
input, select { width:100%; padding:11px 12px; border:1px solid #d1d1d6; border-radius:10px; font-size:15px; background:#fff; }
button { border:0; border-radius:10px; padding:11px 13px; font-size:14px; font-weight:600; cursor:pointer; }
.primary { background:var(--blue); color:#fff; }
.secondary { background:#e5e5ea; color:#222; }
.danger { background:var(--red); color:#fff; }
.row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.row button { flex:1; min-width:120px; }
pre { white-space:pre-wrap; word-break:break-word; margin:0; padding:12px; border-radius:10px; background:#111; color:#d7ffd7; font-size:12px; line-height:1.45; min-height:92px; }
.warn { border-left:4px solid var(--orange); padding-left:12px; }
code { font-family:"SF Mono",ui-monospace,monospace; }
a { color:var(--blue); }
</style>
</head>
<body>
<main>
  <span class="badge">实验分支</span>
  <h1>WLOC · iOS 27 CoreDevice</h1>
  <p class="small">目标：绕过已失效的 gs-loc MITM，改用 RemotePairing → RSD → DVT → LocationSimulation。</p>

  <section class="card warn">
    <b>当前阶段</b>
    <p>这个页面已经与旧 <code>gs-loc.apple.com/wloc-settings/save</code> 写入链路解耦，但还没有伪装成“已经能定位”。LocalDevVPN 只能提供设备侧通道；Safari 仍缺少 raw TCP / mDNS 能力，因此还需要一个浏览器可调用的 transport 才能真正进入 CoreDevice。</p>
  </section>

  <section class="card">
    <h3>运行能力</h3>
    <div id="caps">读取中...</div>
    <div class="row">
      <button class="secondary" onclick="loadCapabilities()">重新检测</button>
    </div>
  </section>

  <section class="card">
    <h3>目标坐标</h3>
    <div class="grid">
      <div>
        <label for="lat">纬度</label>
        <input id="lat" inputmode="decimal" value="34.052235">
      </div>
      <div>
        <label for="lon">经度</label>
        <input id="lon" inputmode="decimal" value="-118.243683">
      </div>
    </div>
    <div class="row">
      <button class="primary" onclick="setLocation()">设置位置</button>
      <button class="danger" onclick="clearLocation()">恢复真实位置</button>
    </div>
    <p class="small">按钮只会在检测到兼容 transport 后发送命令；没有 transport 时会明确报错，不会回退到旧 MITM。</p>
  </section>

  <section class="card">
    <h3>Transport</h3>
    <label for="transport">浏览器 transport 地址</label>
    <input id="transport" placeholder="例如 wss://127.0.0.1:8766/wloc">
    <div class="row">
      <button class="secondary" onclick="saveTransport()">保存地址</button>
      <button class="secondary" onclick="probeTransport()">测试连接</button>
    </div>
    <p class="small">协议约定见 <code>docs/IOS27-COREDEVICE.md</code>。这里先固定接口，后续 transport 可由 Clash Mi、LocalDevVPN 扩展或其它宿主实现，而不用重写网页。</p>
  </section>

  <section class="card">
    <h3>诊断日志</h3>
    <pre id="log">WLOC iOS 27 frontend ready.</pre>
  </section>

  <p class="small">源码：<a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">${SOURCE_URL}</a> · <a href="/">返回旧版 WLOC</a></p>
</main>
<script>
const TRANSPORT_KEY = 'wloc_ios27_transport';
const REQUEST_TIMEOUT_MS = 5000;
let socket = null;
let pending = new Map();
let requestSeq = 0;

function log(message) {
  const el = document.getElementById('log');
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12:false });
  el.textContent += '\\n[' + stamp + '] ' + message;
  el.scrollTop = el.scrollHeight;
}

function validateCoords(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('经纬度必须是数字');
  if (latitude < -90 || latitude > 90) throw new Error('纬度必须在 -90..90');
  if (longitude < -180 || longitude > 180) throw new Error('经度必须在 -180..180');
}

function transportUrl() {
  return document.getElementById('transport').value.trim();
}

function saveTransport() {
  const value = transportUrl();
  if (value) localStorage.setItem(TRANSPORT_KEY, value);
  else localStorage.removeItem(TRANSPORT_KEY);
  log(value ? '已保存 transport: ' + value : '已清除 transport');
}

function closeSocket() {
  if (socket) {
    try { socket.close(); } catch (_) {}
    socket = null;
  }
  for (const [, item] of pending) item.reject(new Error('transport disconnected'));
  pending.clear();
}

function connectTransport() {
  const url = transportUrl();
  if (!url) return Promise.reject(new Error('尚未配置 transport 地址'));
  if (!/^wss?:\\/\\//i.test(url)) return Promise.reject(new Error('transport 必须使用 ws:// 或 wss://'));
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  closeSocket();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('transport 连接超时'));
    }, REQUEST_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      socket = ws;
      log('transport WebSocket 已连接');
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('transport WebSocket 连接失败'));
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      for (const [, item] of pending) item.reject(new Error('transport disconnected'));
      pending.clear();
      log('transport 已断开');
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        log('收到二进制帧 ' + event.data.byteLength + ' bytes（预留给 raw transport）');
        return;
      }
      let message;
      try { message = JSON.parse(event.data); }
      catch (_) { log('收到无法解析的 transport 文本帧'); return; }
      if (!message || !message.id || !pending.has(message.id)) {
        log('transport event: ' + event.data);
        return;
      }
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.ok === false) item.reject(new Error(message.error || 'transport request failed'));
      else item.resolve(message.result ?? message);
    };
  });
}

async function transportRequest(method, params = {}) {
  const ws = await connectTransport();
  const id = 'wloc-' + Date.now().toString(36) + '-' + (++requestSeq).toString(36);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + ' 请求超时'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ v:1, id, method, params }));
  });
}

async function probeTransport() {
  try {
    const result = await transportRequest('transport.capabilities');
    log('transport capabilities: ' + JSON.stringify(result));
  } catch (error) {
    log('transport 检测失败: ' + error.message);
  }
}

async function setLocation() {
  try {
    const latitude = Number(document.getElementById('lat').value);
    const longitude = Number(document.getElementById('lon').value);
    validateCoords(latitude, longitude);
    const result = await transportRequest('location.set', { latitude, longitude });
    log('location.set 成功: ' + JSON.stringify(result));
  } catch (error) {
    log('设置失败: ' + error.message);
  }
}

async function clearLocation() {
  try {
    const result = await transportRequest('location.clear');
    log('location.clear 成功: ' + JSON.stringify(result));
  } catch (error) {
    log('恢复失败: ' + error.message);
  }
}

async function loadCapabilities() {
  const el = document.getElementById('caps');
  try {
    const response = await fetch('/api/ios27/capabilities', { cache:'no-store' });
    const data = await response.json();
    const rows = [
      ['旧 MITM', data.legacyMitm ? '保留' : '关闭'],
      ['CoreDevice 页面', data.coreDeviceFrontend ? '已启用' : '未启用'],
      ['LocalDevVPN', data.localDevVPNRole],
      ['浏览器 raw TCP', data.browserRawTcp ? '可用' : '不可用'],
      ['Transport', data.transportRequired ? '仍需要' : '不需要']
    ];
    el.innerHTML = rows.map(([k,v]) => '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><span>' + k + '</span><b>' + v + '</b></div>').join('');
  } catch (error) {
    el.textContent = '能力信息读取失败';
    log(error.message);
  }
}

document.getElementById('transport').value = localStorage.getItem(TRANSPORT_KEY) || '';
loadCapabilities();
<\/script>
</body>
</html>`;
}
