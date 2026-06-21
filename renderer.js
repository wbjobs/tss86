let selectedWindowHandle = null;
let isCapturing = false;
let captureCount = 0;
let startTime = 0;
let currentStatus = "stopped";
let nextSnapshotTime = null;
let snapshotCountdownTimer = null;

const STATUS_CONFIG = {
  stopped: { dotClass: "", text: "未启动", showPreview: false },
  capturing: { dotClass: "running", text: "正在捕获", showPreview: true },
  idle: { dotClass: "running", text: "文字无变化", showPreview: true },
  no_text: { dotClass: "warning", text: "未检测到文字", showPreview: true },
  occluded: { dotClass: "warning", text: "窗口被遮挡或空白", showPreview: false },
  minimized: { dotClass: "warning", text: "窗口已最小化", showPreview: false },
  invisible: { dotClass: "error", text: "窗口不可见", showPreview: false },
  restarting: { dotClass: "warning", text: "子进程重启中", showPreview: false },
  snapshot: { dotClass: "running", text: "保存快照中", showPreview: true },
  error: { dotClass: "error", text: "错误", showPreview: false },
};

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

function formatTimeRemaining(ms) {
  if (ms <= 0) return "即将拍照";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `下次快照: ${m}分${sec}秒`;
}

function updateSnapshotCountdown() {
  if (nextSnapshotTime && isCapturing) {
    const remaining = nextSnapshotTime - Date.now();
    captureFps.textContent = formatTimeRemaining(remaining);
  }
}

function startSnapshotCountdown() {
  stopSnapshotCountdown();
  snapshotCountdownTimer = setInterval(updateSnapshotCountdown, 1000);
}

function stopSnapshotCountdown() {
  if (snapshotCountdownTimer) {
    clearInterval(snapshotCountdownTimer);
    snapshotCountdownTimer = null;
  }
}

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

function updateStatus(status, customText) {
  currentStatus = status;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.error;

  statusDot.className = `status-dot ${config.dotClass}`;
  statusText.textContent = customText || config.text;

  btnStart.disabled = isCapturing || !selectedWindowHandle;
  btnStop.disabled = !isCapturing;

  if (!config.showPreview && isCapturing) {
    if (!previewContainer.querySelector(".placeholder")) {
      previewContainer.innerHTML = `
        <div class="placeholder">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p>${customText || config.text}</p>
        </div>
      `;
    } else {
      previewContainer.querySelector(".placeholder p").textContent = customText || config.text;
    }
  }
}

function setCapturingState(capturing) {
  isCapturing = capturing;
  if (!capturing) {
    updateStatus("stopped");
    stopSnapshotCountdown();
    nextSnapshotTime = null;
    captureFps.textContent = "";
  }
}

