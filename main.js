const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const { getWindows } = require("./window-utils");
const { diffLines, formatDiffForMarkdown } = require("./diff-utils");

const MAX_RESTART_ATTEMPTS = 5;
const RESET_RESTART_DELAY = 30000;
const SNAPSHOT_INTERVAL = 5 * 60 * 1000;

let mainWindow = null;
let workerProcess = null;
let isCapturing = false;
let currentWindowHandle = null;
let restartCount = 0;
let lastRestartTime = 0;
let restartTimer = null;
let snapshotTimer = null;
let lastSnapshotTime = 0;
let mdFilePath = path.join(app.getPath("desktop"), "ocr-output.md");
let lastOcrText = "";

function getScreenshotsDir() {
  const mdDir = path.dirname(mdFilePath);
  const dir = path.join(mdDir, "screenshots");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: "Window OCR Capture",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("closed", () => {
    stopCapture();
    mainWindow = null;
  });
}

function requestSnapshot() {
  if (workerProcess && isCapturing) {
    workerProcess.send({ type: "snapshot" });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("status-change", { status: "snapshot", message: "正在保存快照..." });
    }
  }
}

function startSnapshotTimer() {
  stopSnapshotTimer();
  lastSnapshotTime = Date.now();
  snapshotTimer = setInterval(() => {
    if (isCapturing) {
      requestSnapshot();
    }
  }, SNAPSHOT_INTERVAL);
}

function stopSnapshotTimer() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  lastSnapshotTime = 0;
}

function getNextSnapshotTime() {
  if (!snapshotTimer || lastSnapshotTime === 0) return null;
  return lastSnapshotTime + SNAPSHOT_INTERVAL;
}

function saveSnapshot(base64Buffer, timestamp) {
  try {
    const buffer = Buffer.from(base64Buffer, "base64");
    const dir = getScreenshotsDir();
    const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `snapshot_${dateStr}.png`;
    const fullPath = path.join(dir, filename);

    fs.writeFileSync(fullPath, buffer);

    const mdDir = path.dirname(mdFilePath);
    const relPath = path.relative(mdDir, fullPath).replace(/\\/g, "/");

    const timeStr = new Date(timestamp).toLocaleString("zh-CN");
    const mdContent = `\n## ${timeStr} [快照]\n\n![窗口快照](${relPath})\n`;

    if (!fs.existsSync(mdFilePath)) {
      fs.writeFileSync(mdFilePath, "# OCR Capture Log\n", "utf-8");
    }
    fs.appendFileSync(mdFilePath, mdContent, "utf-8");

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("snapshot-saved", {
        path: fullPath,
        relativePath: relPath,
        timestamp,
        nextSnapshot: getNextSnapshotTime(),
      });
    }

    return fullPath;
  } catch (err) {
    console.error("Failed to save snapshot:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ocr-error", { message: `保存快照失败: ${err.message}` });
    }
    return null;
  }
}

function startWorker(windowHandle) {
  if (workerProcess) {
    try {
      workerProcess.kill();
    } catch {}
    workerProcess = null;
  }

  lastOcrText = "";
  workerProcess = fork(path.join(__dirname, "worker.js"));
  currentWindowHandle = windowHandle;

  workerProcess.on("message", (msg) => {
    if (msg.type === "ocr-result") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("ocr-result", msg.data);
      }
      appendToMarkdown(msg.data.fullText || msg.data.text, msg.data.timestamp);
    } else if (msg.type === "screenshot-preview") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot-preview", msg.data);
      }
    } else if (msg.type === "ocr-error") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("ocr-error", msg.data);
      }
    } else if (msg.type === "status-change") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("status-change", msg.data);
      }
    } else if (msg.type === "snapshot-data") {
      const savedPath = saveSnapshot(msg.data.buffer, msg.data.timestamp);
      if (savedPath && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("md-updated", mdFilePath);
      }
    } else if (msg.type === "snapshot-failed") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("ocr-error", msg.data);
      }
    }
  });

  workerProcess.on("error", (err) => {
    console.error("Worker error:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ocr-error", { message: `Worker错误: ${err.message}` });
    }
  });

  workerProcess.on("exit", (code, signal) => {
    workerProcess = null;

    if (isCapturing && code !== 0 && code !== null) {
      console.error(`Worker exited unexpectedly, code: ${code}, signal: ${signal}, restart attempts: ${restartCount + 1}`);
      handleWorkerCrash();
    } else if (!isCapturing) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("status-change", { status: "stopped", message: "已停止" });
      }
    }
  });

  workerProcess.send({ type: "start", windowHandle });
  isCapturing = true;
  startSnapshotTimer();
}

