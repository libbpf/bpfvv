export async function fetchLogFromUrl(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error("Error fetching log:", error);
    return null;
  }
}

export function normalIdx(idx: number, linesLen: number): number {
  return Math.min(Math.max(0, idx), linesLen - 1);
}

export function getVisibleIdxRange(linesLen: number): {
  min: number;
  max: number;
} {
  const formattedLogLines = document.getElementById("formatted-log-lines");
  const logContainer = document.getElementById("log-container");
  if (!formattedLogLines || !logContainer) {
    return { min: 0, max: 0 };
  }
  const linesRect = formattedLogLines.getBoundingClientRect();
  const containerRect = logContainer.getBoundingClientRect();

  if (containerRect.height > linesRect.height) {
    return { min: 0, max: linesLen - 1 };
  }

  const relativeStart = (containerRect.top - linesRect.top) / linesRect.height;
  const relativeEnd = relativeStart + containerRect.height / linesRect.height;
  const min = Math.floor(relativeStart * linesLen);
  const max = Math.ceil(relativeEnd * linesLen);

  return { min, max };
}

export function scrollToLine(idx: number, linesLen: number) {
  const logContainer = document.getElementById("log-container");
  if (!logContainer) {
    return;
  }
  const { min, max } = getVisibleIdxRange(linesLen);
  const page = max - min + 1;
  const relativePosition = normalIdx(idx - page * 0.618, linesLen) / linesLen;
  logContainer.scrollTop = relativePosition * logContainer.scrollHeight;
}
