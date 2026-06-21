let selectedWindowHandle = null;
let isCapturing = false;
let captureCount = 0;
let startTime = 0;

const btnRefresh = document.getElementById("btn-refresh");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnClearText = document.getElementById("btn-clear-text");
const btnCopyText = document.getElementById("btn-copy-text");
const btnChangePath = document.getElementById("btn-change-path");
const windowList = document.getElementById("window-list");
const previewContainer = document.getElementById("preview-container");
const textContainer = document.getElementById("text-container");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const mdPathEl = document.getElementById("md-path");
const captureFps = document.getElementById("capture-fps");
const ocrStats = document.getElementById("ocr-stats");

async function loadWindows() {
  windowList.innerHTML = '<div class="placeholder"><p>加载中...</p></div>';
  try {
    const windows = await window.api.getWindows();
    windowList.innerHTML = "";

    if (windows.length === 0) {
      windowList.innerHTML = '<div class="placeholder"><p>未发现窗口</p></div>';
      return;
    }

    windows.forEach((win) => {
      const item = document.createElement("div");
      item.className = "window-item";
      if (win.handle === selectedWindowHandle) {
        item.classList.add("selected");
      }

      const icon = document.createElement("div");
      icon.className = "window-item-icon";
      icon.textContent = win.title.charAt(0).toUpperCase() || "?";

      const title = document.createElement("div");
      title.className = "window-item-title";
      title.textContent = win.title;
      title.title = `${win.title} (PID: ${win.processId})`;

      item.appendChild(icon);
      item.appendChild(title);

      item.addEventListener("click", () => {
        document.querySelectorAll(".window-item").forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");
        selectedWindowHandle = win.handle;
        btnStart.disabled = isCapturing;
      });

      windowList.appendChild(item);
    });
  } catch (err) {
    windowList.innerHTML = `<div class="placeholder"><p>加载失败: ${err.message}</p></div>`;
  }
}

async function loadMdPath() {
  const path = await window.api.getMdPath();
  mdPathEl.textContent = path;
}

function setStatus(running, text) {
  isCapturing = running;
  statusDot.className = running ? "status-dot running" : "status-dot";
  statusText.textContent = text;
  btnStart.disabled = running || !selectedWindowHandle;
  btnStop.disabled = !running;
}

function addOcrEntry(data) {
  if (textContainer.querySelector(".placeholder")) {
    textContainer.innerHTML = "";
  }

  const entry = document.createElement("div");
  entry.className = "ocr-entry";

  const time = document.createElement("div");
  time.className = "ocr-entry-time";
  time.textContent = new Date(data.timestamp).toLocaleTimeString("zh-CN");

  const text = document.createElement("div");
  text.className = "ocr-entry-text";
  text.textContent = data.text;

  const confidence = document.createElement("div");
  confidence.className = "ocr-entry-confidence";
  confidence.textContent = `置信度: ${data.confidence?.toFixed(1) || "N/A"}%`;

  entry.appendChild(time);
  entry.appendChild(text);
  entry.appendChild(confidence);

  textContainer.appendChild(entry);
  textContainer.scrollTop = textContainer.scrollHeight;

  captureCount++;
  if (startTime > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const fps = (captureCount / elapsed).toFixed(1);
    captureFps.textContent = `${fps} 次/秒`;
    ocrStats.innerHTML = `<span>已识别: ${captureCount} 次</span><span>运行时间: ${elapsed.toFixed(0)}s</span>`;
  }
}

btnRefresh.addEventListener("click", loadWindows);

btnStart.addEventListener("click", async () => {
  if (!selectedWindowHandle) return;

  captureCount = 0;
  startTime = Date.now();
  textContainer.innerHTML = "";
  captureFps.textContent = "";

  setStatus(true, "正在捕获...");
  await window.api.startCapture(selectedWindowHandle);
});

btnStop.addEventListener("click", async () => {
  await window.api.stopCapture();
  setStatus(false, "已停止");
  startTime = 0;
  captureFps.textContent = "";
});

btnClearText.addEventListener("click", () => {
  textContainer.innerHTML = '<div class="placeholder"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><p>等待 OCR 识别结果...</p></div>';
  ocrStats.innerHTML = "";
});

btnCopyText.addEventListener("click", async () => {
  const entries = textContainer.querySelectorAll(".ocr-entry-text");
  const text = Array.from(entries).map((el) => el.textContent).join("\n\n");
  if (text) {
    await navigator.clipboard.writeText(text);
    btnCopyText.textContent = "已复制!";
    setTimeout(() => {
      btnCopyText.textContent = "复制";
    }, 1500);
  }
});

mdPathEl.addEventListener("click", async () => {
  const path = mdPathEl.textContent;
  await navigator.clipboard.writeText(path);
  mdPathEl.style.color = "var(--accent)";
  setTimeout(() => {
    mdPathEl.style.color = "";
  }, 1000);
});

btnChangePath.addEventListener("click", async () => {
  const newPath = prompt("请输入新的 Markdown 文件路径:", mdPathEl.textContent);
  if (newPath && newPath.trim()) {
    await window.api.setMdPath(newPath.trim());
    mdPathEl.textContent = newPath.trim();
  }
});

window.api.onOcrResult((data) => {
  addOcrEntry(data);
});

window.api.onScreenshotPreview((data) => {
  previewContainer.innerHTML = `<img src="${data}" alt="截图预览">`;
});

window.api.onOcrError((data) => {
  statusDot.classList.add("error");
  statusText.textContent = `错误: ${data.message}`;
  setTimeout(() => {
    if (isCapturing) {
      statusDot.classList.remove("error");
      statusText.textContent = "正在捕获...";
    }
  }, 3000);
});

window.api.onMdUpdated((path) => {
  mdPathEl.textContent = path;
});

loadWindows();
loadMdPath();
