import React, { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BpfJmpCode,
  BpfJmpKind,
  BpfOperand,
  Effect,
  OperandType,
  ParsedLine,
  ParsedLineType,
} from "./parser";
import { getMemSlotDependencies } from "./analyzer";

import { BpfState, getBpfState, VerifierLogState } from "./analyzer";

import { getVisibleIdxRange, scrollToLine } from "./utils";

import BPF_HELPERS_JSON from "./bpf-helpers.json";

export type LogLineState = {
  memSlotId: string;
  line: number;
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

const EXAMPLE_LOG_URL =
  "https://gist.githubusercontent.com/theihor/e0002c119414e6b40e2192bd7ced01b1/raw/866bcc155c2ce848dcd4bc7fd043a97f39a2d370/gistfile1.txt";
const RIGHT_ARROW = "->";

function CallHtml({ line }: { line: ParsedLine }) {
  const ins = line.bpfIns;
  if (!ins) {
    return <></>;
  }
  const location = ins.location;
  if (!location) {
    return <></>;
  }
  const start = line.raw.length + location.offset;
  const end = start + location.size;
  const target = ins.jmp?.target || "";
  const helperName = target.substring(0, target.indexOf("#"));

  const args = bpfHelpersMap.get(helperName);

  let contents = [];
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
    const numArgs = 5;
    contents.push(
      <React.Fragment key="line-start">
        {line.raw.slice(start, end)}
      </React.Fragment>,
    );
    contents.push(<React.Fragment key="paren-open">(</React.Fragment>);
    for (let i = 1; i < 5; i++) {
      const reg = `r${i}`;
      contents.push(
        <RegSpan
          lineIdx={line.idx}
          reg={reg}
          display={undefined}
          key={`call_html_${reg}`}
        />,
      );
      contents.push(
        <React.Fragment key={`call_html_comma_${i}`}>, </React.Fragment>,
      );
    }
    const reg = "r" + numArgs;
    contents.push(
      <RegSpan
        lineIdx={line.idx}
        reg={reg}
        display={undefined}
        key={`call_html_${reg}`}
      />,
    );
    contents.push(<React.Fragment key="paren-closed">)</React.Fragment>);
    return <>{contents}</>;
  }
}

export function Example() {
  return (
    <a
      id="example-link"
      href={`${window.location.pathname}?url=${EXAMPLE_LOG_URL}`}
    >
      Click here to load a log example
    </a>
  );
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
  lines,
}: {
  hoveredLine: number;
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
      <span>Raw line {hoveredLine + 1}:</span> {lines[hoveredLine].raw}
    </div>
  );
}

function JmpInstruction({ line }: { line: ParsedLine }) {
  const code = line?.bpfIns?.opcode?.code;
  if (code === BpfJmpCode.JA) {
    return <>goto {line.bpfIns?.jmp?.target}</>;
  }
  return (
    <>
      if (
      <MemSlot line={line} op={line.bpfIns?.jmp?.cond?.left} />{" "}
      {line.bpfIns?.jmp?.cond?.op}{" "}
      <MemSlot line={line} op={line.bpfIns?.jmp?.cond?.right} />) goto{" "}
      {line.bpfIns?.jmp?.target}
    </>
  );
}

export function LoadStatus({ lines }: { lines: ParsedLine[] }) {
  const percentage = (100 * 100) / 100;
  return (
    <div id="load-status">
      Loaded {percentage.toFixed(0)}% ({lines.length} lines)
    </div>
  );
}

