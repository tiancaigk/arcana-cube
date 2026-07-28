#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
CACHE_DIR="${PROJECT_DIR}/.cache"
ACTIVE_PORT_FILE="${CACHE_DIR}/local-server-active-port"
START_PORT="${PORT:-4173}"
PORT_SEARCH_LIMIT=20
PORT_IS_EXPLICIT=0
[[ -n "${PORT:-}" ]] && PORT_IS_EXPLICIT=1

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

is_arcana_cube() {
  local url="$1"
  curl -fsS --max-time 1 "${url}" 2>/dev/null | grep -q "<title>Arcana Cube</title>"
}

if [[ -z "${PORT:-}" && -f "${ACTIVE_PORT_FILE}" ]]; then
  SAVED_PORT="$(cat "${ACTIVE_PORT_FILE}" 2>/dev/null || true)"
  if [[ "${SAVED_PORT}" == <-> ]]; then
    SAVED_URL="http://127.0.0.1:${SAVED_PORT}/"
    if is_arcana_cube "${SAVED_URL}"; then
      PORT="${SAVED_PORT}"
      URL="${SAVED_URL}"
      echo "Arcana Cube 已在运行，正在打开 ${URL}"
      open_cube
      exit 0
    fi
  fi
  rm -f "${ACTIVE_PORT_FILE}"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js，再重新双击此文件。"
  pause_on_error
  exit 1
fi

PORT=""
END_PORT=$(( START_PORT + PORT_SEARCH_LIMIT ))
(( PORT_IS_EXPLICIT )) && END_PORT="${START_PORT}"

for (( candidate = START_PORT; candidate <= END_PORT; candidate++ )); do
  candidate_url="http://127.0.0.1:${candidate}/"
  if is_arcana_cube "${candidate_url}"; then
    PORT="${candidate}"
    URL="${candidate_url}"
    echo "${PORT}" >"${ACTIVE_PORT_FILE}"
    echo "Arcana Cube 已在运行，正在打开 ${URL}"
    open_cube
    exit 0
  fi
  if ! lsof -nP -iTCP:"${candidate}" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="${candidate}"
    URL="${candidate_url}"
    break
  fi
done

if [[ -z "${PORT}" ]]; then
  if (( PORT_IS_EXPLICIT )); then
    echo "指定端口 ${START_PORT} 已被其他程序占用，Arcana Cube 无法启动。"
  else
    echo "端口 ${START_PORT}–${END_PORT} 均被占用，Arcana Cube 无法启动。"
  fi
  pause_on_error
  exit 1
fi

if (( PORT != START_PORT )); then
  echo "端口 ${START_PORT} 已被其他程序占用，改用端口 ${PORT}。"
fi

PID_FILE="${CACHE_DIR}/local-server-${PORT}.pid"
LOG_FILE="${CACHE_DIR}/local-server-${PORT}.log"

echo "正在启动 Arcana Cube..."
nohup env HOST=127.0.0.1 PORT="${PORT}" node scripts/local-server.js >"${LOG_FILE}" 2>&1 </dev/null &
SERVER_PID=$!
echo "${SERVER_PID}" >"${PID_FILE}"

for _ in {1..50}; do
  if is_arcana_cube "${URL}"; then
    echo "${PORT}" >"${ACTIVE_PORT_FILE}"
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
rm -f "${ACTIVE_PORT_FILE}"
pause_on_error
exit 1
