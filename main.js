const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const { getWindows } = require("./window-utils");

const MAX_RESTART_ATTEMPTS = 5;
const RESET_RESTART_DELAY = 30000;

let mainWindow = null;
let workerProcess = null;
let isCapturing = false;
let currentWindowHandle = null;
let restartCount = 0;
let lastRestartTime = 0;
let restartTimer = null;
let mdFilePath = path.join(app.getPath("desktop"), "ocr-output.md");

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

function startWorker(windowHandle) {
  if (workerProcess) {
    try {
      workerProcess.kill();
    } catch {}
    workerProcess = null;
  }

  workerProcess = fork(path.join(__dirname, "worker.js"));
  currentWindowHandle = windowHandle;

  workerProcess.on("message", (msg) => {
    if (msg.type === "ocr-result") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("ocr-result", msg.data);
      }
      appendToMarkdown(msg.data.text);
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
}

function handleWorkerCrash() {
  const now = Date.now();

  if (now - lastRestartTime > RESET_RESTART_DELAY) {
    restartCount = 0;
  }

  if (restartCount >= MAX_RESTART_ATTEMPTS) {
    console.error("Max restart attempts reached, stopping capture");
    isCapturing = false;
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

function appendToMarkdown(text) {
  if (!text || typeof text !== "string") return;

  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return;

  if (trimmed.replace(/\s+/g, "").length < 2) return;

  const timestamp = new Date().toLocaleString("zh-CN");
  const content = `\n## ${timestamp}\n\n${trimmed}\n`;

  try {
    if (!fs.existsSync(mdFilePath)) {
      fs.writeFileSync(mdFilePath, "# OCR Capture Log\n", "utf-8");
    }
    fs.appendFileSync(mdFilePath, content, "utf-8");

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("md-updated", mdFilePath);
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
  startWorker(windowHandle);
  return { success: true };
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopCapture();
  app.quit();
});

app.on("before-quit", () => {
  stopCapture();
});
