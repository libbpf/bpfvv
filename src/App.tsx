import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ldb from "localdata";

import {
  VerifierLogState,
  processRawLines,
  getEmptyVerifierState,
} from "./analyzer";

import { fetchLogFromUrl } from "./utils";

import {
  VisualLogState,
  LogLineState,
  HoveredLineHint,
  MainContent,
  SelectedLineHint,
  ToolTip,
  Examples,
  CSourceRow,
  StoredLogs,
} from "./components";
import { getCLineId, ParsedLine, ParsedLineType } from "./parser";

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

function getVisibleLogLines(
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

function getVisibleCLines(
  verifierLogState: VerifierLogState,
  fileName: string = "",
  pastedLines: string[] = [],
): [CSourceRow[], Map<string, number>] {
  const cLineIdToVisualIdx: Map<string, number> = new Map();
  const cLines: CSourceRow[] = [];

  let j = 0;
  for (const [file, range] of verifierLogState.cSourceMap.fileRange) {
    cLines.push({
      type: "file_name",
      file,
    });
    ++j;

    if (file === fileName && pastedLines.length > 0) {
      pastedLines.forEach((lineText, i) => {
        const lineNum = i + 1;
        const sourceId = getCLineId(file, lineNum);
        cLines.push({
          type: "c_line",
          file,
          lineNum: i + 1,
          lineText,
          sourceId,
          ignore: false,
        });
        cLineIdToVisualIdx.set(sourceId, j);
        ++j;
      });
      continue;
    }

    let unknownStart = 0;
    for (let i = range[0]; i < range[1]; ++i) {
      const sourceId = getCLineId(file, i);
      const sourceLine = verifierLogState.cSourceMap.cSourceLines.get(sourceId);
      if (sourceLine?.lineNum === 0) {
        continue;
      }
      if (!sourceLine || sourceLine.ignore) {
        if (!unknownStart) {
          unknownStart = i;
        }
        continue;
      }
      if (unknownStart > 0) {
        cLines.push({
          type: "c_line",
          file,
          lineNum: unknownStart,
          lineText: `.. ${i - 1}`,
          sourceId: "none",
          ignore: true,
        });
        ++j;
      }
      unknownStart = 0;
      cLines.push({
        type: "c_line",
        file,
        lineNum: i,
        lineText: sourceLine.content,
        sourceId,
        ignore: false,
      });
      cLineIdToVisualIdx.set(sourceId, j);
      ++j;
    }
  }

  return [cLines, cLineIdToVisualIdx];
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
  testListHeight,
  addPastedCSourceFile,
}: {
  loadError: string | null;
  visualLogState: VisualLogState;
  selectedState: LogLineState;
  setSelectedState: (value: React.SetStateAction<LogLineState>) => void;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleFullLogToggle: () => void;
  testListHeight: number | undefined;
  addPastedCSourceFile: (fileName: string, pastedLines: string[]) => void;
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
        testListHeight={testListHeight}
        addPastedCSourceFile={addPastedCSourceFile}
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
  const [storedLogs, setStoredLogs] = useState<StoredLogs>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { verifierLogState, logLineIdxToVisualIdx } = visualLogState;

  const { line: selectedLine } = selectedState;
  const selectedLineVisualIdx = logLineIdxToVisualIdx.get(selectedLine) || 0;
  const hoveredLineVisualIdx =
    logLineIdxToVisualIdx.get(hoveredState.line) || 0;

  useEffect(() => {
    ldb.get("logs", function (value) {
      try {
        const logs: StoredLogs = JSON.parse(value);
        if (logs) {
          setStoredLogs(logs);
        }
      } catch (error) {
        console.error("Could not parse logs from local storage", error);
      }
    });
  }, []);

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

  const updateStoredLogs = useCallback(
    (lines: string[], name: string = "") => {
      const now = new Date();
      const nextName = name
        ? name
        : `pasted log (${now.toDateString().toLowerCase()} - ${now.toLocaleTimeString().toLocaleLowerCase()})`;
      // Only keep 5 stored logs for now
      const nextStoredLogs: StoredLogs = [
        [nextName, lines],
        ...storedLogs.slice(0, 5),
      ];
      ldb.set("logs", JSON.stringify(nextStoredLogs));
      setStoredLogs(nextStoredLogs);
    },
    [storedLogs],
  );

  const loadLog = useCallback((lines: string[]) => {
    const newVerifierLogState = processRawLines(lines);
    setVisualLogState(getVisualLogState(newVerifierLogState, false));
    setIsLoading(false);
  }, []);

  const addPastedCSourceFile = useCallback(
    (fileName: string, pastedLines: string[]) => {
      setVisualLogState((prevState) => {
        const [cLines, cLineIdToVisualIdx] = getVisibleCLines(
          verifierLogState,
          fileName,
          pastedLines,
        );
        return {
          ...prevState,
          cLines,
          cLineIdToVisualIdx,
        };
      });
    },
    [verifierLogState],
  );

  const loadInputText = useCallback(
    (text: string) => {
      const rawLines = text.split("\n");
      loadLog(rawLines);
      updateStoredLogs(rawLines);
    },
    [updateStoredLogs],
  );

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
    async (example: string, isLink: boolean) => {
      prepareNewLog();
      if (isLink) {
        try {
          const response = await fetch(example);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const result = await response.text();
          const rawLines = result.split("\n");
          loadLog(rawLines);
        } catch (error) {
          console.error("Error fetching data:", error);
        }
      } else {
        const found = storedLogs.find((storedLog) => storedLog[0] === example);
        if (!found) {
          console.error("Couldn't load previous log", example);
        } else {
          loadLog(found[1]);
        }
      }
    },
    [loadInputText, prepareNewLog, storedLogs],
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
        updateStoredLogs(rawLines, fileBlob.name);
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
          <Examples
            storedLogs={storedLogs}
            handleLoadExample={handleLoadExample}
          />
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
          testListHeight={testListHeight}
          addPastedCSourceFile={addPastedCSourceFile}
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
