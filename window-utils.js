const { exec } = require("child_process");
const path = require("path");

const SCRIPTS_DIR = path.join(__dirname, "scripts");

function execPs(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const argStr = args.map((a) => `"${a}"`).join(" ");
    const cmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" ${argStr}`;
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000, encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function getWindows() {
  try {
    const output = await execPs(path.join(SCRIPTS_DIR, "enum-windows.ps1"));
    if (!output) return [];
    return output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split("|");
        if (parts.length < 7) return null;
        return {
          handle: parseInt(parts[0]),
          processId: parseInt(parts[1]),
          width: parseInt(parts[2]),
          height: parseInt(parts[3]),
          x: parseInt(parts[4]),
          y: parseInt(parts[5]),
          title: parts.slice(6).join("|").trim(),
        };
      })
      .filter((w) => w && w.title && w.width > 0 && w.height > 0);
  } catch (err) {
    console.error("getWindows error:", err.message);
    return [];
  }
}

async function getWindowBounds(handle) {
  try {
    const output = await execPs(path.join(SCRIPTS_DIR, "get-bounds.ps1"), [String(handle)]);
    if (output === "INVISIBLE") return null;
    const parts = output.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    return {
      x: parts[0],
      y: parts[1],
      width: parts[2] - parts[0],
      height: parts[3] - parts[1],
    };
  } catch {
    return null;
  }
}

async function getWindowStatus(handle) {
  try {
    const output = await execPs(path.join(SCRIPTS_DIR, "get-window-status.ps1"), [String(handle)]);
    if (output === "invisible") {
      return { visible: false, minimized: false, bounds: null };
    }
    if (output === "minimized") {
      return { visible: true, minimized: true, bounds: null };
    }
    const parts = output.split("|");
    if (parts[0] === "ok" && parts[1]) {
      const coords = parts[1].split(",").map(Number);
      if (coords.length === 4 && !coords.some(isNaN)) {
        return {
          visible: true,
          minimized: false,
          bounds: {
            x: coords[0],
            y: coords[1],
            width: coords[2] - coords[0],
            height: coords[3] - coords[1],
          },
        };
      }
    }
    return { visible: false, minimized: false, bounds: null };
  } catch {
    return { visible: false, minimized: false, bounds: null };
  }
}

module.exports = { getWindows, getWindowBounds, getWindowStatus };
