import { VerifierLogState } from "./analyzer";
import { getCLineId, ParsedLine, ParsedLineType } from "./parser";

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

function getVisibleRange(
  containerEl: HTMLElement,
  contentEl: HTMLElement,
  linesLen: number,
): {
  min: number;
  max: number;
} {
  const contentRect = contentEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();

  if (containerRect.height > contentRect.height) {
    return { min: 0, max: linesLen - 1 };
  }

  const relativeStart =
    (containerRect.top - contentRect.top) / contentRect.height;
  const relativeEnd = relativeStart + containerRect.height / contentRect.height;
  const min = Math.floor(relativeStart * linesLen);
  const max = Math.ceil(relativeEnd * linesLen);

  return { min, max };
}

export function getVisibleLogLineRange(linesLen: number): {
  min: number;
  max: number;
} {
  const formattedLogLines = document.getElementById("formatted-log-lines");
  const logContainer = document.getElementById("log-container");
  if (!formattedLogLines || !logContainer) {
    throw new Error("Missing formattedLogLines or logContainer");
  }
  return getVisibleRange(logContainer, formattedLogLines, linesLen);
}

export function getVisibleCSourceRange(linesLen: number): {
  min: number;
  max: number;
} {
  const csourceContent = document.getElementById("c-source-content");
  const csourceContainer = document.getElementById("c-source-container");
  if (!csourceContent || !csourceContainer) {
    // Don't throw the container might be collapsed
    return { min: 0, max: 0 };
  }
  return getVisibleRange(csourceContainer, csourceContent, linesLen);
}

function scrollToLine(
  el: HTMLElement,
  visualIdx: number,
  max: number,
  min: number,
  linesLen: number,
) {
  const page = max - min + 1;
  const relativePosition =
    normalIdx(visualIdx - page * 0.618, linesLen) / linesLen;
  el.scrollTop = relativePosition * el.scrollHeight;
}

export function scrollToLogLine(visualIdx: number, linesLen: number) {
  const logContainer = document.getElementById("log-container");
  if (!logContainer) {
    throw new Error("Log line container is not in the DOM");
  }
  const logRange = getVisibleLogLineRange(linesLen);
  if (
    (visualIdx < logRange.min + 8 || visualIdx > logRange.max - 8) &&
    !(visualIdx < 0 || visualIdx >= linesLen)
  ) {
    scrollToLine(logContainer, visualIdx, logRange.max, logRange.min, linesLen);
  }
}

export function scrollToCLine(visualIdx: number, linesLen: number) {
  const cSourceContainer = document.getElementById("c-source-container");
  if (!cSourceContainer) {
    // This won't exist if the container is collapsed
    return;
  }
  const cLinesRange = getVisibleCSourceRange(linesLen);
  if (
    (visualIdx < cLinesRange.min + 8 || visualIdx > cLinesRange.max - 8) &&
    !(visualIdx < 0 || visualIdx >= linesLen)
  ) {
    scrollToLine(
      cSourceContainer,
      visualIdx,
      cLinesRange.max,
      cLinesRange.min,
      linesLen,
    );
  }
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

export function getVisibleLogLines(
  verifierLogState: VerifierLogState,
  fullLogView: boolean,
): [ParsedLine[], Map<number, number>] {
  const logLines: ParsedLine[] = [];
  const logLineIdxToVisualIdx: Map<number, number> = new Map();

  let visualIdx = 0;
  verifierLogState.lines.forEach((line) => {
    if (line.type !== ParsedLineType.C_SOURCE || fullLogView) {
      logLines.push(line);
      logLineIdxToVisualIdx.set(line.idx, visualIdx++);
    }
  });

  return [logLines, logLineIdxToVisualIdx];
}

export function getVisibleCLines(
  verifierLogState: VerifierLogState,
): [string[], Map<string, number>] {
  const cLines = [];
  const cLineIdToVisualIdx: Map<string, number> = new Map();
  let i = 0;
  const { cSourceMap } = verifierLogState;
  for (const [file, range] of cSourceMap.fileRange) {
    let unknownStart = 0;
    for (let j = range[0]; j < range[1]; ++j) {
      const cLineId = getCLineId(file, j);
      const sourceLine = cSourceMap.cSourceLines.get(cLineId);
      if (!sourceLine) {
        if (!unknownStart) {
          unknownStart = i;
        }
        continue;
      }
      if (unknownStart > 0) {
        cLines.push("");
        cLineIdToVisualIdx.set(cLineId, i++);
      }
      unknownStart = 0;
      cLines.push(cLineId);
      cLineIdToVisualIdx.set(cLineId, i++);
    }
  }
  return [cLines, cLineIdToVisualIdx];
}
