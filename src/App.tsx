import React, { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListImperativeAPI, useListRef } from "react-window";

import {
  VerifierLogState,
  processRawLines,
  getEmptyVerifierState,
  getMemSlotDependencies,
} from "./analyzer";

import {
  fetchLogFromUrl,
  getVisibleLogLineRange,
  scrollToCLine,
  siblingInsLine,
  getVisibleLogLines,
  getVisibleCLines,
} from "./utils";

import {
  VisualLogState,
  LogLineState,
  HoveredLineHint,
  MainContent,
  SelectedLineHint,
  ToolTip,
  Examples,
} from "./components";
import { ParsedLineType } from "./parser";

function getEmptyVisualLogState(): VisualLogState {
  return {
    verifierLogState: getEmptyVerifierState(),
    logLines: [],
    logLineIdxToVisualIdx: new Map(),
    cLines: [],
    cLineIdToVisualIdx: new Map(),
    showFullLog: false,
  };
}

function getEmptyLogLineState(): LogLineState {
  return {
    memSlotId: "",
    line: 0,
    cLine: "",
  };
}

function getVisualLogState(
  verifierLogState: VerifierLogState,
  showFullLog: boolean,
): VisualLogState {
  const [logLines, logLineIdxToVisualIdx] = getVisibleLogLines(
    verifierLogState,
    showFullLog,
  );
  const [cLines, cLineIdToVisualIdx] = getVisibleCLines(verifierLogState);
  return {
    verifierLogState: verifierLogState,
    logLines,
    logLineIdxToVisualIdx,
    cLines,
    cLineIdToVisualIdx,
    showFullLog,
  };
}

const ContentRaw = ({
  loadError,
  visualLogState,
  selectedState,
  handlePaste,
  handleMainContentClick,
  handleCLinesClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
  handleStateRowClick,
  handleFullLogToggle,
  onGotoStart,
  onGotoEnd,
  logListRef,
  visualLogStart,
  visualLogEnd,
  onLogRowsRendered,
  testListHeight,
}: {
  loadError: string | null;
  visualLogState: VisualLogState;
  selectedState: LogLineState;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleStateRowClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleFullLogToggle: () => void;
  onGotoStart: () => void;
  onGotoEnd: () => void;
  logListRef: RefObject<ListImperativeAPI | null>;
  visualLogStart: number;
  visualLogEnd: number;
  onLogRowsRendered: (start: number, end: number) => void;
  testListHeight: number | undefined;
}) => {
  if (loadError) {
    return <div>{loadError}</div>;
  } else if (visualLogState.logLines.length > 0) {
    return (
      <MainContent
        visualLogState={visualLogState}
        selectedState={selectedState}
        handleCLinesClick={handleCLinesClick}
        handleMainContentClick={handleMainContentClick}
        handleLogLinesClick={handleLogLinesClick}
        handleLogLinesOver={handleLogLinesOver}
        handleLogLinesOut={handleLogLinesOut}
        handleStateRowClick={handleStateRowClick}
        handleFullLogToggle={handleFullLogToggle}
        onGotoStart={onGotoStart}
        onGotoEnd={onGotoEnd}
        logListRef={logListRef}
        visualLogStart={visualLogStart}
        visualLogEnd={visualLogEnd}
        onLogRowsRendered={onLogRowsRendered}
        testListHeight={testListHeight}
      />
    );
  } else {
    return (
      <textarea
        id="input-text"
        onPaste={handlePaste}
        placeholder="Paste a verifier log here, choose a file, or load an example log"
      />
    );
  }
};

const Content = React.memo(ContentRaw);

