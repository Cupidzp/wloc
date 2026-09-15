# WLOC iOS 27 CoreDevice 路线

> 状态：实验性架构，尚未宣称真机可用。目标是不再依赖 `gs-loc.apple.com` MITM。

## 目标约束

新版路线以这些约束为设计目标：

- iOS 27 正式版；
- 不安装 Roam Control / Locus 一类额外定位 IPA；
- 不插 USB；
- 不依赖电脑与 iPhone 位于同一局域网；
- 可以安装并启用 LocalDevVPN；
- 继续复用 WLOC 的网页选点、链接解析、坐标系转换、收藏和快捷指令入口。

## 为什么旧链路不能作为 iOS 27 后端

旧 WLOC 的写入与定位链路是：

```text
网页
  -> https://gs-loc.apple.com/wloc-settings/save
  -> 代理脚本保存 wloc_settings
  -> MITM /clls/wloc 响应
  -> locationd 消费被修改的网络定位结果
```

这个模式继续作为 legacy backend 保留，但 iOS 27 CoreDevice 页面不得自动回退到它。这样真机失败时能够看到真正的 transport 错误，而不是出现“网页显示保存成功但系统定位没变”的假阳性。

## 新链路

Roam-Control 已经验证的目标协议路径是：

```text
RemotePairing
  -> pair verify
  -> TLS-PSK tunnel
  -> RSD
  -> DVT RemoteServer
  -> LocationSimulation.set(latitude, longitude)
```

恢复真实位置使用 `LocationSimulation.clear()`。

LocalDevVPN 在这里的角色仅是 **device tunnel**。它可以让本机原生程序访问 iPhone 的 RemotePairing/CoreDevice 服务，但它本身不执行 `LocationSimulation`。

## 当前缺口：Browser Transport

Safari 没有 WLOC 所需的 raw TCP socket 和 Bonjour/mDNS service browse API。因此仅有：

```text
Safari + LocalDevVPN
```

还不足以完成：

```text
Safari -> RemotePairing -> RSD -> DVT
```

新版网页先固定 transport 接口，后续可替换实现，而不重新设计选点 UI。

## Transport v1

浏览器侧使用 WebSocket，控制帧为 JSON；后续 raw TCP 数据帧保留二进制 WebSocket frame。

### 请求

```json
{
  "v": 1,
  "id": "wloc-abc-1",
  "method": "transport.capabilities",
  "params": {}
}
```

### 成功响应

```json
{
  "v": 1,
  "id": "wloc-abc-1",
  "ok": true,
  "result": {}
}
```

### 失败响应

```json
{
  "v": 1,
  "id": "wloc-abc-1",
  "ok": false,
  "error": "reason"
}
```

第一阶段保留的方法名：

- `transport.capabilities`
- `location.set { latitude, longitude }`
- `location.clear`

**注意：** 上述 `location.*` 只是前端 RPC 契约，不能把 CoreDevice 配对凭据上传到 Cloudflare。最终实现若把 `idevice` 协议引擎搬进浏览器/WASM，应进一步把接口下沉为 `service.browse`、`tcp.open`、raw binary frame、`tcp.close`，使 transport 只负责网络通道而不持有 pairing record。

## 安全边界

以下内容必须只保存在设备本地执行环境，不得写入 Cloudflare Worker、日志、Analytics 或 URL：

- Remote Pairing record；
- AltIRK；
- TLS-PSK / encryption key；
- 设备配对私钥；
- 未脱敏的 CoreDevice 身份信息。

Worker 继续只承担静态页面、地图链接解析和不含配对秘密的能力描述。

## 分阶段实施

### Phase 1 — 已在 `ios27-coredevice` 分支落地

- `/ios27` 独立入口；
- 与旧 `SAVE_API` 完全解耦；
- `/api/ios27/capabilities` 能力接口；
- transport 地址保存在浏览器 `localStorage`；
- `location.set` / `location.clear` RPC 前端；
- 无 transport 时明确失败，不伪装成功。

### Phase 2 — transport PoC

必须在 iOS 27 真机验证：

1. LocalDevVPN 开启后 RemotePairing 服务是否可从目标 transport 访问；
2. transport 能否发现 `_remotepairing._tcp` 以及 TXT 中的 `identifier` / `authTag`；
3. WebSocket 二进制帧能否无损桥接 TCP；
4. Safari 对本地 `ws://` / `wss://` 的安全策略是否满足部署方式。

### Phase 3 — CoreDevice engine

优先复用 Roam-Control 已验证的 `idevice` 逻辑，但要把 `tokio::net::TcpStream` 从协议逻辑中抽象出来，使它可以接浏览器 transport。目标调用仍是：

```text
LocationSimulationClient::new(...)
location.set(lat, lon)
location.clear()
```

### Phase 4 — 接回完整 WLOC 选点 UI

等 Phase 2/3 真机打通后，再把旧页面的地图、收藏、搜索、快捷指令直接切换到新 backend。不要在 transport 未打通前改掉 legacy 首页。

## 当前判定

这条分支现在是“可测试的前端协议骨架”，不是完成品。它解决了代码结构问题：iOS 27 路线已经不再绑定 `gs-loc`，并且把剩余阻塞压缩成一个明确的 Browser Transport 问题。
