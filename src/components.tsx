import React, { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BpfJmpKind,
  BpfOperand,
  Effect,
  OperandType,
  ParsedLine,
  ParsedLineType,
  BpfJmpInstruction,
  BpfInstructionKind,
  BpfConditionalJmpInstruction,
  BpfTargetJmpInstruction,
  InstructionLine,
} from "./parser";
import { CSourceMap, getMemSlotDependencies } from "./analyzer";

import { BpfState, getBpfState, VerifierLogState } from "./analyzer";

import { getVisibleIdxRange, scrollToLogLine } from "./utils";

import BPF_HELPERS_JSON from "./bpf-helpers.json";

export type LogLineState = {
  memSlotId: string;
  line: number;
  cLine: string;
};

type HelperArg = {
  type: string;
  star: string | null;
  name: string | null;
};

function isVoidHelperArg(arg: HelperArg) {
  return arg.type === "void" && arg.name === null && arg.star === null;
}

function getMemSlotDomId(memSlot: string, lineIdx: number): string {
  return `mem-slot-${memSlot}-line-${lineIdx}`;
}

function getDepArrowDomId(lineIdx: number): string {
  return `dep-arrow-line-${lineIdx}`;
}

let bpfHelpersMap = new Map<string, HelperArg[]>();

for (const helper of BPF_HELPERS_JSON.helpers) {
  let args = helper.args.filter((arg) => !isVoidHelperArg(arg));
  bpfHelpersMap.set(helper.name, args);
}

const RIGHT_ARROW = "->";

function CallHtml({
  ins,
  line,
  state,
}: {
  ins: BpfTargetJmpInstruction;
  line: ParsedLine;
  state: BpfState;
}) {
  const location = ins.location;
  if (!location) {
    return <></>;
  }
  const target = ins.target || "";
  const helperName = target.substring(0, target.indexOf("#"));

  const args = bpfHelpersMap.get(helperName);

  let contents: ReactElement[] = [];
  if (args) {
    let i = 1;

    for (const arg of args) {
      const key = `call_html_${i}`;
      const reg = `r${i}`;
      if (typeof arg.name === "string") {
        const display = `${arg.name}: r${i}`;
        contents.push(
          <RegSpan lineIdx={line.idx} reg={reg} display={display} key={key} />,
        );
      } else {
        contents.push(
          <RegSpan
            lineIdx={line.idx}
            reg={reg}
            display={undefined}
            key={key}
          />,
        );
      }
      if (i < args.length) {
        contents.push(<span key={`call_html_comma_${i}`}>, </span>);
      }
      i += 1;
    }
    const link =
      "https://docs.ebpf.io/linux/helper-function/" + helperName + "/";
    return (
      <>
        <a href={link} target="_blank" rel="noreferrer">
          {helperName}
        </a>
        ({contents})
      </>
    );
  } else {
    let numArgs = 0;

    // Guess the number of args from registers that had non-scratched value
    for (let i = 1; i <= 5; i++) {
      const value = state.values.get(`r${i}`);
      if (value?.effect === Effect.UPDATE && value?.prevValue) {
        numArgs = i;
      }
    }

    let contents: ReactElement[] = [];
    contents.push(<React.Fragment key="line-start">{target}</React.Fragment>);

    contents.push(<React.Fragment key="paren-open">(</React.Fragment>);
    for (let i = 1; i <= numArgs; i++) {
      const reg = `r${i}`;
      contents.push(
        <RegSpan
          lineIdx={line.idx}
          reg={reg}
          display={undefined}
          key={`call_html_${reg}`}
        />,
      );
      if (i < numArgs)
        contents.push(
          <React.Fragment key={`call_html_comma_${i}`}>, </React.Fragment>,
        );
    }
    contents.push(<React.Fragment key="paren-closed">)</React.Fragment>);
    return <>{contents}</>;
  }
}

export function Example() {
  const url = document
    .querySelector('meta[name="app-example-input"]')
    ?.getAttribute("link");
  if (url) {
    return (
      <a id="example-link" href={`${window.location.pathname}?url=${url}`}>
        Load an example log
      </a>
    );
  } else {
    return <></>;
  }
}

