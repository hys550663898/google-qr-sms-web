#!/bin/bash
# google-qr-sms-web 一键启动（macOS，Intel / Apple 芯片通用）
# 双击运行：自动启动本地服务 + 带调试端口的 Chrome，并打开工具页。
# 用完后：关闭这个终端窗口（服务随之停止），再关掉那个 Chrome。

cd "$(dirname "$0")" || exit 1

echo "=== Google 二维码降级短信助手（本地网页版）==="

# 1) 检查 Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "未检测到 Node.js，请先安装 Node 22 或更高版本："
  echo "  方式一（官方安装包，自动适配 Apple 芯片）：https://nodejs.org/zh-cn/download"
  echo "  方式二（Homebrew）：brew install node"
  echo "装好后重新双击本脚本。"
  echo
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo
  echo "Node 版本过低：当前 $(node --version)，需要 >= 22。请升级后重新双击本脚本。"
  echo
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi
echo "Node $(node --version) OK"

# 2) 启动本地服务（后台，绑定 127.0.0.1:8787）
PORT=8787
node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

READY=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    READY=1
    break
  fi
  sleep 0.3
done
if [ "$READY" != "1" ]; then
  echo "本地服务启动失败（端口 $PORT 可能被占用），请关掉占用程序后重试。"
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi
echo "本地服务已启动：http://127.0.0.1:$PORT"

# 3) 用调试端口启动 Chrome（独立用户目录，与日常 Chrome 互不影响）
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo
  echo "未在 /Applications 找到 Google Chrome，请先安装 Chrome 后重试。"
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi
PROFILE="$HOME/.google-qr-sms-web/chrome-profile"
mkdir -p "$PROFILE"
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$PROFILE" \
  "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &

echo
echo "已打开带调试端口的 Chrome。接下来："
echo "  1. 在这个 Chrome 里新开标签页，登录 Google 账号并走到二维码页"
echo "     （推荐入口：console.cloud.google.com，然后回工具页点「唤起 Cloud Shell 验证」）"
echo "  2. 切回工具页标签，对二维码页点「⚡ 一键降级到短信选择框」"
echo "  3. 在选择页勾选短信、填手机号、输验证码完成验证"
echo "  4. 回工具页点「释放伪装」，然后关闭这个 Chrome 和本终端窗口"
echo
echo "保持本窗口开着（服务在运行）。按 Ctrl+C 或直接关窗口即停止服务。"
wait $SERVER_PID
