import React from "react";
import { useCallback, useEffect, useState } from "react";

import { VerifierLogState, processRawLines } from "./parser";

import {
  fetchLogFromUrl,
  getVisibleIdxRange,
  normalIdx,
  scrollToLine,
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

const ContentRaw = ({
  loadError,
  verifierLogState,
  selectedLine,
  selectedMemSlotId,
  handlePaste,
  handleMainContentClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  loadError: string | null;
  verifierLogState: VerifierLogState;
  selectedLine: number;
  selectedMemSlotId: string;
  handlePaste: (event: React.ClipboardEvent) => void;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  if (loadError) {
    return <div>{loadError}</div>;
  } else if (verifierLogState.lines.length > 0) {
    return (
      <MainContent
        verifierLogState={verifierLogState}
        selectedLine={selectedLine}
        selectedMemSlotId={selectedMemSlotId}
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
        placeholder="Paste the verifier log here or choose a file"
      />
    );
  }
};

const Content = React.memo(ContentRaw);

function App() {
  // 'r1', 'fp-244' etc.
  const [verifierLogState, setVerifierLogState] = useState<VerifierLogState>({
    lines: [],
    bpfStates: [],
  });
  const [hoveredState, setHoveredState] = useState<LogLineState>({
    memSlotId: "",
    line: -1,
  });
  const [selectedState, setSelectedState] = useState<LogLineState>({
    memSlotId: "",
    line: 0,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;

  const setSelectedLineScroll = useCallback(
    (nextSelected: number) => {
      const lines = verifierLogState.lines;
      setSelectedState((prevSelected) => {
        let { min, max } = getVisibleIdxRange(lines.length);
        if (nextSelected < min + 8 || nextSelected > max - 8) {
          scrollToLine(nextSelected, lines.length);
        }
        if (nextSelected < 0 || nextSelected >= lines.length) {
          return prevSelected;
        }
        return { line: nextSelected, memSlotId: "" };
      });
    },
    [verifierLogState],
  );

  const onGotoStart = useCallback(() => {
    setSelectedLineScroll(0);
  }, [setSelectedLineScroll]);

  const onGotoEnd = useCallback(() => {
    setSelectedLineScroll(verifierLogState.lines.length - 1);
  }, [setSelectedLineScroll, verifierLogState]);

  const onClear = useCallback(() => {
    setVerifierLogState({ lines: [], bpfStates: [] });
    setSelectedState({ line: 0, memSlotId: "" });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let delta = 0;
      let { min, max } = getVisibleIdxRange(verifierLogState.lines.length);
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
          setSelectedState((prevSelected) => {
            return { ...prevSelected, memSlotId: "" };
          });
          break;
        default:
          return;
      }
      e.preventDefault();
      setSelectedState({ line: selectedLine + delta, memSlotId: "" });
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    verifierLogState,
    selectedLine,
    setSelectedLineScroll,
    onGotoStart,
    onGotoEnd,
  ]);

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

  const handleMainContentClick = useCallback(() => {
    setSelectedState((prevSelected) => {
      return { ...prevSelected, memSlotId: "" };
    });
  }, []);

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
        const lineIndex = parseInt(
          clickedLine.getAttribute("line-index") || "0",
          10,
        );
        setSelectedState({
          line: normalIdx(lineIndex, verifierLogState.lines.length),
          memSlotId,
        });
      }
    },
    [verifierLogState],
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
        setHoveredState({ memSlotId: memSlot.id, line: hoveredLine });
      } else {
        setHoveredState({ memSlotId: "", line: hoveredLine });
      }
    },
    [],
  );

  const handleLogLinesOut = useCallback(() => {
    setHoveredState({ memSlotId: "", line: -1 });
  }, []);

  const onLineInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const lines = verifierLogState.lines;
      const newValue = parseInt(e.target.value, 10);
      if (Number.isNaN(newValue)) {
        return;
      }
      if (newValue <= 0) {
        setSelectedLineScroll(0);
      } else if (newValue > lines.length) {
        setSelectedLineScroll(lines.length - 1);
      } else {
        setSelectedLineScroll(newValue - 1);
      }
    },
    [verifierLogState, setSelectedLineScroll],
  );

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
        <div className="top-bar">
          <div className="file-input-container">
            <input type="file" id="file-input" onChange={onFileInputChange} />
            <LoadStatus lines={verifierLogState.lines} />
          </div>
          <a
            href="https://github.com/theihor/bpfvv/blob/master/HOWTO.md"
            className="howto-link"
            target="_blank"
            rel="noreferrer"
          >
            HOWTO.md
          </a>
        </div>
        <Example />
        <div className="navigation-panel">
          <label id="goto-line">Go to:</label>
          <input
            type="number"
            onChange={onLineInputChange}
            id="goto-line-input"
            placeholder="line number"
            min="0"
            max={verifierLogState.lines.length}
            value={selectedLine + 1}
          />
          <button id="goto-start" onClick={onGotoStart}>
            &lt;&lt;
          </button>
          <button id="goto-end" onClick={onGotoEnd}>
            &gt;&gt;
          </button>
          <button id="clear" onClick={onClear}>
            Clear
          </button>
        </div>
        <Content
          loadError={loadError}
          verifierLogState={verifierLogState}
          selectedLine={selectedLine}
          selectedMemSlotId={selectedMemSlotId}
          handlePaste={handlePaste}
          handleMainContentClick={handleMainContentClick}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
        />
        <div id="hint">
          <SelectedLineHint
            selectedLine={selectedLine}
            lines={verifierLogState.lines}
          />
          <HoveredLineHint
            hoveredLine={hoveredState.line}
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
