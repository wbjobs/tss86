const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getWindows: () => ipcRenderer.invoke("get-windows"),
  startCapture: (windowHandle) => ipcRenderer.invoke("start-capture", windowHandle),
  stopCapture: () => ipcRenderer.invoke("stop-capture"),
  getMdPath: () => ipcRenderer.invoke("get-md-path"),
  setMdPath: (path) => ipcRenderer.invoke("set-md-path", path),
  getMdContent: () => ipcRenderer.invoke("get-md-content"),
  getNextSnapshot: () => ipcRenderer.invoke("get-next-snapshot"),

  onOcrResult: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("ocr-result", handler);
    return () => ipcRenderer.removeListener("ocr-result", handler);
  },
  onScreenshotPreview: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("screenshot-preview", handler);
    return () => ipcRenderer.removeListener("screenshot-preview", handler);
  },
  onOcrError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("ocr-error", handler);
    return () => ipcRenderer.removeListener("ocr-error", handler);
  },
  onMdUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("md-updated", handler);
    return () => ipcRenderer.removeListener("md-updated", handler);
  },
  onStatusChange: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("status-change", handler);
    return () => ipcRenderer.removeListener("status-change", handler);
  },
  onDiffResult: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("diff-result", handler);
    return () => ipcRenderer.removeListener("diff-result", handler);
  },
  onSnapshotSaved: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("snapshot-saved", handler);
    return () => ipcRenderer.removeListener("snapshot-saved", handler);
  },
});
