import React, { ChangeEvent, ReactElement, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, ListImperativeAPI, useListRef } from "react-window";
import { type RowComponentProps } from "react-window";
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
import {
  BpfMemSlotMap,
  foreachStackSlot,
  stackSlotIdForIndirectAccess,
  insEntersNewFrame,
  stackSlotIdFromDisplayId,
  siblingInsLine,
  siblingCLine,
} from "./utils";
import { getMemSlotDependencies } from "./analyzer";

import { BpfState, getBpfState, VerifierLogState } from "./analyzer";

import BPF_HELPERS_JSON from "./bpf-helpers.json";

export type CSourceRow =
  | { type: "file_name"; file: string }
  | {
      type: "c_line";
      file: string;
      lineNum: number;
      lineText: string;
      sourceId: string;
      ignore: boolean;
    };

export type VisualLogState = {
  verifierLogState: VerifierLogState;
  cLines: CSourceRow[];
  cLineIdToVisualIdx: Map<string, number>;
  logLines: ParsedLine[];
  logLineIdxToVisualIdx: Map<number, number>;
  showFullLog: boolean;
};

export type LogLineState = {
  memSlotId: string;
  line: number;
  cLine: string;
};

export type DepArrowState = {
  start: number;
  end: number;
  mids: Set<number>;
  tracks: Set<number>;
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
  memSlotDependencies,
  selectedState,
}: {
  ins: BpfTargetJmpInstruction;
  line: ParsedLine;
  state: BpfState;
  memSlotDependencies: number[];
  selectedState: LogLineState;
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
          <RegSpan
            lineIdx={line.idx}
            reg={reg}
            display={display}
            key={key}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />,
        );
      } else {
        contents.push(
          <RegSpan
            lineIdx={line.idx}
            reg={reg}
            display={undefined}
            key={key}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
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
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
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

declare global {
  var exampleLinks: [string, string][];
}

export function Examples({
  handleLoadExample,
}: {
  handleLoadExample: (exampleLink: string) => Promise<void>;
}) {
  const exampleLinks: [string, string][] = globalThis.exampleLinks || [];

  const [selectedOption, setSelectedOption] = useState(
    exampleLinks.length ? exampleLinks[0][1] : "",
  );
  const handleChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedOption(event.target.value);
  }, []);

  const onLoad = useCallback(() => {
    handleLoadExample(selectedOption);
  }, [selectedOption]);

  if (exampleLinks && exampleLinks.length !== 0) {
    return (
      <div className="line-nav-item">
        <label>Examples:</label>
        <select
          id="log-example-dropdown"
          onChange={handleChange}
          value={selectedOption}
        >
          {exampleLinks.map((pair) => {
            return (
              <option key={pair[1]} value={pair[1]}>
                {pair[0]}
              </option>
            );
          })}
        </select>
        <button id="load-example" className="nav-button" onClick={onLoad}>
          Load
        </button>
      </div>
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
  visibleIdx,
  lines,
}: {
  hoveredLine: number;
  visibleIdx: number;
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
      <span>[hovered raw line] {visibleIdx + 1}:</span>&nbsp;
      {lines[hoveredLine].raw}
    </div>
  );
}

function ConditionalJmpInstruction({
  ins,
  line,
  state,
  memSlotDependencies,
  selectedState,
}: {
  ins: BpfConditionalJmpInstruction;
  line: ParsedLine;
  state: BpfState;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) {
  return (
    <>
      if (
      <MemSlot
        line={line}
        op={ins.cond.left}
        state={state}
        memSlotDependencies={memSlotDependencies}
        selectedState={selectedState}
      />
      &nbsp;{ins.cond.op}&nbsp;
      <MemSlot
        line={line}
        op={ins.cond.right}
        state={state}
        memSlotDependencies={memSlotDependencies}
        selectedState={selectedState}
      />
      )&nbsp;goto&nbsp;{ins.target}
    </>
  );
}

export function JmpInstruction({
  ins,
  line,
  state,
  memSlotDependencies,
  selectedState,
}: {
  ins: BpfJmpInstruction;
  line: ParsedLine;
  state: BpfState;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) {
  if (insEntersNewFrame(ins)) {
    return (
      <b>
        <CallHtml
          ins={ins as BpfTargetJmpInstruction}
          line={line}
          state={state}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        />
        {" {"} ; enter new stack frame {state.frame}
      </b>
    );
  } else if (ins.jmpKind === BpfJmpKind.EXIT) {
    return <ExitInstruction frame={state.frame} />;
  } else if (ins.jmpKind === BpfJmpKind.HELPER_CALL) {
    return (
      <>
        <RegSpan
          lineIdx={line.idx}
          reg={"r0"}
          display={undefined}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        />
        &nbsp;=&nbsp;
        <CallHtml
          ins={ins}
          line={line}
          state={state}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        />
      </>
    );
  } else if (
    ins.jmpKind === BpfJmpKind.UNCONDITIONAL_GOTO ||
    ins.jmpKind === BpfJmpKind.MAY_GOTO ||
    ins.jmpKind === BpfJmpKind.GOTO_OR_NOP
  ) {
    return (
      <>
        {ins.goto}&nbsp;{ins.target}
      </>
    );
  } else if (ins.jmpKind === BpfJmpKind.CONDITIONAL_GOTO) {
    return (
      <ConditionalJmpInstruction
        ins={ins}
        line={line}
        state={state}
        memSlotDependencies={memSlotDependencies}
        selectedState={selectedState}
      />
    );
  }
}

function InstructionLineContent({
  line,
  state,
  memSlotDependencies,
  selectedState,
}: {
  line: InstructionLine;
  state: BpfState;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) {
  const ins = line.bpfIns;
  switch (ins.kind) {
    case BpfInstructionKind.ALU:
      return (
        <>
          <MemSlot
            line={line}
            op={ins.dst}
            state={state}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />
          &nbsp;{ins.operator}&nbsp;
          <MemSlot
            line={line}
            op={ins.src}
            state={state}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />
        </>
      );
    case BpfInstructionKind.JMP:
      return (
        <JmpInstruction
          ins={ins}
          line={line}
          state={state}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        />
      );
    case BpfInstructionKind.ADDR_SPACE_CAST:
      return (
        <>
          <MemSlot
            line={line}
            op={ins.dst}
            state={state}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />
          {" = addr_space_cast("}
          <MemSlot
            line={line}
            op={ins.src}
            state={state}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />
          {`, ${ins.directionStr})`}
        </>
      );
  }
}

function DependencyArrow({
  line,
  depArrowState,
}: {
  line: ParsedLine;
  depArrowState: DepArrowState;
}) {
  const classList = ["dep-arrow"];
  const idx = line.idx;

  if (depArrowState.start !== -1) {
    if (depArrowState.start === idx) {
      classList.push("dep-start");
    } else if (depArrowState.end === idx) {
      classList.push("dep-end");
    } else if (depArrowState.mids.has(idx)) {
      classList.push("dep-mid");
    } else if (depArrowState.tracks.has(idx)) {
      classList.push("dep-track");
    }
  }

  return (
    <div
      className={classList.join(" ")}
      line-id={idx}
      id={getDepArrowDomId(idx)}
      key={`dependency-arrow-${idx}`}
    ></div>
  );
}

const LogLineRaw = ({
  index,
  style,
  bpfStates,
  logLines,
  lastInsIdx,
  memSlotDependencies,
  depArrowState,
  selectedState,
  verifierLogState,
}: RowComponentProps<{
  logLines: ParsedLine[];
  bpfStates: BpfState[];
  lastInsIdx: number;
  memSlotDependencies: number[];
  depArrowState: DepArrowState;
  selectedState: LogLineState;
  verifierLogState: VerifierLogState;
}>) => {
  let content;
  let indentLevel = 0;
  const topClasses = ["flex", "items-center", "justify-between", "log-line"];
  const line = logLines[index];
  const state = getBpfState(bpfStates, line.idx);
  const frame = state.frame;
  indentLevel = frame;
  if (
    line.type === ParsedLineType.INSTRUCTION &&
    insEntersNewFrame(line.bpfIns)
  ) {
    indentLevel -= 1;
  }

  const { line: selectedLine, cLine: selectedCLine } = selectedState;

  if (selectedLine === line.idx) {
    topClasses.push("selected-line");
  } else if (memSlotDependencies.includes(line.idx)) {
    topClasses.push("dependency-line");
  }

  const logLinesFromCLine =
    verifierLogState.cSourceMap.cLineToLogLines.get(selectedCLine);
  if (logLinesFromCLine && logLinesFromCLine.size > 0) {
    if (logLinesFromCLine.has(line.idx) && selectedLine !== line.idx) {
      topClasses.push("selected-line");
    }
  }

  switch (line.type) {
    case ParsedLineType.INSTRUCTION:
      topClasses.push("normal-line");
      content = InstructionLineContent({
        line,
        state,
        memSlotDependencies,
        selectedState,
      });
      break;
    case ParsedLineType.C_SOURCE:
      topClasses.push("inline-c-source-line");
      content = <>{line.raw}</>;
      break;
    default:
      if (lastInsIdx + 1 === line.idx) {
        topClasses.push("error-message");
      } else {
        topClasses.push("ignorable-line");
      }
      content = <>{line.raw}</>;
      break;
  }

  const lineId = "line-" + line.idx;
  const indentSpans: ReactElement[] = [];

  for (let i = 0; i < indentLevel; ++i) {
    indentSpans.push(
      <span key={`indent-line${i}`} className="line-indent"></span>,
    );
  }

  return (
    <div
      style={style}
      line-index={line.idx}
      id={lineId}
      className={topClasses.join(" ")}
    >
      <div className="pc-number" key={`line_num_pc_${line.idx}`}>
        {line.type === ParsedLineType.INSTRUCTION ? line.bpfIns.pc : "\n"}
      </div>
      <DependencyArrow line={line} depArrowState={depArrowState} />
      <div className="log-line-content">
        {indentSpans}
        {content}
      </div>
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
      if (!value) {
        return null;
      }
      return () => {
        return <>{value.value}</>;
      };
  }
}

export function MemSlot({
  line,
  op,
  state,
  memSlotDependencies,
  selectedState,
}: {
  line: ParsedLine;
  op: BpfOperand | undefined;
  state: BpfState;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) {
  if (!op) {
    return <>{line.raw}</>;
  }
  const start = line.raw.length + (op.location?.offset || 0);
  const end = start + (op.location?.size || 0);
  const memSlotString = line.raw.slice(start, end);
  switch (op.type) {
    case OperandType.REG:
      return (
        <RegSpan
          lineIdx={line.idx}
          reg={op.id}
          display={memSlotString}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        />
      );
    case OperandType.FP:
      const displayFp = memSlotString || op.id;
      return (
        <StackSlotSpan
          lineIdx={line.idx}
          normalId={stackSlotIdFromDisplayId(op.id, state.frame)}
          memSlotDependencies={memSlotDependencies}
          selectedState={selectedState}
        >
          <span>{displayFp}</span>
        </StackSlotSpan>
      );
    case OperandType.MEM:
      const reg = op.memref?.reg || "";
      const regStart = memSlotString.search(/r[0-9]/);
      const regEnd = regStart + 2;
      const displayMem = (
        <>
          {memSlotString.slice(0, regStart)}
          <RegSpan
            lineIdx={line.idx}
            reg={reg}
            display={reg}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          />
          {memSlotString.slice(regEnd)}
        </>
      );

      // If we know the fp then also make it clickable
      const adjustedMemSlotId = stackSlotIdForIndirectAccess(state, op.memref);
      if (adjustedMemSlotId !== null) {
        return (
          <StackSlotSpan
            lineIdx={line.idx}
            normalId={adjustedMemSlotId}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
          >
            {displayMem}
          </StackSlotSpan>
        );
      }
      return displayMem;
    default:
      return <>{memSlotString}</>;
  }
}

const RegSpan = ({
  reg,
  display,
  lineIdx,
  memSlotDependencies,
  selectedState,
}: {
  reg: string;
  display: string | undefined;
  lineIdx: number;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) => {
  const classNames = ["mem-slot"];
  if (reg === selectedState.memSlotId && selectedState.line === lineIdx) {
    classNames.push("selected-mem-slot");
  } else if (
    reg === selectedState.memSlotId &&
    memSlotDependencies.includes(lineIdx)
  ) {
    classNames.push("dependency-mem-slot");
  }
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

const StackSlotSpan = ({
  normalId,
  lineIdx,
  children,
  memSlotDependencies,
  selectedState,
}: {
  normalId: string;
  lineIdx: number;
  children: ReactElement;
  memSlotDependencies: number[];
  selectedState: LogLineState;
}) => {
  const classNames = ["mem-slot"];
  if (normalId === selectedState.memSlotId && selectedState.line === lineIdx) {
    classNames.push("selected-mem-slot");
  } else if (
    normalId === selectedState.memSlotId &&
    memSlotDependencies.includes(lineIdx)
  ) {
    classNames.push("dependency-mem-slot");
  }
  return (
    <span
      id={getMemSlotDomId(normalId, lineIdx)}
      className={classNames.join(" ")}
      data-id={normalId}
    >
      {children}
    </span>
  );
};

export function SelectedLineHint({
  selectedLine,
  visualIdx,
  lines,
}: {
  selectedLine: number;
  visualIdx: number;
  lines: ParsedLine[];
}) {
  if (lines.length === 0) {
    return <></>;
  }
  return (
    <div id="hint-selected-line" className="hint-line">
      <span>[selected raw line] {visualIdx + 1}:</span>&nbsp;
      {lines[selectedLine].raw}
    </div>
  );
}

function HideShowButton({
  isVisible,
  rightOpen,
  name,
  handleHideShowClick,
  id,
}: {
  isVisible: boolean;
  rightOpen: boolean;
  name: string;
  id: string;
  handleHideShowClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const classList = ["nav-arrow", "hide-show-button"];
  if (rightOpen) {
    classList.push("right");
  } else {
    classList.push("left");
  }

  if (!isVisible) {
    classList.push("hidden");
  }

  return (
    <div id={id} className={classList.join(" ")} onClick={handleHideShowClick}>
      {isVisible ? (rightOpen ? "⇒" : "⇐") : rightOpen ? "⇐" : "⇒"}
      <div className="nav-arrow-tooltip hide-show-tooltip">
        {isVisible ? "Hide" : "Show"}&nbsp;{name}
      </div>
    </div>
  );
}

function StatePanelRaw({
  selectedState,
  verifierLogState,
  handleStateRowClick,
  handleStateLogLineClick,
  handleStateCLineClick,
}: {
  selectedState: LogLineState;
  verifierLogState: VerifierLogState;
  handleStateRowClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleStateLogLineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleStateCLineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const { lines, bpfStates } = verifierLogState;
  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;
  let rows: ReactElement[] = [];
  const bpfState = getBpfState(bpfStates, selectedLine);
  const prevBpfState = getBpfState(bpfStates, bpfState.idx - 1);
  const [isVisible, setIsVisible] = useState<boolean>(true);

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

  const handleHideShowClick = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, [setIsVisible]);

  let displayedSlots = new BpfMemSlotMap<boolean>(bpfState.frame);
  let rowCounter = 1;

  const addRow = (id: string) => {
    if (displayedSlots.has(id) || id === "MEM") return;
    const classes = ["state-row"];
    const line = lines[selectedLine];
    if (line?.type === ParsedLineType.INSTRUCTION) {
      const value = bpfState.values.get(id);
      switch (value?.effect) {
        case Effect.WRITE:
        case Effect.UPDATE:
          classes.push("effect-write");
          break;
        case Effect.READ:
          classes.push("effect-read");
          break;
        case Effect.NONE:
        default:
          break;
      }
    }

    if (selectedMemSlotId === id) {
      classes.push("selected-mem-slot");
    }

    const contentFunc = getMemSlotDisplayValue(bpfState, prevBpfState, id);
    const content = contentFunc ? contentFunc() : "";
    let data_id = id;

    if (content === "") {
      data_id = "0";
      classes.push("row-empty");
    }

    rows.push(
      <tr className={classes.join(" ")} key={rowCounter} data-id={data_id}>
        <td className="mem-slot-label">{id}</td>
        <td>
          <span>{content}</span>
        </td>
      </tr>,
    );

    displayedSlots.set(id, true);
    ++rowCounter;
  };

  // first add the registers
  for (let i = 0; i <= 10; i++) {
    addRow(`r${i}`);
  }

  // then the stack slots
  foreachStackSlot(bpfState.frame, (id) => {
    if (bpfState.values.has(id)) addRow(id);
  });

  // then the rest
  const sortedValues: string[] = [];
  for (const key of bpfState.values.keys()) {
    if (!displayedSlots.has(key)) {
      sortedValues.push(key);
    }
  }
  sortedValues.sort((a, b) => a.localeCompare(b));
  for (const key of sortedValues) {
    addRow(key);
  }

  const buttonId = "state-toggle";

  if (!isVisible) {
    return (
      <div className="state-panel panel-hidden">
        <HideShowButton
          isVisible={isVisible}
          rightOpen={true}
          name="State Panel"
          handleHideShowClick={handleHideShowClick}
          id={buttonId}
        />
      </div>
    );
  }

  return (
    <div id="state-panel" className="state-panel">
      <HideShowButton
        isVisible={isVisible}
        rightOpen={true}
        name="State Panel"
        handleHideShowClick={handleHideShowClick}
        id={buttonId}
      />
      <div id="state-panel-content">
        <div id="state-panel-header">
          <div
            className="panel-header-active"
            onClick={handleStateLogLineClick}
          >
            <span className="bold">Log Line:</span> {selectedLine + 1}
          </div>
          <div className="panel-header-active" onClick={handleStateCLineClick}>
            <span className="bold">C Line:</span> {selectedCLine}
          </div>
          <div>
            <span className="bold">PC:</span> {bpfState.pc}
          </div>
          <div>
            <span className="bold">Frame:</span> {bpfState.frame}
          </div>
        </div>
        <div id="state-panel-table">
          <table onClick={handleStateRowClick}>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </div>
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
    const verifierLogState = getBpfState(bpfStates, hoveredLine);
    const prevBpfState = getBpfState(bpfStates, verifierLogState.idx - 1);
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
  logListRef,
  selectedState,
  memSlotDependencies,
  depArrowState,
  onLogRowsRendered,
  testListHeight,
}: {
  verifierLogState: VerifierLogState;
  logLines: ParsedLine[];
  logListRef: RefObject<ListImperativeAPI | null>;
  memSlotDependencies: number[];
  depArrowState: DepArrowState;
  selectedState: LogLineState;
  onLogRowsRendered: (start: number, end: number) => void;
  testListHeight: number | undefined;
}) => {
  const { bpfStates, lastInsIdx } = verifierLogState;
  const onRowsRendered = useCallback(
    (visibleRows: { startIndex: number; stopIndex: number }) => {
      onLogRowsRendered(visibleRows.startIndex, visibleRows.stopIndex);
    },
    [],
  );
  return (
    <List
      rowComponent={LogLine}
      rowCount={logLines.length}
      rowHeight={20}
      defaultHeight={testListHeight}
      rowProps={{
        logLines,
        bpfStates,
        lastInsIdx,
        memSlotDependencies,
        depArrowState,
        selectedState,
        verifierLogState,
      }}
      listRef={logListRef}
      onRowsRendered={onRowsRendered}
    />
  );
};

const LogLines = React.memo(LogLinesRaw);

type CSourceRowProps = {
  cLines: CSourceRow[];
  dependencyCLines: Set<string>;
  selectedCLine: string;
};

function CSourceRowHeight(index: number, { cLines }: CSourceRowProps) {
  switch (cLines[index].type) {
    case "file_name": {
      return 40;
    }
    case "c_line": {
      return 20;
    }
  }
}

const CSourceRowComponent = ({
  index,
  style,
  cLines,
  dependencyCLines,
  selectedCLine,
}: RowComponentProps<CSourceRowProps>) => {
  const item = cLines[index];

  if (item.type == "file_name") {
    const fileNameStyle = { ...style };
    if (index === 0) {
      fileNameStyle["borderTop"] = "0px";
    }
    return (
      <div className="filename-header" style={fileNameStyle}>
        {item.file}
      </div>
    );
  }

  const classListLine = ["c-line"];
  const classListSrcLine = ["c-source-line"];

  if (item.ignore) {
    classListSrcLine.push("ignorable-line");
  }

  if (dependencyCLines.has(item.sourceId)) {
    classListLine.push("dependency-line");
  }

  if (selectedCLine === item.sourceId) {
    classListLine.push("selected-line");
  }

  return (
    <div
      className={classListLine.join(" ")}
      id={`line-${item.sourceId}`}
      data-id={item.sourceId}
      style={style}
    >
      <div className="line-number" key={`c_line_num_${index}`}>
        {item.lineNum}
      </div>
      <div
        className={classListSrcLine.join(" ")}
        key={`c_source_line_${index}`}
      >
        {item.lineText}
      </div>
    </div>
  );
};

function CSourceLinesRaw({
  showFullLog,
  selectedState,
  memSlotDependencies,
  visualLogState,
  cListRef,
  testListHeight,
  handleFullLogToggle,
  handleCLinesClick,
  onCRowsRendered,
}: {
  showFullLog: boolean;
  selectedState: LogLineState;
  memSlotDependencies: number[];
  visualLogState: VisualLogState;
  cListRef: RefObject<ListImperativeAPI | null>;
  testListHeight: number | undefined;
  handleFullLogToggle: () => void;
  handleCLinesClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onCRowsRendered: (start: number, end: number) => void;
}) {
  const buttonId = "csource-toggle";

  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;
  const { verifierLogState } = visualLogState;

  const onRowsRendered = useCallback(
    (visibleRows: { startIndex: number; stopIndex: number }) => {
      onCRowsRendered(visibleRows.startIndex, visibleRows.stopIndex);
    },
    [],
  );

  const dependencyCLines = useMemo(() => {
    const dependencyCLines: Set<string> = new Set();
    if (selectedMemSlotId !== "") {
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
          line.type === ParsedLineType.KNOWN_MESSAGE ||
          (line.type === ParsedLineType.INSTRUCTION &&
            !memSlotDependencies.includes(idx)) ||
          (line.type === ParsedLineType.C_SOURCE &&
            !relevantCLineIds.has(line.id))
        ) {
          return;
        }

        const cLine = verifierLogState.cSourceMap.logLineToCLine.get(idx);
        if (cLine) {
          dependencyCLines.add(cLine);
        }
      });
    }

    return dependencyCLines;
  }, [selectedLine, selectedMemSlotId, memSlotDependencies, verifierLogState]);

  const selectedCLine = useMemo(() => {
    if (selectedState.cLine) {
      return selectedState.cLine;
    } else if (selectedState.line) {
      const parsedLine = verifierLogState.lines[selectedState.line];
      if (parsedLine.type === ParsedLineType.C_SOURCE) {
        return parsedLine.id;
      }
      const cLine = verifierLogState.cSourceMap.logLineToCLine.get(
        selectedState.line,
      );
      if (cLine) {
        return cLine;
      }
    }
    return "";
  }, [verifierLogState, selectedState]);

  if (showFullLog) {
    return (
      <div className="c-source-panel panel-hidden">
        <HideShowButton
          isVisible={!showFullLog}
          rightOpen={false}
          name="C Source Panel"
          handleHideShowClick={handleFullLogToggle}
          id={buttonId}
        />
      </div>
    );
  }

  return (
    <div
      id="c-source-container"
      className="c-source-panel"
      onClick={handleCLinesClick}
    >
      <HideShowButton
        isVisible={!showFullLog}
        rightOpen={false}
        name="C Source Panel"
        handleHideShowClick={handleFullLogToggle}
        id={buttonId}
      />
      <div id="c-source-content">
        <List<CSourceRowProps>
          rowComponent={CSourceRowComponent}
          rowCount={visualLogState.cLines.length}
          rowHeight={CSourceRowHeight}
          listRef={cListRef}
          onRowsRendered={onRowsRendered}
          defaultHeight={testListHeight}
          rowProps={{
            cLines: visualLogState.cLines,
            dependencyCLines,
            selectedCLine,
          }}
        />
      </div>
    </div>
  );
}

const CSourceLines = React.memo(CSourceLinesRaw);

export function MainContent({
  visualLogState,
  selectedState,
  setSelectedState,
  handleLogLinesOver,
  handleLogLinesOut,
  handleFullLogToggle,
  testListHeight,
}: {
  visualLogState: VisualLogState;
  selectedState: LogLineState;
  setSelectedState: (value: React.SetStateAction<LogLineState>) => void;
  handleLogLinesOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleLogLinesOut: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleFullLogToggle: () => void;
  testListHeight: number | undefined;
}) {
  const logListRef = useListRef(null);
  const cListRef = useListRef(null);
  const {
    verifierLogState,
    logLines,
    logLineIdxToVisualIdx,
    cLines,
    cLineIdToVisualIdx,
  } = visualLogState;

  const { line: selectedLine, memSlotId: selectedMemSlotId } = selectedState;

  const [visualLogIndexRange, setVisualLogIndexRange] = useState<{
    visualLogStart: number;
    visualLogEnd: number;
  }>({ visualLogStart: 0, visualLogEnd: 0 });

  const onLogRowsRendered = useCallback((start: number, end: number) => {
    setVisualLogIndexRange({ visualLogStart: start, visualLogEnd: end });
  }, []);

  const [visualCIndexRange, setVisualCIndexRange] = useState<{
    visualLogStart: number;
    visualLogEnd: number;
  }>({ visualLogStart: 0, visualLogEnd: 0 });

  const onCRowsRendered = useCallback((start: number, end: number) => {
    setVisualCIndexRange({ visualLogStart: start, visualLogEnd: end });
  }, []);

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

  const scrollToCLine = useCallback(
    (index: number) => {
      if (index < 0 || cLines.length === 0) {
        return;
      }
      const list = cListRef.current;
      list?.scrollToRow({
        index,
        align: "center",
      });
    },
    [cListRef, cLines],
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
      scrollToCLine(nextCLineVisualIdx);
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

  const onGotoEnd = useCallback(() => {
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
  }, [logLines, verifierLogState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let delta = 0;
      let areCLinesInFocus = selectedState.cLine !== "";
      let min = 0;
      let max = 0;

      if (areCLinesInFocus) {
        min = visualCIndexRange.visualLogStart;
        max = visualCIndexRange.visualLogEnd;
      } else {
        min = visualLogIndexRange.visualLogStart;
        max = visualLogIndexRange.visualLogEnd;
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
        const cLineId = siblingCLine(cLines, currentVisibleIdx, delta);

        if (cLineId === "") {
          return;
        }

        let nextVisibleIdx = currentVisibleIdx;

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
          cLineId,
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

  const depArrowState: DepArrowState = useMemo(() => {
    const arrowState = {
      start: -1,
      end: -1,
      mids: new Set<number>(),
      tracks: new Set<number>(),
    };
    if (
      selectedMemSlotId === "" ||
      memSlotDependencies.length === 0 ||
      memSlotDependencies[0] === selectedLine
    ) {
      return arrowState;
    }

    const minIdx = memSlotDependencies[0];
    // selected line is always the bottom anchor even if it may not read/write
    // this memSlot
    const maxIdx = selectedLine;

    if (minIdx == maxIdx) {
      return arrowState;
    }

    arrowState.end = maxIdx;

    for (let idx = minIdx; idx < maxIdx; idx++) {
      if (idx === minIdx) {
        arrowState.start = idx;
      } else if (memSlotDependencies.includes(idx)) {
        arrowState.mids.add(idx);
      } else if (minIdx < idx && idx < maxIdx) {
        arrowState.tracks.add(idx);
      }
    }

    return arrowState;
  }, [
    selectedLine,
    selectedMemSlotId,
    memSlotDependencies,
    verifierLogState,
    logLines,
  ]);

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

  const handleCLinesClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const cline = target.closest(".c-line");
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

  const handleStateLogLineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const visualIdx = logLineIdxToVisualIdx.get(selectedLine);
      if (visualIdx !== undefined) {
        scrollToLogLine(visualIdx);
      }
      e.stopPropagation();
    },
    [logLines, selectedLine],
  );

  const handleStateCLineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const cLineId =
        verifierLogState.cSourceMap.logLineToCLine.get(selectedLine);
      if (cLineId) {
        const cLineIdx = cLineIdToVisualIdx.get(cLineId);
        if (cLineIdx !== undefined) {
          scrollToCLine(cLineIdx);
        }
      }
      e.stopPropagation();
    },
    [verifierLogState, cLines, cLineIdToVisualIdx, selectedLine],
  );

  const handleMainContentClick = useCallback(() => {
    setSelectedState((prevSelected) => {
      return { ...prevSelected, memSlotId: "" };
    });
  }, []);

  const handleLogLinesClickSub = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hoveredElement = e.target as HTMLElement;
      const depArrow = hoveredElement.closest(".dep-track") as HTMLElement;
      if (!depArrow) {
        handleLogLinesClick(e);
        return;
      }
      e.stopPropagation();
      const id = parseInt(depArrow.getAttribute("line-id") || "0", 10);
      const ids = [...memSlotDependencies, selectedLine];

      let prev = ids[0];
      let next = ids[ids.length - 1];
      for (let i = 1; i < ids.length; i++) {
        if (ids[i] > id) {
          next = ids[i];
          break;
        } else {
          prev = ids[i];
        }
      }

      if (depArrow.classList.contains("active-down")) {
        scrollToLogLine(logLineIdxToVisualIdx.get(next) || 0);
      } else if (depArrow.classList.contains("active-up")) {
        scrollToLogLine(logLineIdxToVisualIdx.get(prev) || 0);
      }
    },
    [logLines, logLineIdxToVisualIdx, memSlotDependencies, selectedLine],
  );

  const handleLogLinesOverSub = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hoveredElement = e.target as HTMLElement;
      const depArrow = hoveredElement.closest(".dep-track") as HTMLElement;
      if (depArrow) {
        const id = parseInt(depArrow.getAttribute("line-id") || "0", 10);
        const ids = [...memSlotDependencies, selectedLine];

        let prev = ids[0];
        let next = ids[ids.length - 1];
        for (let i = 1; i < ids.length; i++) {
          if (ids[i] > id) {
            next = ids[i];
            break;
          } else {
            prev = ids[i];
          }
        }

        const min = visualLogIndexRange.visualLogStart;
        const max = visualLogIndexRange.visualLogEnd;
        const isVisible = (id: number) => {
          const visualIdx = logLineIdxToVisualIdx.get(id) || 0;
          return min < visualIdx && visualIdx < max;
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
          if ((logLineIdxToVisualIdx.get(id) || 0) < mid) {
            setTargetToPrev();
          } else {
            setTargetToNext();
          }
        }
      }
      handleLogLinesOver(e);
    },
    [
      logLines,
      logLineIdxToVisualIdx,
      memSlotDependencies,
      selectedLine,
      visualLogIndexRange,
    ],
  );

  return (
    <div
      id="main-content"
      className="main-content"
      onClick={handleMainContentClick}
    >
      <CSourceLines
        handleCLinesClick={handleCLinesClick}
        showFullLog={visualLogState.showFullLog}
        handleFullLogToggle={handleFullLogToggle}
        selectedState={selectedState}
        memSlotDependencies={memSlotDependencies}
        visualLogState={visualLogState}
        cListRef={cListRef}
        onCRowsRendered={onCRowsRendered}
        testListHeight={testListHeight}
      />
      <div
        id="log-container"
        className={selectedMemSlotId !== "" ? "active_mem_slot" : ""}
      >
        <div
          id="goto-start"
          className="nav-arrow log-nav-button"
          onClick={onGotoStart}
        >
          <div className="log-button-txt">⇒</div>
          <div className="nav-arrow-tooltip up-down-tooltip">Go To Start</div>
        </div>
        <div
          id="goto-end"
          className="nav-arrow log-nav-button"
          onClick={onGotoEnd}
        >
          <div className="log-button-txt">⇒</div>
          <div className="nav-arrow-tooltip up-down-tooltip">Go To End</div>
        </div>
        <div
          id="log-content"
          onClick={handleLogLinesClickSub}
          onMouseOver={handleLogLinesOverSub}
          onMouseOut={handleLogLinesOut}
        >
          <LogLines
            verifierLogState={verifierLogState}
            logLines={logLines}
            logListRef={logListRef}
            memSlotDependencies={memSlotDependencies}
            selectedState={selectedState}
            depArrowState={depArrowState}
            onLogRowsRendered={onLogRowsRendered}
            testListHeight={testListHeight}
          />
        </div>
      </div>
      <StatePanel
        selectedState={selectedState}
        verifierLogState={verifierLogState}
        handleStateLogLineClick={handleStateLogLineClick}
        handleStateCLineClick={handleStateCLineClick}
        handleStateRowClick={handleStateRowClick}
      />
    </div>
  );
}
