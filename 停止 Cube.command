#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
PORT="${PORT:-4173}"
PID_FILE="${PROJECT_DIR}/.cache/local-server-${PORT}.pid"
STOPPED=0

stop_pid() {
  local pid="$1"
  local command_line
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command_line}" == *"scripts/local-server.js"* ]]; then
    kill "${pid}" 2>/dev/null || true
    STOPPED=1
  fi
}

if [[ -f "${PID_FILE}" ]]; then
  SERVER_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ "${SERVER_PID}" == <-> ]]; then
    stop_pid "${SERVER_PID}"
  fi
  rm -f "${PID_FILE}"
fi

if [[ "${STOPPED}" == "0" ]]; then
  for SERVER_PID in ${(f)"$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null)"}; do
    [[ -n "${SERVER_PID}" ]] && stop_pid "${SERVER_PID}"
  done
fi

if [[ "${STOPPED}" == "1" ]]; then
  echo "Arcana Cube 本地服务器已停止。"
else
  echo "Arcana Cube 本地服务器当前没有运行。"
fi

sleep 1
