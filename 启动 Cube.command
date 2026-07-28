#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"
CACHE_DIR="${PROJECT_DIR}/.cache"
PID_FILE="${CACHE_DIR}/local-server-${PORT}.pid"
LOG_FILE="${CACHE_DIR}/local-server-${PORT}.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
cd "${PROJECT_DIR}" || exit 1
mkdir -p "${CACHE_DIR}"

pause_on_error() {
  printf "\n按任意键关闭窗口..."
  read -k 1
  printf "\n"
}

open_cube() {
  if [[ "${CUBE_NO_OPEN:-0}" == "1" ]]; then
    return
  fi
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -a "Google Chrome" "${URL}"
  else
    open "${URL}"
  fi
}

if curl -fsS --max-time 1 "${URL}" 2>/dev/null | grep -q "<title>Arcana Cube</title>"; then
  echo "Arcana Cube 已在运行，正在打开 ${URL}"
  open_cube
  exit 0
fi

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 ${PORT} 已被其他程序占用，Arcana Cube 无法启动。"
  pause_on_error
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js，再重新双击此文件。"
  pause_on_error
  exit 1
fi

echo "正在启动 Arcana Cube..."
nohup env HOST=127.0.0.1 PORT="${PORT}" node scripts/local-server.js >"${LOG_FILE}" 2>&1 </dev/null &
SERVER_PID=$!
echo "${SERVER_PID}" >"${PID_FILE}"

for _ in {1..50}; do
  if curl -fsS --max-time 1 "${URL}" 2>/dev/null | grep -q "<title>Arcana Cube</title>"; then
    echo "启动成功，正在打开 ${URL}"
    open_cube
    exit 0
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

echo "Arcana Cube 启动失败。日志位置：${LOG_FILE}"
tail -n 12 "${LOG_FILE}" 2>/dev/null
rm -f "${PID_FILE}"
pause_on_error
exit 1
