const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const { getWindows } = require("./window-utils");

let mainWindow = null;
let workerProcess = null;
let isCapturing = false;
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
    workerProcess.kill();
  }

  workerProcess = fork(path.join(__dirname, "worker.js"));

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
    }
  });

  workerProcess.on("exit", (code) => {
    if (isCapturing && code !== 0) {
      console.error("Worker exited unexpectedly, code:", code);
    }
    workerProcess = null;
  });

  workerProcess.send({ type: "start", windowHandle });
  isCapturing = true;
}

function stopCapture() {
  isCapturing = false;
  if (workerProcess) {
    workerProcess.send({ type: "stop" });
    setTimeout(() => {
      if (workerProcess) {
        workerProcess.kill();
        workerProcess = null;
      }
    }, 2000);
  }
}

function appendToMarkdown(text) {
  if (!text || !text.trim()) return;

  const timestamp = new Date().toLocaleString("zh-CN");
  const content = `\n## ${timestamp}\n\n${text.trim()}\n`;

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
