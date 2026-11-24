# Google 二维码降级短信助手（本地网页版）

把 Google 桌面端强制跨设备扫码验证（`/challenge/iap/qrcode`）降级回传统的
「输入手机号接收 6 位短信验证码」流程——**不装浏览器扩展**，改用一个只跑在
你本机的网页服务，通过 Chrome 调试协议（CDP）驱动你自己的 Chrome 完成。

本项目是 [havenicec/google-qr-sms-helper](https://github.com/havenicec/google-qr-sms-helper)
（Chrome 扩展，MIT）的**换形态复刻**：降级原理与 RPC 逻辑沿用原项目
（见 [NOTICE](NOTICE)），交付方式从扩展换成「本地网页 + CDP」。

## 为什么不能做成在线网页服务

这个技巧有三根支柱长在用户自己的浏览器里，托管服务端一根都拿不到：

1. 降级的 batchexecute RPC 必须挂在**你本人正在进行的登录会话**上
   （cookie + 页面里现抠的 `SNlM0e / dsh / tl` 令牌）；
2. RPC 响应轮换的会话 cookie 必须落回**你的浏览器**，后续跳转才对得上；
3. 跳转选择页、乃至提交 6 位码的请求，都必须持续以 iPad 身份发出且
   不能带 `Sec-CH-UA*`——只有控制浏览器本身（扩展或 CDP）才能做到。

所以本项目的形态是：服务跑在你本机，浏览器还是你自己的 Chrome，
只是「装扩展」换成「开一个本地网页点按钮」。

## 原理对应关系

| 扩展版机制 | 本项目等价实现 |
| --- | --- |
| DNR 规则：accounts.google.com 全域改 iPad Mini UA、删 `Sec-CH-UA*` | CDP `Fetch` 域拦截每个请求后改写请求头（`lib/spoof.js`） |
| DNR 规则 2：`/devicephoneverification/*` 用 iPhone UA | 同上，按 URL 分支选择 UA（单测覆盖） |
| `ua_spoof.js`（MAIN world 改 navigator） | `Page.addScriptToEvaluateOnNewDocument` 注入同一套属性改写，并立即补丁当前文档 |
| content.js 解码二维码（BarcodeDetector） | 页面内 agent 同逻辑解码（`lib/page-agent.js`） |
| background.js 发 MypxBd / consent / YDtwf、校验 `[3,null,4]` | 同一段逻辑在二维码页上下文里直接执行（同源、带本页 cookie） |
| content.js 拼 `idv_xdevice=1` 跳选择页 | agent 返回目标 URL，服务端用 `Page.navigate` 跳转 |

降级完成后 CDP 会话**保持附加**，选择页和提交验证码期间继续以 iPad
身份发请求（与扩展的常开规则等价）；点「释放伪装」或关闭标签页后解除。

## 环境要求

- Node.js ≥ 22（用到全局 WebSocket / fetch；**零 npm 依赖**，无需 `npm install`）
- Chrome 或 Edge（需要原生 `BarcodeDetector` 与远程调试端口）

## 使用

```bash
git clone https://github.com/hys550663898/google-qr-sms-web.git
cd google-qr-sms-web
node server.js
# 浏览器打开 http://127.0.0.1:8787
```

1. **用调试端口启动一个 Chrome**（先退出已打开的 Chrome；务必用独立的
   临时用户目录，不要用日常主力配置）：

   Windows：
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug-qr"
   ```
   macOS：
   ```
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-qr
   ```
   Linux：
   ```
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-qr
   ```

2. 在这个 Chrome 里登录 Google 账号，走到二维码页。推荐入口与扩展版
   一致：先打开 Cloud Console，在本工具页对 Cloud Console 标签页点
   「唤起 Cloud Shell 验证」，弹出二维码页后再对**二维码页**点
   「⚡ 一键降级到短信选择框」；普通登录卡住的二维码页也可以直接降级。

3. 跳到验证方式选择页后，勾选短信、填手机号、收 `G-xxxxxx` 完成验证。

4. 验证完成后，回到本工具页点「释放伪装」，并关闭这个调试 Chrome。

## 与扩展版的已知差异

- 改头是**按标签页**附加的，不是浏览器全局的：降级过程中新开的标签页
  需要单独点一次降级才会附加；已附加的标签页全程保持。
- 扩展在浏览器启动时即生效；本工具需要先启动服务、再点按钮，QR 页
  首次加载可能发生在附加之前（不影响降级本身：起作用的 RPC 与跳转后
  的请求都在附加之后）。
- 不会自动跨标签页追踪；服务关掉即解除全部附加。

## 安全说明

- 服务只监听 `127.0.0.1`，不落盘、不收集任何数据；除你的 Chrome 自己
  发往 Google 的请求外，没有任何对外流量。代码零依赖，可直接审计。
- **调试端口 = 本机任意程序都能控制这个 Chrome**。只用临时用户目录、
  只在操作期间开启、用完关闭，是使用本工具的前提。
- 本工具只改变验证方式的选择，不读取、不转发你的短信验证码；请只在
  你自己的账号上使用。高频反复触发可能被 Google 风控标记。

## 测试

```bash
npm test   # 请求头改写逻辑单测（node:test，4 条）
```

CDP 冒烟测试（对真实 Chromium 验证改头、navigator 注入与释放，
不访问 Google）：

```bash
npx -y @puppeteer/browsers install chrome-headless-shell@stable
CHROME_BIN=/path/to/chrome-headless-shell node test/cdp-smoke.mjs
```

验证状态（v0.1.0）：单测与 CDP 冒烟测试均通过；**对真实 Google 账号的
降级全流程未由作者实测**（需要一个正卡在二维码页的账号），其 RPC 逻辑
与已广泛使用的扩展版同源。

## 许可

MIT。基于 havenicec/google-qr-sms-helper（MIT）的改编部分见
[NOTICE](NOTICE) 与 [LICENSE](LICENSE)。
