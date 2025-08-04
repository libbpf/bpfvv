import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  VerifierLogState,
  processRawLines,
  getEmptyVerifierState,
} from "./analyzer";

import {
  fetchLogFromUrl,
  getVisibleIdxRange,
  scrollToLogLine,
  scrollToCLine,
  siblingInsLine,
} from "./utils";

import {
  LogLineState,
  Example,
  HoveredLineHint,
  LoadStatus,
  MainContent,
  SelectedLineHint,
  ToolTip,
} from "./components";
import { ParsedLine, ParsedLineType } from "./parser";

const ContentRaw = ({
  loadError,
  verifierLogState,
  logLines,
  selectedLine,
  selectedMemSlotId,
  selectedCLine,
  handlePaste,
  handleMainContentClick,
  handleCLinesClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  loadError: string | null;
  verifierLogState: VerifierLogState;
  logLines: ParsedLine[];
  selectedLine: number;
  selectedMemSlotId: string;
  selectedCLine: number;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  if (loadError) {
    return <div>{loadError}</div>;
  } else if (logLines.length > 0) {
    return (
      <MainContent
        verifierLogState={verifierLogState}
        logLines={logLines}
        selectedLine={selectedLine}
        selectedMemSlotId={selectedMemSlotId}
        selectedCLine={selectedCLine}
        handleCLinesClick={handleCLinesClick}
        handleMainContentClick={handleMainContentClick}
        handleLogLinesClick={handleLogLinesClick}
        handleLogLinesOver={handleLogLinesOver}
        handleLogLinesOut={handleLogLinesOut}
      />
    );
  } else {
    return (
      <textarea
        id="input-text"
        onPaste={handlePaste}
        placeholder="Paste a verifier log here or choose a file"
      />
    );
  }
};

const Content = React.memo(ContentRaw);

function App() {
  const [verifierLogState, setVerifierLogState] = useState<VerifierLogState>(
    getEmptyVerifierState(),
  );
  const [hoveredState, setHoveredState] = useState<LogLineState>({
    memSlotId: "",
    line: -1,
    cLine: "", // unused
  });
  const [selectedState, setSelectedState] = useState<LogLineState>({
    memSlotId: "",
    line: 0,
    cLine: "",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullLogView, setfullLogView] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { cLines, cLineIdtoIdx } = verifierLogState;

  const [logLines, logLineIdToIdx] = useMemo(() => {
    const logLines: ParsedLine[] = [];
    const logLineIdToIdx: Map<number, number> = new Map();

    let idx = 0;
    verifierLogState.lines.forEach((line) => {
      if (line.type !== ParsedLineType.C_SOURCE || fullLogView) {
        logLines.push(line);
        logLineIdToIdx.set(line.idx, idx++);
      }
    });

    return [logLines, logLineIdToIdx];
  }, [verifierLogState, fullLogView]);

  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;
  const selectedLineIdx = logLineIdToIdx.get(selectedLine) || 0;
  const hoveredLineIdx = logLineIdToIdx.get(hoveredState.line) || 0;
  const selectedCLine = useMemo(() => {
    let clineId = "";
    if (selectedState.cLine) {
      clineId = selectedState.cLine;
    } else {
      const parsedLine = verifierLogState.lines[selectedState.line];
      if (!parsedLine) {
        return 0;
      }
      if (parsedLine.type === ParsedLineType.C_SOURCE) {
        clineId = parsedLine.id;
      } else {
        clineId =
          verifierLogState.cSourceMap.logLineToCLine.get(selectedState.line) ||
          "";
      }
    }
    return verifierLogState.cSourceMap.cSourceLines.get(clineId)?.lineNum || 0;
  }, [verifierLogState, selectedState]);

  const setSelectedAndScroll = useCallback(
    (
      nextInsLineId: number,
      nextCLineId: string,
      nextInsLineIdx: number,
      nextCLineIdx: number,
      memSlotId: string = "",
    ) => {
      const logRange = getVisibleIdxRange(logLines.length);
      if (
        (nextInsLineIdx < logRange.min + 8 ||
          nextInsLineIdx > logRange.max - 8) &&
        !(nextInsLineIdx < 0 || nextInsLineIdx >= logLines.length)
      ) {
        scrollToLogLine(nextInsLineIdx, logLines.length);
      }
      const cLinesRange = getVisibleIdxRange(cLines.length);
      if (
        (nextCLineIdx < cLinesRange.min + 8 ||
          nextCLineIdx > cLinesRange.max - 8) &&
        !(nextCLineIdx < 0 || nextCLineIdx >= cLines.length)
      ) {
        scrollToCLine(nextCLineIdx, cLines.length);
      }
      setSelectedState({ line: nextInsLineId, memSlotId, cLine: nextCLineId });
    },
    [logLines, cLines],
  );

  const onGotoStart = useCallback(() => {
    if (logLines.length === 0) {
      return;
    }
    const lineId = logLines[0].idx;
    const clineId =
      verifierLogState.cSourceMap.logLineToCLine.get(lineId) || "";
    setSelectedAndScroll(lineId, "", 0, cLineIdtoIdx.get(clineId) || 0);
  }, [logLines, verifierLogState]);

  function onGotoEnd() {
    if (logLines.length === 0) {
      return;
    }
    const lineId = logLines[logLines.length - 1].idx;
    const clineId =
      verifierLogState.cSourceMap.logLineToCLine.get(lineId) || "";
    setSelectedAndScroll(
      lineId,
      "",
      logLines.length - 1,
      cLineIdtoIdx.get(clineId) || 0,
    );
  }

  const onClear = useCallback(() => {
    setVerifierLogState(getEmptyVerifierState());
    setSelectedState({ line: 0, memSlotId: "", cLine: "" });
    const fiCurrent = fileInputRef.current;
    if (fiCurrent) {
      fiCurrent.value = "";
    }
  }, []);

  const onLogToggle = useCallback(() => {
    setfullLogView((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let delta = 0;
      let areCLinesInFocus = selectedState.cLine !== "";
      let { min, max } = getVisibleIdxRange(
        areCLinesInFocus ? cLines.length : logLines.length,
      );
      let page = max - min + 1;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          delta = 1;
          break;
        case "ArrowUp":
        case "k":
          delta = -1;
          break;
        case "PageDown":
          delta = page;
          break;
        case "PageUp":
          delta = -page;
          break;
        case "Home":
          onGotoStart();
          return;
        case "End":
          onGotoEnd();
          return;
        case "Escape":
          setSelectedState({ line: 0, memSlotId: "", cLine: "" });
          break;
        default:
          return;
      }
      e.preventDefault();
      if (areCLinesInFocus) {
        const currentIdx = cLineIdtoIdx.get(selectedState.cLine) || 0;
        let nextIdx = currentIdx + delta;
        if (cLines[nextIdx] === "") {
          nextIdx += delta;
        }
        const logLines = verifierLogState.cSourceMap.cLineToLogLines.get(
          selectedState.cLine,
        );
        let logLineId = 0;
        if (logLines && logLines.size > 0) {
          [logLineId] = logLines;
        }
        setSelectedAndScroll(
          logLineId,
          cLines[nextIdx],
          logLineIdToIdx.get(logLineId) || -1,
          nextIdx,
        );
      } else {
        const currInsIdx = logLineIdToIdx.get(selectedState.line) || 0;
        let nextInsIdx = siblingInsLine(logLines, currInsIdx, delta);
        const logLineId = logLines[nextInsIdx].idx;
        const cLineId =
          verifierLogState.cSourceMap.logLineToCLine.get(logLineId) || "";
        setSelectedAndScroll(
          logLineId,
          "",
          nextInsIdx,
          cLineIdtoIdx.get(cLineId) || -1,
        );
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    logLines,
    cLines,
    cLineIdtoIdx,
    selectedState,
    verifierLogState,
    logLineIdToIdx,
    onGotoStart,
    onGotoEnd,
  ]);

  useEffect(() => {
    onGotoEnd();
  }, [verifierLogState]);

  const loadInputText = useCallback((text: string) => {
    setVerifierLogState(processRawLines(text.split("\n")));
  }, []);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const pastedText = event.clipboardData.getData("text");
      loadInputText(pastedText);
    },
    [loadInputText],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    if (url) {
      fetchLogFromUrl(url).then((text) => {
        if (text) {
          loadInputText(text);
        } else {
          setLoadError(`Failed to load log from ${url}\n`);
        }
      });
    }
  }, [loadInputText]);

  useEffect(() => {
    let logLines: Set<number> = new Set();
    let cLine: string;
    let cLineEl: HTMLElement | null;
    if (selectedState.cLine) {
      cLineEl = document.getElementById(`line-${selectedState.cLine}`);
      if (cLineEl) {
        cLineEl.classList.add("selected-line");
      }
      logLines =
        verifierLogState.cSourceMap.cLineToLogLines.get(selectedState.cLine) ||
        new Set();
      for (let logLine of logLines) {
        const logLineEl = document.getElementById(`line-${logLine}`);
        if (logLineEl) {
          logLineEl.classList.add("selected-line");
        }
      }
    } else if (selectedState.line) {
      const parsedLine = verifierLogState.lines[selectedState.line];
      cLine =
        parsedLine.type === ParsedLineType.C_SOURCE
          ? parsedLine.id
          : verifierLogState.cSourceMap.logLineToCLine.get(
              selectedState.line,
            ) || "";
      cLineEl = document.getElementById(`line-${cLine}`);
      if (cLineEl) {
        cLineEl.classList.add("selected-line");
      }
    }
    return () => {
      if (cLineEl) {
        cLineEl.classList.remove("selected-line");
      }
      for (let logLine of logLines) {
        const logLineEl = document.getElementById(`line-${logLine}`);
        if (logLineEl) {
          logLineEl.classList.remove("selected-line");
        }
      }
    };
  }, [verifierLogState, selectedState]);

  const handleMainContentClick = useCallback(() => {
    setSelectedState((prevSelected) => {
      return { ...prevSelected, memSlotId: "" };
    });
  }, []);

  const handleCLinesClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const cline = target.closest(".c-source-line");
      let clineId = "";
      if (cline) {
        clineId = cline.getAttribute("data-id") || "";
      }
      const logLines = verifierLogState.cSourceMap.cLineToLogLines.get(clineId);
      if (logLines && logLines.size > 0) {
        const [firstItem] = logLines;
        setSelectedAndScroll(
          firstItem,
          clineId,
          logLineIdToIdx.get(firstItem) || 0,
          -1,
        );
      } else {
        setSelectedState({ line: 0, memSlotId: "", cLine: clineId });
      }
    },
    [verifierLogState, logLineIdToIdx, cLineIdtoIdx],
  );

  const handleLogLinesClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const memSlot = target.closest(".mem-slot");
      let memSlotId = "";
      if (memSlot) {
        memSlotId = memSlot.getAttribute("data-id") || "";
        // only stop bubbling if we clicked on a mem slot
        e.stopPropagation();
      }

      const clickedLine = target.closest(".log-line");
      if (clickedLine) {
        const lineId = parseInt(
          clickedLine.getAttribute("line-index") || "0",
          10,
        );
        const parsedLine = verifierLogState.lines[lineId];
        const clineId =
          parsedLine.type == ParsedLineType.C_SOURCE
            ? parsedLine.id
            : verifierLogState.cSourceMap.logLineToCLine.get(lineId) || "";
        setSelectedAndScroll(
          lineId,
          "",
          -1,
          cLineIdtoIdx.get(clineId) || -1,
          memSlotId,
        );
      }
    },
    [logLines, verifierLogState, cLineIdtoIdx],
  );

  const handleLogLinesOver = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hoveredElement = e.target as HTMLElement;
      const logLine = hoveredElement.closest(".log-line") as HTMLElement;
      let hoveredLine = -1;
      if (logLine) {
        const idx = parseInt(logLine.getAttribute("line-index") || "0", 10);
        hoveredLine = idx;
      }
      const memSlot = hoveredElement.closest(".mem-slot") as HTMLElement;
      if (memSlot) {
        setHoveredState({
          memSlotId: memSlot.id,
          line: hoveredLine,
          cLine: "",
        });
      } else {
        setHoveredState({ memSlotId: "", line: hoveredLine, cLine: "" });
      }
    },
    [],
  );

  const handleLogLinesOut = useCallback(() => {
    setHoveredState({ memSlotId: "", line: -1, cLine: "" });
  }, []);

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.[0]) {
        const fileBlob = files[0];
        const reader = fileBlob
          .stream()
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let remainder = "";
        let eof = false;
        let rawLines: string[] = [];
        while (!eof) {
          let lines = [];
          const { done, value } = await reader.read();
          if (done) {
            eof = true;
            if (remainder.length > 0) lines.push(remainder);
          } else {
            lines = value.split("\n");
            lines[0] = remainder + lines[0];
            if (lines.length > 1) remainder = lines.pop() || "";
            else remainder = "";
          }
          rawLines = rawLines.concat(lines);
        }
        setVerifierLogState(processRawLines(rawLines));
      }
    },
    [],
  );

  return (
    <div className="App">
      <div className="container">
        <div className="navigation-panel">
          <h1>BPF Verifier Visualizer</h1>
          <LoadStatus lineCount={verifierLogState.lines.length} />
          <button
            id="goto-start"
            className="line-nav-item"
            onClick={onGotoStart}
          >
            Start
          </button>
          <button id="goto-end" className="line-nav-item" onClick={onGotoEnd}>
            End
          </button>
          <button id="clear" className="line-nav-item" onClick={onClear}>
            Clear
          </button>
          <label>
            <input
              type="checkbox"
              checked={fullLogView}
              onChange={onLogToggle}
              id="show-full-log"
            />
            Show Full Log
          </label>
          <div className="file-input-container">
            <input
              type="file"
              id="file-input"
              onChange={onFileInputChange}
              ref={fileInputRef}
            />
          </div>
          <Example />
          <a
            href="https://github.com/theihor/bpfvv/blob/master/HOWTO.md"
            className="howto-link"
            target="_blank"
            rel="noreferrer"
          >
            How To Use
          </a>
        </div>
        <Content
          loadError={loadError}
          verifierLogState={verifierLogState}
          logLines={logLines}
          selectedLine={selectedLine}
          selectedMemSlotId={selectedMemSlotId}
          selectedCLine={selectedCLine}
          handlePaste={handlePaste}
          handleMainContentClick={handleMainContentClick}
          handleCLinesClick={handleCLinesClick}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
        />
        <div id="hint">
          <SelectedLineHint
            selectedLine={selectedLine}
            selectedLineIdx={selectedLineIdx}
            lines={verifierLogState.lines}
          />
          <HoveredLineHint
            hoveredLine={hoveredState.line}
            hoveredLineIdx={hoveredLineIdx}
            lines={verifierLogState.lines}
          />
        </div>
      </div>
      {hoveredState.memSlotId &&
        verifierLogState.lines.length > 0 &&
        hoveredState.line > -1 && (
          <ToolTip
            verifierLogState={verifierLogState}
            hoveredLine={hoveredState.line}
            hoveredMemSlotId={hoveredState.memSlotId}
          />
        )}
    </div>
  );
}

export default App;
