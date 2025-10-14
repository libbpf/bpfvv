import React, { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListImperativeAPI, useListRef } from "react-window";

import {
  VerifierLogState,
  processRawLines,
  getEmptyVerifierState,
} from "./analyzer";

import {
  fetchLogFromUrl,
  scrollToCLine,
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
  setSelectedState,
  handlePaste,
  handleLogLinesOver,
  handleLogLinesOut,
  handleFullLogToggle,
  logListRef,
  testListHeight,
}: {
  loadError: string | null;
  visualLogState: VisualLogState;
  selectedState: LogLineState;
  setSelectedState: (value: React.SetStateAction<LogLineState>) => void;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleFullLogToggle: () => void;
  logListRef: RefObject<ListImperativeAPI | null>;
  testListHeight: number | undefined;
}) => {
  if (loadError) {
    return <div>{loadError}</div>;
  } else if (visualLogState.logLines.length > 0) {
    return (
      <MainContent
        visualLogState={visualLogState}
        selectedState={selectedState}
        setSelectedState={setSelectedState}
        handleLogLinesOver={handleLogLinesOver}
        handleLogLinesOut={handleLogLinesOut}
        handleFullLogToggle={handleFullLogToggle}
        logListRef={logListRef}
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
          setSelectedState={setSelectedState}
          handlePaste={handlePaste}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
          handleFullLogToggle={handleFullLogToggle}
          logListRef={logListRef}
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
