const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const { getWindowBounds } = require("./window-utils");

let capturing = false;
let windowHandle = null;
let scheduler = null;
let lastText = "";
let worker = null;

async function captureAndOcr() {
  if (!capturing) return;

  try {
    const bounds = await getWindowBounds(windowHandle);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      process.send({ type: "ocr-error", data: { message: "窗口已关闭或不可访问" } });
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
      scheduleNext();
      return;
    }

    const croppedBuffer = await image.extract(cropRegion).png().toBuffer();

    const base64Preview = `data:image/png;base64,${croppedBuffer.toString("base64")}`;
    process.send({ type: "screenshot-preview", data: base64Preview });

    if (worker) {
      const result = await worker.recognize(croppedBuffer);
      const text = result.data.text || "";

      if (text.trim() && text.trim() !== lastText.trim()) {
        lastText = text;
        process.send({
          type: "ocr-result",
          data: {
            text: text.trim(),
            confidence: result.data.confidence,
            timestamp: Date.now(),
          },
        });
      }
    }
  } catch (err) {
    process.send({ type: "ocr-error", data: { message: err.message } });
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

    try {
      worker = await Tesseract.createWorker("chi_sim+eng");
      captureAndOcr();
    } catch (err) {
      process.send({ type: "ocr-error", data: { message: `OCR初始化失败: ${err.message}` } });
    }
  } else if (msg.type === "stop") {
    capturing = false;
    if (scheduler) {
      clearTimeout(scheduler);
      scheduler = null;
    }
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    process.exit(0);
  }
});

process.on("uncaughtException", (err) => {
  process.send({ type: "ocr-error", data: { message: `Worker异常: ${err.message}` } });
});