// testListHeight is only used in our unit tests because react-window
// doesn't seem to respond to scroll events in the virtual dom
// so we set the height manually to include more log lines
function App({ testListHeight }: { testListHeight?: number }) {
  const [visualLogState, setVisualLogState] = useState<VisualLogState>(
    getEmptyVisualLogState(),
  );
  const [hoveredState, setHoveredState] = useState<LogLineState>(
    getEmptyLogLineState(),
  );
  const [selectedState, setSelectedState] = useState<LogLineState>(
    getEmptyLogLineState(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [visualIndexRange, setVisualIndexRange] = useState<{
    visualLogStart: number;
    visualLogEnd: number;
  }>({ visualLogStart: 0, visualLogEnd: 0 });
  const onLogRowsRendered = useCallback((start: number, end: number) => {
    setVisualIndexRange({ visualLogStart: start, visualLogEnd: end });
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logListRef = useListRef(null);

  const {
    verifierLogState,
    cLines,
    cLineIdToVisualIdx,
    logLines,
    logLineIdxToVisualIdx,
  } = visualLogState;

  const { line: selectedLine } = selectedState;
  const selectedLineVisualIdx = logLineIdxToVisualIdx.get(selectedLine) || 0;
  const hoveredLineVisualIdx =
    logLineIdxToVisualIdx.get(hoveredState.line) || 0;

  const scrollToLogLine = useCallback(
    (index: number) => {
      if (index < 0) {
        return;
      }
      const list = logListRef.current;
      list?.scrollToRow({
        index,
        align: "center",
      });
    },
    [logListRef],
  );

  const setSelectedAndScroll = useCallback(
    (
      nextInsLineId: number,
      nextCLineId: string,
      nextInsLineVisualIdx: number,
      nextCLineVisualIdx: number,
      memSlotId: string = "",
    ) => {
      scrollToLogLine(nextInsLineVisualIdx);
      scrollToCLine(nextCLineVisualIdx, cLines.length);
      setSelectedState({ line: nextInsLineId, memSlotId, cLine: nextCLineId });
    },
    [logLines, cLineIdToVisualIdx],
  );

  const onGotoStart = useCallback(() => {
    if (logLines.length === 0) {
      return;
    }
    const lineId = logLines[0].idx;
    const clineId =
      verifierLogState.cSourceMap.logLineToCLine.get(lineId) || "";
    setSelectedAndScroll(lineId, "", 0, cLineIdToVisualIdx.get(clineId) || 0);
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
      cLineIdToVisualIdx.get(clineId) || 0,
    );
  }

  const onClear = useCallback(() => {
    setVisualLogState(getEmptyVisualLogState());
    setSelectedState({ line: 0, memSlotId: "", cLine: "" });
    const fiCurrent = fileInputRef.current;
    if (fiCurrent) {
      fiCurrent.value = "";
    }
  }, []);

  const handleFullLogToggle = useCallback(() => {
    setVisualLogState((prev) => {
      const [newLogLines, newLogLineIdToVisualIdx] = getVisibleLogLines(
        verifierLogState,
        !prev.showFullLog,
      );
      return {
        ...prev,
        logLines: newLogLines,
        logLineIdxToVisualIdx: newLogLineIdToVisualIdx,
        showFullLog: !prev.showFullLog,
      };
    });
  }, [verifierLogState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let delta = 0;
      let areCLinesInFocus = selectedState.cLine !== "";
      let min = 0;
      let max = 0;

      if (areCLinesInFocus) {
        const range = getVisibleLogLineRange(cLines.length);
        min = range.min;
        max = range.max;
      } else {
        min = visualIndexRange.visualLogStart;
        max = visualIndexRange.visualLogEnd;
      }
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
        const currentVisibleIdx =
          cLineIdToVisualIdx.get(selectedState.cLine) || 0;
        let nextVisibleIdx = currentVisibleIdx + delta;
        if (cLines[nextVisibleIdx] === "") {
          nextVisibleIdx += delta;
        }
        const logLines = verifierLogState.cSourceMap.cLineToLogLines.get(
          selectedState.cLine,
        );
        let logLineId = 0;
        if (logLines && logLines.size > 0) {
          [logLineId] = logLines;
        }
        const visualLogLineIdx = logLineIdxToVisualIdx.get(logLineId);
        setSelectedAndScroll(
          logLineId,
          cLines[nextVisibleIdx],
          visualLogLineIdx === undefined ? -1 : visualLogLineIdx,
          nextVisibleIdx,
        );
      } else {
        const currInsVisualIdx =
          logLineIdxToVisualIdx.get(selectedState.line) || 0;
        let nextInsVisualIdx = siblingInsLine(
          logLines,
          currInsVisualIdx,
          delta,
        );
        const logLineId = logLines[nextInsVisualIdx].idx;
        const cLineId =
          verifierLogState.cSourceMap.logLineToCLine.get(logLineId) || "";
        const visualCLineIdx = cLineIdToVisualIdx.get(cLineId);
        setSelectedAndScroll(
          logLineId,
          "",
          nextInsVisualIdx,
          visualCLineIdx === undefined ? -1 : visualCLineIdx,
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
    cLineIdToVisualIdx,
    selectedState,
    verifierLogState,
    logLineIdxToVisualIdx,
    onGotoStart,
    onGotoEnd,
  ]);

  // When a new log is loaded go to the last instruction
  useEffect(() => {
    const visualIdx = logLineIdxToVisualIdx.get(verifierLogState.lastInsIdx);
    if (visualIdx === undefined) {
      return;
    }
    const clineId =
      verifierLogState.cSourceMap.logLineToCLine.get(
        verifierLogState.lastInsIdx,
      ) || "";
    setSelectedAndScroll(
      verifierLogState.lastInsIdx,
      "",
      visualIdx,
      cLineIdToVisualIdx.get(clineId) || 0,
    );
  }, [verifierLogState]);

  const loadInputText = useCallback((text: string) => {
    const newVerifierLogState = processRawLines(text.split("\n"));
    setVisualLogState(getVisualLogState(newVerifierLogState, false));
    setIsLoading(false);
  }, []);

  const prepareNewLog = useCallback(() => {
    setSelectedState(getEmptyLogLineState());
    setIsLoading(true);
  }, []);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      prepareNewLog();
      const pastedText = event.clipboardData.getData("text");
      loadInputText(pastedText);
    },
    [loadInputText, prepareNewLog],
  );

  const handleLoadExample = useCallback(
    async (exampleLink: string) => {
      prepareNewLog();
      try {
        const response = await fetch(exampleLink);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.text();
        loadInputText(result);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    },
    [loadInputText, prepareNewLog],
  );

  function getServerInjectedInputLink(): string | null {
    const appInput = document.querySelector('meta[name="app-input"]');
    return appInput?.getAttribute("link") || null;
  }

  useEffect(() => {
    // first, check for server injected link
    // then for a query param
    let url: string | null = getServerInjectedInputLink();
    if (!url) {
      const params = new URLSearchParams(window.location.search);
      url = params.get("url");
    }
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
          logLineIdxToVisualIdx.get(firstItem) || 0,
          -1,
        );
      } else {
        setSelectedState({ line: 0, memSlotId: "", cLine: clineId });
      }
    },
    [verifierLogState, logLineIdxToVisualIdx, cLineIdToVisualIdx],
  );

  const handleStateRowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const memSlot = target.closest(".state-row");
      if (!memSlot) {
        return;
      }
      let memSlotId = memSlot.getAttribute("data-id") || "";
      e.stopPropagation();

      setSelectedState((prevSelectedState) => {
        let shouldScrollLogLines = true;

        const parsedLine = verifierLogState.lines[selectedLine];
        if (parsedLine.type == ParsedLineType.INSTRUCTION) {
          const bpfIns = parsedLine.bpfIns;
          if (
            bpfIns.reads.includes(memSlotId) ||
            bpfIns.writes.includes(memSlotId)
          ) {
            // the selected log line has the selectedMemSlotId
            // no need to scroll the panel
            shouldScrollLogLines = false;
          }
        }

        if (shouldScrollLogLines) {
          const deps = getMemSlotDependencies(
            verifierLogState,
            selectedLine,
            memSlotId,
          );
          const arr = Array.from(deps);
          arr.sort((a, b) => a - b);
          const maxIdx = arr[arr.length - 1];
          const visualIdx = logLineIdxToVisualIdx.get(maxIdx);
          if (visualIdx !== undefined) {
            scrollToLogLine(visualIdx);
          }
        }

        return {
          ...prevSelectedState,
          memSlotId,
        };
      });
    },
    [verifierLogState, logLineIdxToVisualIdx, selectedLine],
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
        const visualCLineIdx = cLineIdToVisualIdx.get(clineId);
        setSelectedAndScroll(
          lineId,
          "",
          -1,
          visualCLineIdx === undefined ? -1 : visualCLineIdx,
          memSlotId,
        );
      }
    },
    [logLines, verifierLogState, cLineIdToVisualIdx],
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
      prepareNewLog();
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
        const newVerifierLogState = processRawLines(rawLines);
        setVisualLogState(
          getVisualLogState(newVerifierLogState, visualLogState.showFullLog),
        );
        setIsLoading(false);
      }
    },
    [visualLogState],
  );

  return (
    <div className="App">
      <div className="container">
        <div className="navigation-panel">
          <h1>BPF Verifier Visualizer</h1>
          <div className="line-nav-item">
            <button id="clear" className="nav-button" onClick={onClear}>
              Clear
            </button>
          </div>
          <Examples handleLoadExample={handleLoadExample} />
          <div className="line-nav-item">
            <div className="file-input-container">
              <input
                type="file"
                id="file-input"
                onChange={onFileInputChange}
                ref={fileInputRef}
              />
            </div>
          </div>
          <div className="howto-container">
            <a
              href="https://github.com/theihor/bpfvv/blob/master/HOWTO.md"
              className="nav-button howto-link"
              target="_blank"
              rel="noreferrer"
            >
              How To Use
            </a>
          </div>
        </div>
        <Content
          loadError={loadError}
          visualLogState={visualLogState}
          selectedState={selectedState}
          handlePaste={handlePaste}
          handleMainContentClick={handleMainContentClick}
          handleCLinesClick={handleCLinesClick}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
          handleStateRowClick={handleStateRowClick}
          handleFullLogToggle={handleFullLogToggle}
          onGotoStart={onGotoStart}
          onGotoEnd={onGotoEnd}
          logListRef={logListRef}
          visualLogStart={visualIndexRange.visualLogStart}
          visualLogEnd={visualIndexRange.visualLogEnd}
          onLogRowsRendered={onLogRowsRendered}
          testListHeight={testListHeight}
        />
        <div id="hint">
          <SelectedLineHint
            selectedLine={selectedLine}
            visualIdx={selectedLineVisualIdx}
            lines={verifierLogState.lines}
          />
          <HoveredLineHint
            hoveredLine={hoveredState.line}
            visibleIdx={hoveredLineVisualIdx}
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
      {isLoading && (
        <div className="loader-container">
          <div className="loader-content">
            <div className="loader"></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