const LogLineRaw = ({
  line,
  frame,
  indentLevel,
  idx,
}: {
  line: ParsedLine;
  frame: number;
  indentLevel: number;
  idx: number;
}) => {
  const topClasses = ["log-line"];

  if (!line?.bpfIns && !line?.bpfStateExprs) {
    topClasses.push("ignorable-line");
  } else {
    topClasses.push("normal-line");
  }

  let content;
  const ins = line.bpfIns;

  if (ins?.alu) {
    content = (
      <>
        <MemSlot line={line} op={ins.alu.dst} /> {ins.alu.operator}{" "}
        <MemSlot line={line} op={ins.alu.src} />
      </>
    );
  } else if (ins?.jmp?.kind === BpfJmpKind.BPF2BPF_CALL) {
    content = (
      <b>
        <CallHtml line={line} />
        {" {"} ; enter new stack frame {frame}
      </b>
    );
  } else if (ins?.jmp?.kind === BpfJmpKind.EXIT) {
    content = <ExitInstruction frame={frame} />;
  } else if (ins?.jmp?.kind === BpfJmpKind.HELPER_CALL) {
    content = (
      <>
        <RegSpan lineIdx={line.idx} reg={"r0"} display={undefined} /> ={" "}
        <CallHtml line={line} />
      </>
    );
  } else if (ins?.jmp) {
    content = <JmpInstruction line={line} />;
  } else {
    content = line.raw;
  }

  const lineId = "line-" + idx;

  let logLineStyle = {
    paddingLeft: `${indentLevel <= 0 ? 0 : indentLevel * 30}px`,
  };

  return (
    <div
      style={logLineStyle}
      line-index={idx}
      id={lineId}
      className={topClasses.join(" ")}
    >
      {content}
    </div>
  );
};

const LogLine = React.memo(LogLineRaw);

function getMemSlotDisplayValue(
  idx: number,
  verifierLogState: BpfState,
  prevBpfState: BpfState,
  memSlotId: string,
  lines: ParsedLine[],
) {
  const prevValue = prevBpfState.values.get(memSlotId);
  const value = verifierLogState.values.get(memSlotId);
  const ins = lines[idx].bpfIns;
  switch (value?.effect) {
    case Effect.WRITE:
    case Effect.UPDATE:
      if (memSlotId === "MEM") {
        // show the value of register that was stored
        const reg = ins?.alu?.src.id;
        if (reg) {
          const regValue = verifierLogState.values.get(reg);
          return () => {
            return (
              <>
                {RIGHT_ARROW} {regValue?.value}
              </>
            );
          };
        }
        return null;
      }
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
  lines,
}: {
  selectedLine: number;
  lines: ParsedLine[];
}) {
  if (lines.length === 0) {
    return <></>;
  }
  return (
    <div id="hint-selected-line" className="hint-line">
      <span>[selected] Raw line {selectedLine + 1}:</span>{" "}
      {lines[selectedLine].raw}
    </div>
  );
}

