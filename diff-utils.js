function diffLines(oldText, newText) {
  const oldLines = (oldText || "").split("\n").map((l) => l.trimEnd());
  const newLines = (newText || "").split("\n").map((l) => l.trimEnd());

  while (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") {
    oldLines.pop();
  }
  while (newLines.length > 0 && newLines[newLines.length - 1] === "") {
    newLines.pop();
  }

  if (oldLines.length === 0 && newLines.length === 0) {
    return { changed: false, diff: "", added: 0, removed: 0 };
  }

  if (oldLines.length === 0) {
    const diff = newLines.map((l) => `+ ${l}`).join("\n");
    return { changed: true, diff, added: newLines.length, removed: 0 };
  }

  if (newLines.length === 0) {
    const diff = oldLines.map((l) => `- ${l}`).join("\n");
    return { changed: true, diff, added: 0, removed: oldLines.length };
  }

  const oldStr = oldLines.join("\n");
  const newStr = newLines.join("\n");
  if (oldStr === newStr) {
    return { changed: false, diff: "", added: 0, removed: 0 };
  }

  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m,
    j = n;
  let added = 0,
    removed = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push(`  ${oldLines[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push(`+ ${newLines[j - 1]}`);
      added++;
      j--;
    } else {
      result.push(`- ${oldLines[i - 1]}`);
      removed++;
      i--;
    }
  }

  result.reverse();

  const filtered = result.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && trimmed !== "  ";
  });

  if (added === 0 && removed === 0) {
    return { changed: false, diff: "", added: 0, removed: 0 };
  }

  return {
    changed: true,
    diff: filtered.join("\n"),
    added,
    removed,
  };
}

function formatDiffForMarkdown(diffResult) {
  if (!diffResult.changed) return "";

  const header = `\`\`\`diff\n${diffResult.diff}\n\`\`\``;
  const stats = `> 新增 ${diffResult.added} 行，删除 ${diffResult.removed} 行`;
  return `${stats}\n\n${header}`;
}

module.exports = { diffLines, formatDiffForMarkdown };
