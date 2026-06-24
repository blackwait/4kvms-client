#!/usr/bin/env zsh
set -e
cd "$(dirname "$0")"

# 安装依赖（node_modules 不存在时）
if [ ! -d node_modules ]; then
  echo "📦 安装依赖..."
  npm install
fi

echo "🚀 启动 4kvms 客户端..."
node server.js &
SERVER_PID=$!

# 等待端口 3000 就绪
for i in $(seq 1 20); do
  sleep 0.3
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
done

open http://localhost:3000
echo "✅ 已打开 http://localhost:3000 (PID: $SERVER_PID)"
echo "按 Ctrl+C 停止服务"

wait $SERVER_PID