function ExitInstruction({ frame }: { frame: number }) {
  return (
    <b>
      {"}"} exit ; return to stack frame {frame}
    </b>
  );
}

export function HoveredLineHint({
  hoveredLine,
  hoveredLineIdx,
  lines,
}: {
  hoveredLine: number;
  hoveredLineIdx: number;
  lines: ParsedLine[];
}) {
  if (lines.length === 0 || hoveredLine < 0) {
    return (
      <div id="hint-hovered-line" className="hint-line">
        <br />
      </div>
    );
  }
  return (
    <div id="hint-hovered-line" className="hint-line">
      <span>[hovered raw line] {hoveredLineIdx + 1}:</span>&nbsp;
      {lines[hoveredLine].raw}
    </div>
  );
}

function ConditionalJmpInstruction({
  ins,
  line,
}: {
  ins: BpfConditionalJmpInstruction;
  line: ParsedLine;
}) {
  return (
    <>
      if (
      <MemSlot line={line} op={ins.cond.left} />
      &nbsp;{ins.cond.op}&nbsp;
      <MemSlot line={line} op={ins.cond.right} />
      )&nbsp;goto&nbsp;{ins.target}
    </>
  );
}

export function JmpInstruction({
  ins,
  line,
  state,
}: {
  ins: BpfJmpInstruction;
  line: ParsedLine;
  state: BpfState;
}) {
  switch (ins.jmpKind) {
    case BpfJmpKind.SUBPROGRAM_CALL:
      return (
        <b>
          <CallHtml ins={ins} line={line} state={state} />
          {" {"} ; enter new stack frame {state.frame}
        </b>
      );
    case BpfJmpKind.EXIT:
      return <ExitInstruction frame={state.frame} />;
    case BpfJmpKind.HELPER_CALL:
      return (
        <>
          <RegSpan lineIdx={line.idx} reg={"r0"} display={undefined} />
          &nbsp;=&nbsp;
          <CallHtml ins={ins} line={line} state={state} />
        </>
      );
    case BpfJmpKind.UNCONDITIONAL_GOTO:
    case BpfJmpKind.MAY_GOTO:
    case BpfJmpKind.GOTO_OR_NOP:
      return (
        <>
          {ins.goto}&nbsp;{ins.target}
        </>
      );
    case BpfJmpKind.CONDITIONAL_GOTO:
      return <ConditionalJmpInstruction ins={ins} line={line} />;
  }
}

export function LoadStatus({ lineCount }: { lineCount: number }) {
  return (
    <div id="load-status" className="line-nav-item">
      ({lineCount} lines)
    </div>
  );
}

function InstructionLineContent({
  line,
  state,
}: {
  line: InstructionLine;
  state: BpfState;
}) {
  const ins = line.bpfIns;
  switch (ins.kind) {
    case BpfInstructionKind.ALU:
      return (
        <>
          <MemSlot line={line} op={ins.dst} />
          &nbsp;{ins.operator}&nbsp;
          <MemSlot line={line} op={ins.src} />
        </>
      );
    case BpfInstructionKind.JMP:
      return <JmpInstruction ins={ins} line={line} state={state} />;
    case BpfInstructionKind.ADDR_SPACE_CAST:
      return (
        <>
          <MemSlot line={line} op={ins.dst} />
          {" = addr_space_cast("}
          <MemSlot line={line} op={ins.src} />
          {`, ${ins.directionStr})`}
        </>
      );
  }
}

