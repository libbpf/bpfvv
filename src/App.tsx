import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  VerifierLogState,
  processRawLines,
  getEmptyVerifierState,
} from "./analyzer";

import {
  fetchLogFromUrl,
  getVisibleLogLineRange,
  scrollToLogLine,
  scrollToCLine,
  siblingInsLine,
  getVisibleLogLines,
  getVisibleCLines,
} from "./utils";

import {
  VisualLogState,
  LogLineState,
  Example,
  HoveredLineHint,
  LoadStatus,
  MainContent,
  SelectedLineHint,
  ToolTip,
} from "./components";
import { ParsedLineType } from "./parser";

function getEmptyVisualLogState(): VisualLogState {
  return {
    verifierLogState: getEmptyVerifierState(),
    logLines: [],
    logLineIdxToVisualIdx: new Map(),
    cLines: [],
    cLineIdToVisualIdx: new Map(),
  };
}

function getVisualLogState(
  verifierLogState: VerifierLogState,
  fullLogView: boolean,
): VisualLogState {
  const [logLines, logLineIdxToVisualIdx] = getVisibleLogLines(
    verifierLogState,
    fullLogView,
  );
  const [cLines, cLineIdToVisualIdx] = getVisibleCLines(verifierLogState);
  return {
    verifierLogState: verifierLogState,
    logLines,
    logLineIdxToVisualIdx,
    cLines,
    cLineIdToVisualIdx,
  };
}

const ContentRaw = ({
  loadError,
  visualLogState,
  selectedLine,
  selectedMemSlotId,
  selectedCLine,
  handlePaste,
  handleMainContentClick,
  handleCLinesClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
  handleStateRowClick,
}: {
  loadError: string | null;
  visualLogState: VisualLogState;
  selectedLine: number;
  selectedMemSlotId: string;
  selectedCLine: number;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleStateRowClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  if (loadError) {
    return <div>{loadError}</div>;
  } else if (visualLogState.logLines.length > 0) {
    return (
      <MainContent
        visualLogState={visualLogState}
        selectedLine={selectedLine}
        selectedMemSlotId={selectedMemSlotId}
        selectedCLine={selectedCLine}
        handleCLinesClick={handleCLinesClick}
        handleMainContentClick={handleMainContentClick}
        handleLogLinesClick={handleLogLinesClick}
        handleLogLinesOver={handleLogLinesOver}
        handleLogLinesOut={handleLogLinesOut}
        handleStateRowClick={handleStateRowClick}
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
  const [visualLogState, setVisualLogState] = useState<VisualLogState>(
    getEmptyVisualLogState(),
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

  const {
    verifierLogState,
    cLines,
    cLineIdToVisualIdx,
    logLines,
    logLineIdxToVisualIdx,
  } = visualLogState;

  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;
  const selectedLineVisualIdx = logLineIdxToVisualIdx.get(selectedLine) || 0;
  const hoveredLineVisualIdx =
    logLineIdxToVisualIdx.get(hoveredState.line) || 0;
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
      nextInsLineVisualIdx: number,
      nextCLineVisualIdx: number,
      memSlotId: string = "",
    ) => {
      scrollToLogLine(nextInsLineVisualIdx, logLines.length);
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

  const onLogToggle = useCallback(() => {
    setfullLogView((prev) => !prev);
    const [newLogLines, newLogLineIdToVisualIdx] = getVisibleLogLines(
      verifierLogState,
      !fullLogView,
    );
    setVisualLogState((prev) => {
      return {
        ...prev,
        logLines: newLogLines,
        logLineIdxToVisualIdx: newLogLineIdToVisualIdx,
      };
    });
  }, [fullLogView, verifierLogState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let delta = 0;
      let areCLinesInFocus = selectedState.cLine !== "";
      let { min, max } = getVisibleLogLineRange(
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

  const loadInputText = useCallback(
    (text: string) => {
      const newVerifierLogState = processRawLines(text.split("\n"));
      setVisualLogState(getVisualLogState(newVerifierLogState, fullLogView));
    },
    [fullLogView],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const pastedText = event.clipboardData.getData("text");
      loadInputText(pastedText);
    },
    [loadInputText],
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
        return {
          ...prevSelectedState,
          memSlotId,
        };
      });
    },
    [],
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
        setVisualLogState(getVisualLogState(newVerifierLogState, fullLogView));
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
          visualLogState={visualLogState}
          selectedLine={selectedLine}
          selectedMemSlotId={selectedMemSlotId}
          selectedCLine={selectedCLine}
          handlePaste={handlePaste}
          handleMainContentClick={handleMainContentClick}
          handleCLinesClick={handleCLinesClick}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
          handleStateRowClick={handleStateRowClick}
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
    </div>
  );
}

export default App;
