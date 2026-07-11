# Remembered Folder Reconnect Design

## Goal

Let a returning user reconnect the previously selected Cube folder with one click instead of opening the directory picker again.

## Behavior

- Continue storing the `FileSystemDirectoryHandle` in IndexedDB.
- On startup, load the saved handle and query read/write permission.
- If permission is already granted, restore directory mode automatically as today.
- If permission is `prompt`, keep the handle and show `重新连接文件夹` on the primary folder button.
- Clicking that button requests read/write permission for the remembered handle. The permission request is user-triggered and therefore allowed by Chromium.
- After permission is granted, load `cube-data.json`, `price-history.json`, and `change-log.json`, enter directory mode, and show normal connected controls.
- If permission is denied or the handle is invalid, retain browser-mirror data and show a clear error. Do not overwrite files or discard the remembered handle.
- When directory mode is already connected, the same button continues to mean `更换 Cube 文件夹` and opens the directory picker.
- Explicit `断开文件夹` continues to clear the remembered handle.

## Implementation Boundary

- Extract restoration of an already-authorized handle into a shared helper used by startup restoration and click-driven reconnection.
- Do not request permission automatically during page load.
- Do not change persistence formats or local-server behavior.

## Testing

- Integration tests assert the reconnect label and click routing.
- Workspace permission tests remain unchanged.
- Browser verification covers remembered-handle prompt, successful reconnect, and connected button labels where the browser permits reproducing the permission state.