const LogLineRaw = ({
  line,
  state,
  indentLevel,
  idx,
}: {
  line: ParsedLine;
  state: BpfState;
  indentLevel: number;
  idx: number;
}) => {
  let content;
  const topClasses = ["log-line"];

  switch (line.type) {
    case ParsedLineType.INSTRUCTION:
      topClasses.push("normal-line");
      content = InstructionLineContent({ line, state });
      break;
    case ParsedLineType.C_SOURCE:
      topClasses.push("inline-c-source-line");
      content = <>{line.raw}</>;
      break;
    default:
      topClasses.push("ignorable-line");
      content = <>{line.raw}</>;
      break;
  }

  const lineId = "line-" + idx;
  const indentSpans: ReactElement[] = [];

  for (let i = 1; i < indentLevel; ++i) {
    indentSpans.push(
      <span key={`indent-line${i}`} className="line-indent"></span>,
    );
  }

  return (
    <div line-index={idx} id={lineId} className={topClasses.join(" ")}>
      {indentSpans}
      {content}
    </div>
  );
};

const LogLine = React.memo(LogLineRaw);

function getMemSlotDisplayValue(
  verifierLogState: BpfState,
  prevBpfState: BpfState,
  memSlotId: string,
) {
  const prevValue = prevBpfState.values.get(memSlotId);
  const value = verifierLogState.values.get(memSlotId);
  switch (value?.effect) {
    case Effect.WRITE:
    case Effect.UPDATE:
      let newVal = value?.value;
      let oldVal = prevValue?.value || "";
      if (newVal === oldVal) {
        if (!newVal) {
          return null;
        }
        return () => {
          return <>{newVal}</>;
        };
      } else if (newVal) {
        return () => {
          return (
            <>
              {oldVal} {RIGHT_ARROW} {newVal}
            </>
          );
        };
      } else {
        return () => {
          return (
            <>
              {oldVal} <span className="scratched">-{">"} scratched</span>
            </>
          );
        };
      }
    case Effect.READ:
    case Effect.NONE:
    default:
      return () => {
        return <>{value?.value || ""}</>;
      };
  }
}

export function MemSlot({
  line,
  op,
}: {
  line: ParsedLine;
  op: BpfOperand | undefined;
}) {
  if (!op) {
    return <>{line.raw}</>;
  }
  const start = line.raw.length + (op.location?.offset || 0);
  const end = start + (op.location?.size || 0);
  const memSlotString = line.raw.slice(start, end);
  switch (op.type) {
    case OperandType.REG:
    case OperandType.FP:
      return <RegSpan lineIdx={line.idx} reg={op.id} display={memSlotString} />;
    case OperandType.MEM:
      // find register position and make a span around it
      const regStart = memSlotString.search(/r[0-9]/);
      const regEnd = regStart + 2;
      const reg = memSlotString.slice(regStart, regEnd);
      return (
        <>
          {memSlotString.slice(0, regStart)}
          <RegSpan lineIdx={line.idx} reg={reg} display={reg} />
          {memSlotString.slice(regEnd)}
        </>
      );
    default:
      return <>{memSlotString}</>;
  }
}

const RegSpan = ({
  reg,
  display,
  lineIdx,
}: {
  reg: string;
  display: string | undefined;
  lineIdx: number;
}) => {
  const classNames = ["mem-slot", reg];
  return (
    <span
      id={getMemSlotDomId(reg, lineIdx)}
      className={classNames.join(" ")}
      data-id={reg}
    >
      {display || reg}
    </span>
  );
};

export function SelectedLineHint({
  selectedLine,
  selectedLineIdx,
  lines,
}: {
  selectedLine: number;
  selectedLineIdx: number;
  lines: ParsedLine[];
}) {
  if (lines.length === 0) {
    return <></>;
  }
  return (
    <div id="hint-selected-line" className="hint-line">
      <span>[selected raw line] {selectedLineIdx + 1}:</span>&nbsp;
      {lines[selectedLine].raw}
    </div>
  );
}

