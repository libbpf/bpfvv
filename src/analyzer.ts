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
  getCLineId,
  KnownMessageInfoType,
  GlobalFuncValidInfo,
} from "./parser";

export type BpfValue = {
  value: string;
  effect: Effect;
  prevValue?: string;
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
  cLines: string[];
  cLineIdtoIdx: Map<string, number>;
  bpfStates: BpfState[];
  cSourceMap: CSourceMap;
  lastInsIdx: number;
};

export function makeValue(
  value: string,
  effect: Effect = Effect.NONE,
  prevValue: string = "",
): BpfValue {
  const ret: BpfValue = { value, effect };
  if (prevValue) ret.prevValue = prevValue;
  return ret;
}

export function initialBpfState(): BpfState {
  let values = new Map<string, BpfValue>();
  for (let i = 0; i < 10; i++) {
    values.set(`r${i}`, { value: "", effect: Effect.NONE });
  }
  values.set("r1", makeValue("ctx()"));
  values.set("r10", makeValue("fp-0"));
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
  values.set("r10", makeValue("fp-0"));

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
    const val = makeValue("", effects.get(id));
    if (val.effect === Effect.UPDATE)
      val.prevValue = newState.values.get(id)?.value;
    newState.values.set(id, val);
    newState.lastKnownWrites.set(id, line.idx);
  }

  // If verifier reported a particular expr, it overrides any values we may have computed so far
  // This means, for example, that conditions can be UPDATEs
  for (const expr of line.bpfStateExprs) {
    const val: BpfValue | undefined = newState.values.get(expr.id);
    let effect = effects.get(expr.id) || Effect.NONE;
    if (!val) {
      effect = Effect.WRITE;
      newState.lastKnownWrites.set(expr.id, line.idx);
    } else if (expr.value !== val.value && effect !== Effect.WRITE) {
      effect = Effect.UPDATE;
      newState.lastKnownWrites.set(expr.id, line.idx);
    }
    newState.values.set(
      expr.id,
      makeValue(expr.value, effect, val?.prevValue || ""),
    );
  }

  setIdxAndPc(newState);
  return newState;
}

export function getEmptyVerifierState(): VerifierLogState {
  return {
    lines: [],
    cLines: [],
    cLineIdtoIdx: new Map(),
    bpfStates: [],
    cSourceMap: new CSourceMap(),
    lastInsIdx: 0,
  };
}

function updateGlobalFuncCall(callLine: ParsedLine, info: GlobalFuncValidInfo) {
  // "assumed valid" message indicates that previous instructions was a call to a global function which verifier recognizes as valid.
  // So we change the call ParsedLine to a HELPER_CALL, so that it is processed accordingly.
  if (callLine.type !== ParsedLineType.INSTRUCTION) return;
  const ins = callLine.bpfIns;
  if (
    ins.kind !== BpfInstructionKind.JMP ||
    ins.jmpKind !== BpfJmpKind.SUBPROGRAM_CALL
  )
    return;
  ins.jmpKind = BpfJmpKind.HELPER_CALL;
  ins.target = info.funcName;
  ins.reads = BPF_SCRATCH_REGS;
  ins.writes = ["r0", ...BPF_SCRATCH_REGS];
}

export function processRawLines(rawLines: string[]): VerifierLogState {
  let bpfStates: BpfState[] = [];
  let lines: ParsedLine[] = [];
  let savedBpfStates: BpfState[] = [];
  let idxsForCLine: number[] = [];
  let currentCSourceLine: CSourceLine | undefined;
  const cSourceMap = new CSourceMap();
  const knownMessageIdxs: number[] = [];
  let lastInsIdx: number = 0;

  // First pass: parse individual lines
  lines = rawLines.map((rawLine, idx) => {
    const parsedLine = parseLine(rawLine, idx);
    if (parsedLine.type === ParsedLineType.KNOWN_MESSAGE) {
      knownMessageIdxs.push(idx);
    }
    return parsedLine;
  });

  for (let i = lines.length - 1; i >= 0; --i) {
    if (lines[i].type == ParsedLineType.INSTRUCTION) {
      lastInsIdx = lines[i].idx;
      break;
    }
  }

  // Process known messages and fixup parsed lines
  knownMessageIdxs.forEach((idx) => {
    const parsedLine = lines[idx];
    if (
      idx > 0 &&
      parsedLine.type === ParsedLineType.KNOWN_MESSAGE &&
      parsedLine.info.type == KnownMessageInfoType.GLOBAL_FUNC_VALID
    ) {
      updateGlobalFuncCall(lines[idx - 1], parsedLine.info);
    }
  });

  // Second pass: build CSourceMap and BpfState[]
  lines.forEach((parsedLine, idx) => {
    switch (parsedLine.type) {
      case ParsedLineType.C_SOURCE: {
        if (currentCSourceLine) {
          cSourceMap.addCSourceLine(currentCSourceLine, idxsForCLine);
          idxsForCLine = [];
        }
        currentCSourceLine = parsedLine;
        break;
      }
      case ParsedLineType.INSTRUCTION: {
        idxsForCLine.push(idx);
        break;
      }
    }
    const bpfState = nextBpfState(
      getBpfState(bpfStates, idx).state,
      parsedLine,
      savedBpfStates,
    );
    bpfStates.push(bpfState);
  });
  if (currentCSourceLine) {
    cSourceMap.addCSourceLine(currentCSourceLine, idxsForCLine);
  }

  const cLines = [];
  const cLineIdtoIdx: Map<string, number> = new Map();
  let i = 0;
  for (const [file, range] of cSourceMap.fileRange) {
    let unknownStart = 0;
    for (let j = range[0]; j < range[1]; ++j) {
      const cLineId = getCLineId(file, j);
      const sourceLine = cSourceMap.cSourceLines.get(cLineId);
      if (!sourceLine) {
        if (!unknownStart) {
          unknownStart = i;
        }
        continue;
      }
      if (unknownStart > 0) {
        cLines.push("");
        cLineIdtoIdx.set(cLineId, i++);
      }
      unknownStart = 0;
      cLines.push(cLineId);
      cLineIdtoIdx.set(cLineId, i++);
    }
  }

  return {
    lines,
    bpfStates,
    cSourceMap,
    cLines,
    cLineIdtoIdx,
    lastInsIdx,
  };
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

  const depIdx = bpfState.lastKnownWrites.get(memSlotId);
  if (!depIdx || lines[depIdx].type !== ParsedLineType.INSTRUCTION) return deps;

  const depIns = lines[depIdx].bpfIns;
  const nReads = depIns?.reads?.length;

  if (depIdx === selectedLine && effect === Effect.UPDATE) {
    const prevBpfState = getBpfState(bpfStates, selectedLine - 1).state;
    if (prevBpfState.lastKnownWrites.has(memSlotId)) {
      const prevDepIdx = prevBpfState.lastKnownWrites.get(memSlotId);
      if (!prevDepIdx) return deps;

      // stop the chain on scratches
      const prevDepState = getBpfState(bpfStates, prevDepIdx).state;
      const writtenValue = prevDepState.values.get(memSlotId)?.value;
      if (!writtenValue) return deps;

      deps = getMemSlotDependencies(verifierLogState, prevDepIdx, memSlotId);
    }
  } else if (
    nReads === 1 &&
    (depIdx !== bpfState.idx || depIns.reads[0] !== memSlotId)
  ) {
    deps = getMemSlotDependencies(verifierLogState, depIdx, depIns.reads[0]);
  }

  deps.add(depIdx);

  return deps;
}