function handleWorkerCrash() {
  const now = Date.now();

  if (now - lastRestartTime > RESET_RESTART_DELAY) {
    restartCount = 0;
  }

  if (restartCount >= MAX_RESTART_ATTEMPTS) {
    console.error("Max restart attempts reached, stopping capture");
    stopCapture();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ocr-error", { message: "子进程连续崩溃，已停止捕获，请重启应用" });
      mainWindow.webContents.send("status-change", { status: "stopped", message: "子进程崩溃，已停止" });
    }
    return;
  }

  restartCount++;
  lastRestartTime = now;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-change", {
      status: "restarting",
      message: `子进程崩溃，正在重启 (${restartCount}/${MAX_RESTART_ATTEMPTS})`,
    });
  }

  restartTimer = setTimeout(() => {
    if (isCapturing && currentWindowHandle) {
      startWorker(currentWindowHandle);
    }
  }, 2000);
}

function stopCapture() {
  isCapturing = false;
  currentWindowHandle = null;
  lastOcrText = "";
  stopSnapshotTimer();

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (workerProcess) {
    try {
      workerProcess.send({ type: "stop" });
      const killTimer = setTimeout(() => {
        if (workerProcess) {
          try {
            workerProcess.kill();
          } catch {}
          workerProcess = null;
        }
      }, 2000);

      workerProcess.once("exit", () => {
        clearTimeout(killTimer);
        workerProcess = null;
      });
    } catch {
      try {
        workerProcess.kill();
      } catch {}
      workerProcess = null;
    }
  }

  restartCount = 0;
  lastRestartTime = 0;
}

function appendToMarkdown(text, timestamp) {
  if (!text || typeof text !== "string") return;

  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return;

  if (trimmed.replace(/\s+/g, "").length < 2) return;

  const diffResult = diffLines(lastOcrText, trimmed);

  if (!diffResult.changed) {
    return;
  }

  const diffContent = formatDiffForMarkdown(diffResult);
  if (!diffContent) return;

  const timeStr = new Date(timestamp || Date.now()).toLocaleString("zh-CN");
  const header = `\n## ${timeStr}\n\n`;
  const content = header + diffContent + "\n";

  try {
    if (!fs.existsSync(mdFilePath)) {
      fs.writeFileSync(mdFilePath, "# OCR Capture Log\n", "utf-8");
    }
    fs.appendFileSync(mdFilePath, content, "utf-8");

    lastOcrText = trimmed;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("md-updated", mdFilePath);
      mainWindow.webContents.send("diff-result", {
        added: diffResult.added,
        removed: diffResult.removed,
        diff: diffResult.diff,
      });
    }
  } catch (err) {
    console.error("Failed to write markdown:", err);
  }
}

ipcMain.handle("get-windows", async () => {
  try {
    const windows = await getWindows();
    return windows.map((w) => ({
      id: w.handle,
      title: w.title,
      processId: w.processId,
      bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
      handle: w.handle,
    }));
  } catch (err) {
    console.error("Failed to get windows:", err);
    return [];
  }
});

ipcMain.handle("start-capture", async (event, windowHandle) => {
  restartCount = 0;
  lastRestartTime = 0;
  lastOcrText = "";
  startWorker(windowHandle);
  return { success: true, nextSnapshot: getNextSnapshotTime() };
});

ipcMain.handle("stop-capture", async () => {
  stopCapture();
  return { success: true };
});

ipcMain.handle("get-md-path", async () => {
  return mdFilePath;
});

ipcMain.handle("set-md-path", async (event, newPath) => {
  mdFilePath = newPath;
  return { success: true };
});

ipcMain.handle("get-md-content", async () => {
  try {
    if (fs.existsSync(mdFilePath)) {
      return fs.readFileSync(mdFilePath, "utf-8");
    }
    return "";
  } catch {
    return "";
  }
});

ipcMain.handle("get-next-snapshot", async () => {
  return getNextSnapshotTime();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopCapture();
  app.quit();
});

app.on("before-quit", () => {
  stopCapture();
});