function StatePanelRaw({
  selectedLine,
  verifierLogState,
}: {
  selectedLine: number;
  verifierLogState: VerifierLogState;
}) {
  const { lines, bpfStates } = verifierLogState;
  let rows: ReactElement[] = [];
  const { state: bpfState, idx } = getBpfState(bpfStates, selectedLine);
  const prevBpfState = getBpfState(bpfStates, idx - 1).state;

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

    const contentFunc = getMemSlotDisplayValue(
      idx,
      bpfState,
      prevBpfState,
      id,
      lines,
    );

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
  const sortedValues = [];
  for (const key of bpfState.values.keys()) {
    if (!key.startsWith("r") && !key.startsWith("fp-")) {
      sortedValues.push(key);
    }
  }
  sortedValues.sort((a, b) => a.localeCompare(b));
  for (const key of sortedValues) {
    addRow(key);
  }

  return (
    <div id="state-panel" className="state-panel">
      <div id="state-panel-header">
        <div>Line: {selectedLine + 1}</div>
        <div>PC: {bpfState.pc}</div>
        <div>Frame: {bpfState.frame}</div>
      </div>
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
      hoveredLine,
      verifierLogState,
      prevBpfState,
      memSlotId,
      lines,
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
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  verifierLogState: VerifierLogState;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) => {
  const { bpfStates, lines } = verifierLogState;
  let indentLevel = 0;
  return (
    <div
      id="formatted-log-lines"
      onClick={handleLogLinesClick}
      onMouseOver={handleLogLinesOver}
      onMouseOut={handleLogLinesOut}
    >
      {lines.map((line) => {
        const frame = getBpfState(bpfStates, line.idx).state.frame;
        indentLevel = frame;
        if (line.bpfIns?.jmp?.kind === BpfJmpKind.BPF2BPF_CALL) {
          indentLevel -= 1;
        }
        return (
          <LogLine
            frame={frame}
            indentLevel={indentLevel}
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

const LineNumbersRaw = ({
  verifierLogState,
}: {
  verifierLogState: VerifierLogState;
}) => {
  return (
    <div id="line-numbers-idx" className="line-numbers">
      {verifierLogState.lines.map((line) => {
        return (
          <div className="line-numbers-line" key={`line_num_${line.idx}`}>
            {line.idx + 1}
          </div>
        );
      })}
    </div>
  );
};

const LineNumbers = React.memo(LineNumbersRaw);

const LineNumbersPCRaw = ({
  verifierLogState,
}: {
  verifierLogState: VerifierLogState;
}) => {
  return (
    <div id="line-numbers-pc" className="line-numbers">
      {verifierLogState.lines.map((line) => {
        return (
          <div className="line-numbers-line" key={`line_num_pc_${line.idx}`}>
            {typeof line.bpfIns?.pc === "number" ? line.bpfIns.pc + ":" : "\n"}
          </div>
        );
      })}
    </div>
  );
};

const LineNumbersPC = React.memo(LineNumbersPCRaw);

const DependencyArrowsRaw = ({
  verifierLogState,
}: {
  verifierLogState: VerifierLogState;
}) => {
  return (
    <>
      {verifierLogState.lines.map((line) => {
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

export function MainContent({
  verifierLogState,
  selectedLine,
  selectedMemSlotId,
  handleMainContentClick,
  handleLogLinesClick,
  handleLogLinesOver,
  handleLogLinesOut,
}: {
  verifierLogState: VerifierLogState;
  selectedLine: number;
  selectedMemSlotId: string;
  handleMainContentClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const memSlotDependencies: number[] = useMemo(() => {
    const lines = verifierLogState.lines;
    if (lines.length === 0) {
      return [];
    }
    const ins = lines[selectedLine].bpfIns;
    if (!ins) return [];
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

    let selectedMemSlotIdEl: HTMLElement | null;

    if (selectedMemSlotId !== "") {
      selectedMemSlotIdEl = document.getElementById(
        `mem-slot-${selectedMemSlotId}-line-${selectedLine}`,
      );

      if (selectedMemSlotIdEl) {
        selectedMemSlotIdEl.classList.add("selected-mem-slot");
      }

      verifierLogState.lines.forEach((line) => {
        const idx = line.idx;
        if (selectedLine === idx) {
          return;
        }
        const isIgnorable = !line?.bpfIns && !line?.bpfStateExprs;

        if (isIgnorable || !memSlotDependencies.includes(idx)) {
          return;
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
        scrollToLine(next, verifierLogState.lines.length);
      } else if (depArrow.classList.contains("active-up")) {
        scrollToLine(prev, verifierLogState.lines.length);
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
      <div
        id="log-container"
        className={selectedMemSlotId !== "" ? "active_mem_slot" : ""}
      >
        <LineNumbers verifierLogState={verifierLogState} />
        <LineNumbersPC verifierLogState={verifierLogState} />
        <div
          id="dependency-arrows"
          onMouseOver={handleArrowsOver}
          onClick={handleArrowsClick}
        >
          <DependencyArrowsPlain verifierLogState={verifierLogState} />
        </div>

        <LogLines
          verifierLogState={verifierLogState}
          handleLogLinesClick={handleLogLinesClick}
          handleLogLinesOver={handleLogLinesOver}
          handleLogLinesOut={handleLogLinesOut}
        />
      </div>
      <StatePanel
        selectedLine={selectedLine}
        verifierLogState={verifierLogState}
      />
    </div>
  );
}