function renderDiffLines(diffText) {
  const lines = diffText.split("\n");
  return lines.map((line) => {
    if (line.startsWith("+ ")) {
      return `<div class="diff-line diff-added">${escapeHtml(line)}</div>`;
    } else if (line.startsWith("- ")) {
      return `<div class="diff-line diff-removed">${escapeHtml(line)}</div>`;
    } else if (line.startsWith("  ")) {
      return `<div class="diff-line diff-context">${escapeHtml(line)}</div>`;
    }
    return `<div class="diff-line">${escapeHtml(line)}</div>`;
  }).join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function addOcrEntry(data, diffResult) {
  if (textContainer.querySelector(".placeholder")) {
    textContainer.innerHTML = "";
  }

  const entry = document.createElement("div");
  entry.className = "ocr-entry";

  const time = document.createElement("div");
  time.className = "ocr-entry-time";
  time.textContent = new Date(data.timestamp).toLocaleTimeString("zh-CN");

  let content;
  if (diffResult && diffResult.diff) {
    content = document.createElement("div");
    content.className = "ocr-entry-text";
    content.innerHTML = renderDiffLines(diffResult.diff);

    const stats = document.createElement("div");
    stats.className = "diff-stats";
    stats.innerHTML = `
      <span class="diff-added-count">+${diffResult.added}</span>
      <span class="diff-removed-count">-${diffResult.removed}</span>
      <span style="float: right;">置信度: ${data.confidence?.toFixed(1) || "N/A"}%</span>
    `;
    entry.appendChild(time);
    entry.appendChild(content);
    entry.appendChild(stats);
  } else {
    const text = document.createElement("div");
    text.className = "ocr-entry-text";
    text.textContent = data.text;

    const confidence = document.createElement("div");
    confidence.className = "ocr-entry-confidence";
    confidence.textContent = `置信度: ${data.confidence?.toFixed(1) || "N/A"}%`;

    entry.appendChild(time);
    entry.appendChild(text);
    entry.appendChild(confidence);
  }

  textContainer.appendChild(entry);
  textContainer.scrollTop = textContainer.scrollHeight;

  captureCount++;
  if (startTime > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    ocrStats.innerHTML = `<span>已识别: ${captureCount} 次</span><span>运行时间: ${elapsed.toFixed(0)}s</span>`;
  }
}

function addSnapshotEntry(data) {
  if (textContainer.querySelector(".placeholder")) {
    textContainer.innerHTML = "";
  }

  const entry = document.createElement("div");
  entry.className = "ocr-entry ocr-entry-snapshot";

  const time = document.createElement("div");
  time.className = "ocr-entry-time";
  time.textContent = new Date(data.timestamp).toLocaleTimeString("zh-CN") + " [快照]";

  const info = document.createElement("div");
  info.className = "snapshot-info";
  info.innerHTML = `
    <div>📸 窗口快照已保存</div>
    <div><a href="#" onclick="event.preventDefault(); navigator.clipboard.writeText('${data.path}'); return false;">${data.relativePath}</a></div>
    ${data.nextSnapshot ? `<div class="snapshot-next">${formatTimeRemaining(data.nextSnapshot - Date.now())}</div>` : ""}
  `;

  entry.appendChild(time);
  entry.appendChild(info);

  textContainer.appendChild(entry);
  textContainer.scrollTop = textContainer.scrollHeight;
}

btnRefresh.addEventListener("click", loadWindows);

btnStart.addEventListener("click", async () => {
  if (!selectedWindowHandle) return;

  captureCount = 0;
  startTime = Date.now();
  textContainer.innerHTML = '<div class="placeholder"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><p>等待 OCR 识别结果...</p></div>';
  ocrStats.innerHTML = "";

  setCapturingState(true);
  updateStatus("capturing", "正在捕获...");

  const result = await window.api.startCapture(selectedWindowHandle);
  if (result.nextSnapshot) {
    nextSnapshotTime = result.nextSnapshot;
    startSnapshotCountdown();
  }
});

btnStop.addEventListener("click", async () => {
  await window.api.stopCapture();
  setCapturingState(false);
  startTime = 0;
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
  addOcrEntry(data, null);
});

window.api.onDiffResult((data) => {
  if (textContainer.querySelector(".placeholder")) {
    return;
  }
  const lastEntry = textContainer.querySelector(".ocr-entry:last-child");
  if (lastEntry && !lastEntry.classList.contains("ocr-entry-snapshot")) {
    const textEl = lastEntry.querySelector(".ocr-entry-text");
    const confEl = lastEntry.querySelector(".ocr-entry-confidence");
    if (textEl && confEl) {
      textEl.innerHTML = renderDiffLines(data.diff);
      textEl.className = "ocr-entry-text";
      confEl.className = "diff-stats";
      confEl.innerHTML = `
        <span class="diff-added-count">+${data.added}</span>
        <span class="diff-removed-count">-${data.removed}</span>
      `;
    }
  }
});

window.api.onScreenshotPreview((data) => {
  previewContainer.innerHTML = `<img src="${data}" alt="截图预览">`;
});

window.api.onOcrError((data) => {
  updateStatus("error", data.message);
  setTimeout(() => {
    if (isCapturing && currentStatus === "error") {
      updateStatus("capturing");
    }
  }, 3000);
});

window.api.onStatusChange((data) => {
  updateStatus(data.status, data.message);
});

window.api.onSnapshotSaved((data) => {
  addSnapshotEntry(data);
  if (data.nextSnapshot) {
    nextSnapshotTime = data.nextSnapshot;
  }
});

window.api.onMdUpdated((path) => {
  mdPathEl.textContent = path;
});

loadWindows();
loadMdPath();