function HideShowButton({
  isVisible,
  rightOpen,
  name,
  handleHideShowClick,
}: {
  isVisible: boolean;
  rightOpen: boolean;
  name: string;
  handleHideShowClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const classList = ["hide-show-button"];
  if (rightOpen) {
    classList.push("right");
  } else {
    classList.push("left");
  }

  if (!isVisible) {
    classList.push("hidden");
  }

  return (
    <div className={classList.join(" ")} onClick={handleHideShowClick}>
      {isVisible ? (rightOpen ? "⇒" : "⇐") : rightOpen ? "⇐" : "⇒"}
      <div className="hide-show-tooltip">
        {isVisible ? "Hide" : "Show"}&nbsp;{name}
      </div>
    </div>
  );
}

function StatePanelRaw({
  selectedLine,
  selectedCLine,
  verifierLogState,
}: {
  selectedLine: number;
  selectedCLine: number;
  verifierLogState: VerifierLogState;
}) {
  const { lines, bpfStates } = verifierLogState;
  let rows: ReactElement[] = [];
  const { state: bpfState, idx } = getBpfState(bpfStates, selectedLine);
  const prevBpfState = getBpfState(bpfStates, idx - 1).state;
  const [isVisible, setIsVisible] = useState<boolean>(true);

  const handleHideShowClick = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, [setIsVisible]);

  let rowCounter = 1;

  const addRow = (id: string) => {
    let className = "";
    const line = lines[selectedLine];
    if (line?.type === ParsedLineType.INSTRUCTION) {
      const value = bpfState.values.get(id);
      switch (value?.effect) {
        case Effect.WRITE:
        case Effect.UPDATE:
          className = "effect-write";
          break;
        case Effect.READ:
          className = "effect-read";
          break;
        case Effect.NONE:
        default:
          break;
      }
    }

    const contentFunc = getMemSlotDisplayValue(bpfState, prevBpfState, id);

    rows.push(
      <tr className={className} key={rowCounter}>
        <td>{id}</td>
        <td>
          <span>{contentFunc ? contentFunc() : ""}</span>
        </td>
      </tr>,
    );

    ++rowCounter;
  };

  // first add the registers
  for (let i = 0; i <= 10; i++) {
    addRow(`r${i}`);
  }

  // then the stack
  for (let i = 0; i <= 512; i++) {
    const key = `fp-${i}`;
    if (bpfState.values.has(key)) addRow(key);
  }

  // then the rest
  const sortedValues: string[] = [];
  for (const key of bpfState.values.keys()) {
    if (!key.startsWith("r") && !key.startsWith("fp-") && key !== "MEM") {
      sortedValues.push(key);
    }
  }
  sortedValues.sort((a, b) => a.localeCompare(b));
  for (const key of sortedValues) {
    addRow(key);
  }

  if (!isVisible) {
    return (
      <div className="state-panel panel-hidden">
        <HideShowButton
          isVisible={isVisible}
          rightOpen={true}
          name="state panel"
          handleHideShowClick={handleHideShowClick}
        />
      </div>
    );
  }

  return (
    <div id="state-panel" className="state-panel">
      <div id="state-panel-header">
        <div>Log Line: {selectedLine + 1}</div>
        <div>C Line: {selectedCLine}</div>
        <div>PC: {bpfState.pc}</div>
        <div>Frame: {bpfState.frame}</div>
      </div>
      <HideShowButton
        isVisible={isVisible}
        rightOpen={true}
        name="state panel"
        handleHideShowClick={handleHideShowClick}
      />
      <table>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

const StatePanel = React.memo(StatePanelRaw);

export function ToolTip({
  verifierLogState,
  hoveredLine,
  hoveredMemSlotId,
}: {
  verifierLogState: VerifierLogState;
  hoveredLine: number;
  hoveredMemSlotId: string;
}) {
  const toolTipRef = useRef<HTMLInputElement>(null);
  const [toolTipWidth, setToolTipWidth] = useState(0);
  useEffect(() => {
    if (!toolTipRef) {
      return;
    }
    const cur = toolTipRef.current;
    if (!cur) {
      return;
    }
    setToolTipWidth(cur.offsetWidth);
  }, [hoveredMemSlotId]);

  const { bpfStates, lines } = verifierLogState;

  const domLine = document.getElementById("line-" + hoveredLine);
  let contentFunc = null;
  let toolTipStyle = {
    display: "none",
    left: "0px",
    top: "0px",
  };
  let arrowStyle = {
    display: "none",
    left: "0px",
    top: "0px",
  };
  if (domLine && hoveredMemSlotId && lines.length !== 0) {
    const { state: verifierLogState, idx } = getBpfState(
      bpfStates,
      hoveredLine,
    );
    const prevBpfState = getBpfState(bpfStates, idx - 1).state;
    const memSlot = document.getElementById(hoveredMemSlotId);
    if (!memSlot) {
      return <></>;
    }

    const memSlotId = memSlot.getAttribute("data-id") || "";

    contentFunc = getMemSlotDisplayValue(
      verifierLogState,
      prevBpfState,
      memSlotId,
    );

    if (contentFunc) {
      const rect = memSlot.getBoundingClientRect();
      const tooltipLeft = Math.max(
        0,
        rect.left - toolTipWidth / 2 + rect.width / 2,
      );

      toolTipStyle = {
        display: "block",
        left: `${tooltipLeft}px`,
        top: `${rect.bottom + 5}px`,
      };

      const arrowLeft = Math.max(0, rect.left + rect.width / 2);

      arrowStyle = {
        display: "block",
        left: `${arrowLeft}px`,
        top: `${rect.bottom}px`,
      };
    }
  }
  return (
    <>
      <div id="mem-slot-tooltip" style={toolTipStyle} ref={toolTipRef}>
        {contentFunc ? contentFunc() : ""}
      </div>
      <div id="mem-slot-tooltip-arrow" style={arrowStyle}></div>
    </>
  );
}

const LogLinesRaw = ({
  verifierLogState,
  logLines,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  verifierLogState: VerifierLogState;
  logLines: ParsedLine[];
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { bpfStates } = verifierLogState;
  let indentLevel = 0;
  return (
    <div
      id="formatted-log-lines"
      onClick={handleLogLinesClick}
      onMouseOver={handleLogLinesOver}
      onMouseOut={handleLogLinesOut}
    >
      {logLines.map((line) => {
        const bpfState = getBpfState(bpfStates, line.idx).state;
        const frame = bpfState.frame;
        indentLevel = frame;
        if (
          line.type === ParsedLineType.INSTRUCTION &&
          line.bpfIns.kind === BpfInstructionKind.JMP &&
          line.bpfIns.jmpKind === BpfJmpKind.SUBPROGRAM_CALL
        ) {
          indentLevel -= 1;
        }
        return (
          <LogLine
            indentLevel={indentLevel}
            state={bpfState}
            line={line}
            idx={line.idx}
            key={`log_line_${line.idx}`}
          />
        );
      })}
    </div>
  );
};

const LogLines = React.memo(LogLinesRaw);

const LineNumbersPCRaw = ({ logLines }: { logLines: ParsedLine[] }) => {
  return (
    <div id="line-numbers-pc" className="line-numbers">
      {logLines.map((line) => {
        return (
          <div className="line-numbers-line" key={`line_num_pc_${line.idx}`}>
            {line.type === ParsedLineType.INSTRUCTION
              ? line.bpfIns.pc + ":"
              : "\n"}
          </div>
        );
      })}
    </div>
  );
};

const LineNumbersPC = React.memo(LineNumbersPCRaw);

const DependencyArrowsRaw = ({ logLines }: { logLines: ParsedLine[] }) => {
  return (
    <>
      {logLines.map((line) => {
        return (
          <div
            className="dep-arrow"
            line-index={line.idx}
            id={getDepArrowDomId(line.idx)}
            key={`dependency-arrow-${line.idx}`}
          ></div>
        );
      })}
    </>
  );
};

const DependencyArrowsPlain = React.memo(DependencyArrowsRaw);

function CSourceFile({
  file,
  range,
  cSourceMap,
}: {
  file: string;
  range: [number, number];
  cSourceMap: CSourceMap;
}) {
  const lineNums: ReactElement[] = [];
  const sourceLines: ReactElement[] = [];

  let unknownStart = 0;
  for (let i = range[0]; i < range[1]; ++i) {
    const sourceId = `${file}:${i}`;
    const sourceLine = cSourceMap.cSourceLines.get(sourceId);
    if (!sourceLine) {
      if (!unknownStart) {
        unknownStart = i;
      }
      continue;
    }
    if (unknownStart > 0) {
      lineNums.push(
        <div
          className="line-numbers-line"
          key={`c_line_num_${file}-${unknownStart}`}
        >
          {unknownStart}
        </div>,
      );
      sourceLines.push(
        <div
          className="c-source-line ignorable-line"
          key={`c_source_line_${file}-${unknownStart}`}
        >
          ..&nbsp;{i - 1}
        </div>,
      );
    }
    unknownStart = 0;
    lineNums.push(
      <div className="line-numbers-line" key={`c_line_num_${i}`}>
        {i}
      </div>,
    );
    sourceLines.push(
      <div
        className="c-source-line"
        id={`line-${sourceId}`}
        data-id={sourceId}
        key={`c_source_line_${i}`}
      >
        {sourceLine.content}
      </div>,
    );
  }

  return (
    <div className="c-source-file">
      <div className="filename-header">{file}</div>
      <div className="file-lines">
        <div className="line-numbers">{lineNums}</div>
        <div className="source-lines">{sourceLines}</div>
      </div>
    </div>
  );
}

function CSourceLinesRaw({
  handleCLinesClick,
  verifierLogState,
}: {
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  verifierLogState: VerifierLogState;
}) {
  const [isVisible, setIsVisible] = useState<boolean>(true);

  const handleHideShowClick = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, [setIsVisible]);

  if (!isVisible) {
    return (
      <div className="c-source-panel panel-hidden">
        <HideShowButton
          isVisible={isVisible}
          rightOpen={false}
          name="C source lines"
          handleHideShowClick={handleHideShowClick}
        />
      </div>
    );
  }

  const files: ReactElement[] = [];
  for (const [file, range] of verifierLogState.cSourceMap.fileRange) {
    files.push(
      <CSourceFile
        key={`filename-${file}`}
        cSourceMap={verifierLogState.cSourceMap}
        file={file}
        range={range}
      />,
    );
  }

  return (
    <div
      id="c-source-container"
      className="c-source-panel"
      onClick={handleCLinesClick}
    >
      {files}
      <HideShowButton
        isVisible={isVisible}
        rightOpen={false}
        name="C source lines"
        handleHideShowClick={handleHideShowClick}
      />
    </div>
  );
}

const CSourceLines = React.memo(CSourceLinesRaw);

export function MainContent({
  verifierLogState,
  logLines,
  selectedLine,
  selectedMemSlotId,
  selectedCLine,
  handleMainContentClick,
  handleCLinesClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  verifierLogState: VerifierLogState;
  logLines: ParsedLine[];
  selectedLine: number;
  selectedMemSlotId: string;
  selectedCLine: number;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const memSlotDependencies: number[] = useMemo(() => {
    const lines = verifierLogState.lines;
    if (lines.length === 0) {
      return [];
    }
    const line = lines[selectedLine];
    if (line.type !== ParsedLineType.INSTRUCTION) return [];
    const ins = line.bpfIns;
    // if user clicked on a mem slot that is written to,
    // then switch target to the first read slot
    let memSlotId = selectedMemSlotId;
    if (
      !ins.reads.find((id) => id === memSlotId) &&
      ins.writes.find((id) => id === memSlotId) &&
      ins.reads.length === 1
    ) {
      memSlotId = ins.reads[0];
    }
    const deps = getMemSlotDependencies(
      verifierLogState,
      selectedLine,
      memSlotId,
    );
    const arr = Array.from(deps);
    arr.sort((a, b) => a - b);
    return arr;
  }, [selectedMemSlotId, selectedLine, verifierLogState]);

  useEffect(() => {
    const selectedLogLine = document.getElementById(`line-${selectedLine}`);
    if (selectedLogLine) {
      selectedLogLine.classList.add("selected-line");
    }

    const logLinesUpdated: [number, string][] = [];
    const cLinesUpdated: string[] = [];

    let selectedMemSlotIdEl: HTMLElement | null;

    if (selectedMemSlotId !== "") {
      selectedMemSlotIdEl = document.getElementById(
        `mem-slot-${selectedMemSlotId}-line-${selectedLine}`,
      );

      if (selectedMemSlotIdEl) {
        selectedMemSlotIdEl.classList.add("selected-mem-slot");
      }

      const relevantCLineIds: Set<string> = new Set();
      for (const idx of [selectedLine, ...memSlotDependencies]) {
        const cLineId = verifierLogState.cSourceMap.logLineToCLine.get(idx);
        if (cLineId) {
          relevantCLineIds.add(cLineId);
        }
      }

      verifierLogState.lines.forEach((line) => {
        const idx = line.idx;
        if (selectedLine === idx) {
          return;
        }
        if (
          line.type === ParsedLineType.UNRECOGNIZED ||
          (line.type === ParsedLineType.INSTRUCTION &&
            !memSlotDependencies.includes(idx)) ||
          (line.type === ParsedLineType.C_SOURCE &&
            !relevantCLineIds.has(line.id))
        ) {
          return;
        }

        const cLine = verifierLogState.cSourceMap.logLineToCLine.get(idx);
        if (cLine) {
          const cLineEl = document.getElementById(`line-${cLine}`);
          if (cLineEl) {
            cLineEl.classList.add("dependency-line");
            cLinesUpdated.push(cLine);
          }
        }

        const logLine = document.getElementById(`line-${idx}`);
        if (logLine) {
          logLine.classList.add("dependency-line");
          logLinesUpdated.push([idx, selectedMemSlotId]);
        }

        const memSlot = document.getElementById(
          getMemSlotDomId(selectedMemSlotId, idx),
        );
        if (memSlot) {
          memSlot.classList.add("dependency-mem-slot");
        }
      });
    }

    return () => {
      if (selectedLogLine) {
        selectedLogLine.classList.remove("selected-line");
      }
      if (selectedMemSlotIdEl) {
        selectedMemSlotIdEl.classList.remove("selected-mem-slot");
      }
      if (selectedMemSlotId !== "") {
        cLinesUpdated.forEach((cLine) => {
          const cLineEl = document.getElementById(`line-${cLine}`);
          if (cLineEl) {
            cLineEl.classList.remove("dependency-line");
          }
        });
        logLinesUpdated.forEach((pair) => {
          const logLine = document.getElementById(`line-${pair[0]}`);
          if (logLine) {
            logLine.classList.remove("dependency-line");
          }
          const memSlot = document.getElementById(
            getMemSlotDomId(pair[1], pair[0]),
          );
          if (memSlot) {
            memSlot.classList.remove("dependency-mem-slot");
          }
        });
      }
    };
  }, [selectedLine, selectedMemSlotId, memSlotDependencies, verifierLogState]);

  useEffect(() => {
    if (
      selectedMemSlotId === "" ||
      memSlotDependencies.length === 0 ||
      memSlotDependencies[0] === selectedLine
    ) {
      return;
    }

    const depArrowSelected = document.getElementById(
      getDepArrowDomId(selectedLine),
    );
    if (depArrowSelected) {
      depArrowSelected.classList.add("dep-end");
    }

    const minIdx = memSlotDependencies[0];
    const maxIdx = selectedLine;

    for (let idx = minIdx; idx < maxIdx; idx++) {
      if (idx === minIdx) {
        const depArrowStart = document.getElementById(getDepArrowDomId(idx));
        if (depArrowStart) {
          depArrowStart.classList.add("dep-start");
        }
      } else if (memSlotDependencies.includes(idx)) {
        const depArrowMid = document.getElementById(getDepArrowDomId(idx));
        if (depArrowMid) {
          depArrowMid.classList.add("dep-mid");
        }
      } else if (minIdx < idx && idx < selectedLine) {
        const depArrowTrack = document.getElementById(getDepArrowDomId(idx));
        if (depArrowTrack) {
          depArrowTrack.classList.add("dep-track");
        }
      }
    }

    return () => {
      if (depArrowSelected) {
        depArrowSelected.classList.remove("dep-end");
      }
      for (let idx = minIdx; idx < maxIdx; idx++) {
        if (idx === minIdx) {
          const depArrowStart = document.getElementById(getDepArrowDomId(idx));
          if (depArrowStart) {
            depArrowStart.classList.remove("dep-start");
          }
        } else if (memSlotDependencies.includes(idx)) {
          const depArrowMid = document.getElementById(getDepArrowDomId(idx));
          if (depArrowMid) {
            depArrowMid.classList.remove("dep-mid");
          }
        } else if (minIdx < idx && idx < selectedLine) {
          const depArrowTrack = document.getElementById(getDepArrowDomId(idx));
          if (depArrowTrack) {
            depArrowTrack.classList.remove("dep-track");
          }
        }
      }
    };
  }, [selectedLine, selectedMemSlotId, memSlotDependencies, verifierLogState]);

  const handleArrowsClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hoveredElement = e.target as HTMLElement;
      e.stopPropagation();
      const depArrow = hoveredElement.closest(".dep-track") as HTMLElement;
      if (!depArrow) {
        return;
      }
      const idx = parseInt(depArrow.getAttribute("line-index") || "0", 10);
      const idxs = [...memSlotDependencies, selectedLine];

      let prev = idxs[0];
      let next = idxs[idxs.length - 1];
      for (let i = 1; i < idxs.length; i++) {
        if (idxs[i] > idx) {
          next = idxs[i];
          break;
        } else {
          prev = idxs[i];
        }
      }

      if (depArrow.classList.contains("active-down")) {
        scrollToLogLine(next, verifierLogState.lines.length);
      } else if (depArrow.classList.contains("active-up")) {
        scrollToLogLine(prev, verifierLogState.lines.length);
      }
    },
    [verifierLogState, memSlotDependencies, selectedLine],
  );

  const handleArrowsOver = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hoveredElement = e.target as HTMLElement;
      const depArrow = hoveredElement.closest(".dep-track") as HTMLElement;
      if (!depArrow) {
        return;
      }
      const idx = parseInt(depArrow.getAttribute("line-index") || "0", 10);
      const idxs = [...memSlotDependencies, selectedLine];

      let prev = idxs[0];
      let next = idxs[idxs.length - 1];
      for (let i = 1; i < idxs.length; i++) {
        if (idxs[i] > idx) {
          next = idxs[i];
          break;
        } else {
          prev = idxs[i];
        }
      }

      let { min, max } = getVisibleIdxRange(verifierLogState.lines.length);
      const isVisible = (idx: number) => {
        return min < idx && idx < max;
      };
      const setTargetToPrev = () => {
        depArrow.classList.add("active-up");
        depArrow.classList.remove("active-down");
      };
      const setTargetToNext = () => {
        depArrow.classList.add("active-down");
        depArrow.classList.remove("active-up");
      };

      if (isVisible(prev) && isVisible(next)) return;

      if (isVisible(prev)) {
        setTargetToNext();
      } else if (isVisible(next)) {
        setTargetToPrev();
      } else {
        const mid = (min + max) / 2;
        if (idx < mid) {
          setTargetToPrev();
        } else {
          setTargetToNext();
        }
      }
    },
    [verifierLogState, memSlotDependencies, selectedLine],
  );

  return (
    <div
      id="main-content"
      className="main-content"
      onClick={handleMainContentClick}
    >
      <CSourceLines
        handleCLinesClick={handleCLinesClick}
        verifierLogState={verifierLogState}
      />
      <div
        id="log-container"
        className={selectedMemSlotId !== "" ? "active_mem_slot" : ""}
      >
        <LineNumbersPC logLines={logLines} />
        <div
          id="dependency-arrows"
          onMouseOver={handleArrowsOver}
          onClick={handleArrowsClick}
        >
          <DependencyArrowsPlain logLines={logLines} />
        </div>
        <LogLines
          verifierLogState={verifierLogState}
          logLines={logLines}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
        />
      </div>
      <StatePanel
        selectedLine={selectedLine}
        selectedCLine={selectedCLine}
        verifierLogState={verifierLogState}
      />
    </div>
  );
}
