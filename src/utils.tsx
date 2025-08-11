import { ParsedLine, ParsedLineType } from "./parser";

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
    return { min: 0, max: 0 }; // Throw here
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

function scrollToLine(el: HTMLElement, idx: number, linesLen: number) {
  const { min, max } = getVisibleIdxRange(linesLen);
  const page = max - min + 1;
  const relativePosition = normalIdx(idx - page * 0.618, linesLen) / linesLen;
  el.scrollTop = relativePosition * el.scrollHeight;
}

export function scrollToLogLine(idx: number, linesLen: number) {
  const logContainer = document.getElementById("log-container");
  if (!logContainer) {
    throw new Error("Log line container is not in the DOM");
  }
  scrollToLine(logContainer, idx, linesLen);
}

export function scrollToCLine(idx: number, linesLen: number) {
  const cSourceContainer = document.getElementById("c-source-container");
  if (!cSourceContainer) {
    // This won't exist if the container is collapsed
    return;
  }
  scrollToLine(cSourceContainer, idx, linesLen);
}

export function siblingInsLine(
  insLines: ParsedLine[],
  idx: number,
  delta: number,
): number {
  // if delta is 1 we are looking for the next instruction
  // if delta is -1 we are looking for the previous instruction
  const n = insLines.length;
  for (let i = normalIdx(idx + delta, n); 0 <= i && i < n; i += delta) {
    const line = insLines[i];
    if (line.type === ParsedLineType.INSTRUCTION) {
      return i;
    }
  }
  return normalIdx(idx, n);
}
