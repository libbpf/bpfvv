import {
  BPF_CALLEE_SAVED_REGS,
  BPF_SCRATCH_REGS,
  BpfInstructionKind,
  BpfJmpKind,
  CSourceLine,
  Effect,
  ParsedLine,
  ParsedLineType,
  parseLine,
} from "./parser";

export type BpfValue = {
  value: string;
  effect: Effect;
};

/*
    BpfState represents an accumulated state of the BPF program at a particular point of execution (that is: at a particular line of the BPF verifier log).
    It is computed by sequentially applying the effects of each instruction (ParsedLine of ParsedLineType.INSTRUCTION)
    to the previous state, following the rules of the BPF execution: new stack frame for each subprogram, register scratching etc.
 */
export type BpfState = {
  values: Map<string, BpfValue>;
  lastKnownWrites: Map<string, number>;
  frame: number;
  idx: number;
  pc: number;
};

export class CSourceMap {
  // deduped C source lines, id is a key in this array
  cSourceLines: Map<string, CSourceLine> = new Map<string, CSourceLine>();
  // log line idx -> C source line id
  logLineToCLine: Map<number, string> = new Map<number, string>();
  // C source line id -> log line idx
  cLineToLogLines: Map<string, Set<number>> = new Map<string, Set<number>>();
  // fileName -> [minLineNum, maxLineNum]
  fileRange: Map<string, [number, number]> = new Map<
    string,
    [number, number]
  >();

  addCSourceLine(line: CSourceLine, idxs: number[]): void {
    if (!this.cSourceLines.has(line.id)) {
      this.cSourceLines.set(line.id, line);
    }
    const idxSet = this.cLineToLogLines.get(line.id) || new Set<number>();
    idxs.forEach((idx) => {
      this.logLineToCLine.set(idx, line.id);
      idxSet.add(idx);
    });
    this.cLineToLogLines.set(line.id, idxSet);

    const range = this.fileRange.get(line.fileName) || [
      line.lineNum,
      line.lineNum,
    ];
    range[0] = Math.min(range[0], line.lineNum);
    range[1] = Math.max(range[1], line.lineNum);
    this.fileRange.set(line.fileName, range);
  }
}

/*
    VerifierLogState represents the entirety of the processed BPF verifier log, ready for consumption by the UI.
    The basic unit of the log is a line, which generally corresponds to a single BPF instruction.
    The log line and it's corresponding BpfState can be uniquely identified by the line's index (idx) in the input.
 */
export type VerifierLogState = {
  lines: ParsedLine[];
  bpfStates: BpfState[];
  cSourceMap: CSourceMap;
};

export function makeValue(
  value: string,
  effect: Effect = Effect.NONE,
): BpfValue {
  // @Hack display fp0 as fp-0
  if (value === "fp0") value = "fp-0";
  return { value, effect };
}

export function initialBpfState(): BpfState {
  let values = new Map<string, BpfValue>();
  for (let i = 0; i < 10; i++) {
    values.set(`r${i}`, { value: "", effect: Effect.NONE });
  }
  values.set("r1", makeValue("ctx()"));
  values.set("r10", makeValue("fp0"));
  let lastKnownWrites = new Map<string, number>();
  lastKnownWrites.set("r1", 0);
  lastKnownWrites.set("r10", 0);
  return {
    values,
    lastKnownWrites,
    frame: 0,
    idx: 0,
    pc: 0,
  };
}

export function getBpfState(
  bpfStates: BpfState[],
  idx: number,
): { state: BpfState; idx: number } {
  if (bpfStates.length === 0 || idx < 0) {
    return { state: initialBpfState(), idx: 0 };
  }
  idx = Math.min(idx, bpfStates.length - 1);
  return { state: bpfStates[idx], idx };
}

function copyBpfState(state: BpfState): BpfState {
  let values = new Map<string, BpfValue>();
  for (const [key, val] of state.values.entries()) {
    // Don't copy the effect, only the value
    if (val?.value) values.set(key, { value: val.value, effect: Effect.NONE });
  }
  let lastKnownWrites = new Map<string, number>();
  for (const [key, val] of state.lastKnownWrites.entries()) {
    lastKnownWrites.set(key, val);
  }
  return {
    values,
    lastKnownWrites,
    frame: state.frame,
    idx: state.idx,
    pc: state.pc,
  };
}

function pushStackFrame(
  bpfState: BpfState,
  savedBpfStates: BpfState[],
): BpfState {
  // In a new stack frame we only copy the scratch (argument) registers
  // Everything else is cleared
  savedBpfStates.push(copyBpfState(bpfState));

  let values = new Map<string, BpfValue>();
  for (const r of BPF_SCRATCH_REGS) {
    const val = bpfState.values.get(r)?.value;
    values.set(r, { value: val || "", effect: Effect.READ });
  }
  for (const r of ["r0", ...BPF_CALLEE_SAVED_REGS]) {
    values.set(r, { value: "", effect: Effect.WRITE });
  }
  values.set("r10", makeValue("fp0"));

  let lastKnownWrites = new Map<string, number>();
  for (const r of BPF_SCRATCH_REGS) {
    lastKnownWrites.set(r, bpfState.lastKnownWrites.get(r) || 0);
  }

  return {
    values,
    lastKnownWrites,
    frame: bpfState.frame + 1,
    idx: bpfState.idx,
    pc: bpfState.pc,
  };
}

