const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const { getWindowStatus } = require("./window-utils");

let capturing = false;
let windowHandle = null;
let scheduler = null;
let lastText = "";
let worker = null;
let lastStatus = "";

async function analyzeImageBrightness(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .resize(64, 64)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    let varianceSum = 0;
    const len = data.length;

    for (let i = 0; i < len; i++) {
      sum += data[i];
    }
    const mean = sum / len;

    for (let i = 0; i < len; i++) {
      varianceSum += Math.pow(data[i] - mean, 2);
    }
    const variance = varianceSum / len;

    return { mean, variance, isBlank: mean < 15 || mean > 240 || variance < 100 };
  } catch {
    return { mean: 0, variance: 0, isBlank: false };
  }
}

function sendStatus(status, message) {
  if (status !== lastStatus) {
    lastStatus = status;
    process.send({ type: "status-change", data: { status, message } });
  }
}

async function captureAndOcr() {
  if (!capturing) return;

  try {
    const winStatus = await getWindowStatus(windowHandle);

    if (!winStatus.visible) {
      sendStatus("invisible", "窗口不可见");
      scheduleNext();
      return;
    }

    if (winStatus.minimized) {
      sendStatus("minimized", "窗口已最小化");
      scheduleNext();
      return;
    }

    const bounds = winStatus.bounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      sendStatus("invisible", "窗口尺寸异常");
      scheduleNext();
      return;
    }

    const displays = await screenshot.listDisplays();
    const primaryDisplay = displays[0];

    const imgBuffer = await screenshot({ screen: primaryDisplay.id });
    const image = sharp(imgBuffer);

    const metadata = await image.metadata();
    const scaleX = metadata.width / primaryDisplay.width;
    const scaleY = metadata.height / primaryDisplay.height;

    const cropRegion = {
      left: Math.max(0, Math.round(bounds.x * scaleX)),
      top: Math.max(0, Math.round(bounds.y * scaleY)),
      width: Math.max(1, Math.round(bounds.width * scaleX)),
      height: Math.max(1, Math.round(bounds.height * scaleY)),
    };

    if (cropRegion.left + cropRegion.width > metadata.width) {
      cropRegion.width = metadata.width - cropRegion.left;
    }
    if (cropRegion.top + cropRegion.height > metadata.height) {
      cropRegion.height = metadata.height - cropRegion.top;
    }

    if (cropRegion.width <= 0 || cropRegion.height <= 0) {
      sendStatus("invisible", "窗口区域无效");
      scheduleNext();
      return;
    }

    const croppedBuffer = await image.extract(cropRegion).png().toBuffer();

    const brightness = await analyzeImageBrightness(croppedBuffer);
    if (brightness.isBlank) {
      sendStatus("occluded", "窗口被遮挡或内容空白");
      scheduleNext();
      return;
    }

    const base64Preview = `data:image/png;base64,${croppedBuffer.toString("base64")}`;
    process.send({ type: "screenshot-preview", data: base64Preview });

    if (!worker) {
      sendStatus("error", "OCR 引擎未就绪");
      scheduleNext();
      return;
    }

    const result = await worker.recognize(croppedBuffer);
    const text = (result.data.text || "").trim();

    if (!text || text.length < 2) {
      sendStatus("no-text", "未检测到文字");
      scheduleNext();
      return;
    }

    if (text === lastText) {
      sendStatus("idle", "文字无变化");
      scheduleNext();
      return;
    }

    lastText = text;
    sendStatus("capturing", "正在捕获");

    process.send({
      type: "ocr-result",
      data: {
        text,
        confidence: result.data.confidence,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    process.send({ type: "ocr-error", data: { message: err.message } });
    sendStatus("error", err.message);
  }

  scheduleNext();
}

function scheduleNext() {
  if (capturing) {
    scheduler = setTimeout(captureAndOcr, 1000);
  }
}

process.on("message", async (msg) => {
  if (msg.type === "start") {
    windowHandle = msg.windowHandle;
    capturing = true;
    lastText = "";
    lastStatus = "";

    try {
      worker = await Tesseract.createWorker("chi_sim+eng");
      sendStatus("capturing", "正在捕获");
      captureAndOcr();
    } catch (err) {
      process.send({ type: "ocr-error", data: { message: `OCR初始化失败: ${err.message}` } });
      sendStatus("error", `OCR初始化失败: ${err.message}`);
      capturing = false;
      process.exit(1);
    }
  } else if (msg.type === "stop") {
    capturing = false;
    if (scheduler) {
      clearTimeout(scheduler);
      scheduler = null;
    }
    if (worker) {
      try {
        await worker.terminate();
      } catch {}
      worker = null;
    }
    process.exit(0);
  }
});

process.on("uncaughtException", (err) => {
  process.send({ type: "ocr-error", data: { message: `Worker异常: ${err.message}` } });
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (err) => {
  process.send({ type: "ocr-error", data: { message: `Worker异步异常: ${err.message}` } });
  setTimeout(() => process.exit(1), 1000);
});
