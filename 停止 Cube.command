#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
CACHE_DIR="${PROJECT_DIR}/.cache"
ACTIVE_PORT_FILE="${CACHE_DIR}/local-server-active-port"

if [[ -n "${PORT:-}" ]]; then
  TARGET_PORT="${PORT}"
elif [[ -f "${ACTIVE_PORT_FILE}" ]]; then
  TARGET_PORT="$(cat "${ACTIVE_PORT_FILE}" 2>/dev/null || true)"
else
  TARGET_PORT="4173"
fi

if [[ "${TARGET_PORT}" != <-> ]]; then
  TARGET_PORT="4173"
fi

PORT="${TARGET_PORT}"
PID_FILE="${PROJECT_DIR}/.cache/local-server-${PORT}.pid"
STOPPED=0

stop_pid() {
  local pid="$1"
  local command_line
  local working_dir
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  working_dir="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ "${command_line}" == *"scripts/local-server.js"* && "${working_dir}" == "${PROJECT_DIR}" ]]; then
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

rm -f "${ACTIVE_PORT_FILE}"

if [[ "${STOPPED}" == "1" ]]; then
  echo "Arcana Cube 本地服务器（端口 ${PORT}）已停止。"
else
  echo "Arcana Cube 本地服务器当前没有运行。"
fi

sleep 1