function popStackFrame(
  bpfState: BpfState,
  savedBpfStates: BpfState[],
): BpfState {
  // input log might be incomplete
  // if exit is encountered before any subprogram calls
  // return a fresh stack frame
  if (savedBpfStates.length === 0) {
    return initialBpfState();
  }
  // no need to copy the full state here, it was copied on push
  let state = savedBpfStates.pop();
  if (!state) {
    return initialBpfState();
  }
  for (const r of BPF_SCRATCH_REGS) {
    state.values.set(r, { value: "", effect: Effect.WRITE });
    state.lastKnownWrites.delete(r);
  }
  // copy r0 info from the exiting state
  const val = bpfState.values.get("r0")?.value || "";
  state.values.set("r0", { value: val, effect: Effect.NONE });
  state.lastKnownWrites.set("r0", bpfState.lastKnownWrites.get("r0") || 0);
  return state;
}

function nextBpfState(
  bpfState: BpfState,
  line: ParsedLine,
  savedBpfStates: BpfState[],
): BpfState {
  if (line.type !== ParsedLineType.INSTRUCTION) return bpfState;

  const setIdxAndPc = (state: BpfState) => {
    state.idx = line.idx;
    state.pc = line.bpfIns?.pc || 0;
  };

  let newState: BpfState;
  const ins = line.bpfIns;
  if (
    ins &&
    ins.kind === BpfInstructionKind.JMP &&
    ins.jmpKind === BpfJmpKind.SUBPROGRAM_CALL
  ) {
    newState = pushStackFrame(bpfState, savedBpfStates);
    setIdxAndPc(newState);
    return newState;
  } else if (
    ins &&
    ins.kind === BpfInstructionKind.JMP &&
    ins.jmpKind === BpfJmpKind.EXIT
  ) {
    newState = popStackFrame(bpfState, savedBpfStates);
    setIdxAndPc(newState);
    return newState;
  }

  newState = copyBpfState(bpfState);
  let effects = new Map<string, Effect>();
  for (const id of line.bpfIns?.reads || []) {
    effects.set(id, Effect.READ);
  }
  for (const id of line.bpfIns?.writes || []) {
    if (effects.has(id)) effects.set(id, Effect.UPDATE);
    else effects.set(id, Effect.WRITE);
    newState.values.set(id, makeValue("", effects.get(id)));
    newState.lastKnownWrites.set(id, line.idx);
  }

  // verifier reported values
  if (line.bpfStateExprs) {
    for (const expr of line.bpfStateExprs) {
      let effect = effects.get(expr.id) || Effect.NONE;
      newState.values.set(expr.id, makeValue(expr.value, effect));
    }
  }

  setIdxAndPc(newState);
  return newState;
}

export function processRawLines(rawLines: string[]): VerifierLogState {
  let bpfStates: BpfState[] = [];
  let lines: ParsedLine[] = [];
  let savedBpfStates: BpfState[] = [];
  let idxsForCLine: number[] = [];
  let currentCSourceLine: CSourceLine | undefined;
  const cSourceMap = new CSourceMap();

  rawLines.forEach((rawLine, idx) => {
    const parsedLine = parseLine(rawLine, idx);
    switch (parsedLine.type) {
      case ParsedLineType.C_SOURCE:
        if (currentCSourceLine) {
          cSourceMap.addCSourceLine(currentCSourceLine, idxsForCLine);
          idxsForCLine = [];
        }
        currentCSourceLine = parsedLine;
        break;
      case ParsedLineType.INSTRUCTION:
        idxsForCLine.push(idx);
        break;
    }
    const bpfState = nextBpfState(
      getBpfState(bpfStates, idx).state,
      parsedLine,
      savedBpfStates,
    );
    bpfStates.push(bpfState);
    lines.push(parsedLine);
  });
  if (currentCSourceLine) {
    cSourceMap.addCSourceLine(currentCSourceLine, idxsForCLine);
  }
  return { lines, bpfStates, cSourceMap };
}

export function getMemSlotDependencies(
  verifierLogState: VerifierLogState,
  selectedLine: number,
  memSlotId: string,
): Set<number> {
  const { lines, bpfStates } = verifierLogState;
  let deps = new Set<number>();
  if (lines[selectedLine].type !== ParsedLineType.INSTRUCTION) return deps;

  const bpfState = bpfStates[selectedLine];
  if (!bpfState) return deps;

  const effect = bpfState.values.get(memSlotId)?.effect;
  if (!effect) return deps;

  if (!bpfState.lastKnownWrites.has(memSlotId)) return deps;

  const depIdx = bpfState.lastKnownWrites.get(memSlotId);
  if (!depIdx || lines[depIdx].type !== ParsedLineType.INSTRUCTION) return deps;
  const depIns = lines[depIdx].bpfIns;

  const nReads = depIns?.reads?.length;

  if (depIdx === selectedLine && effect === Effect.UPDATE) {
    const prevBpfState = getBpfState(bpfStates, selectedLine - 1).state;
    if (prevBpfState.lastKnownWrites.has(memSlotId)) {
      const prevDepIdx = prevBpfState.lastKnownWrites.get(memSlotId);
      if (!prevDepIdx) return deps;
      deps = getMemSlotDependencies(verifierLogState, prevDepIdx, memSlotId);
    }
  } else if (nReads === 1) {
    deps = getMemSlotDependencies(verifierLogState, depIdx, depIns.reads[0]);
  }

  deps.add(depIdx);

  return deps;
}
