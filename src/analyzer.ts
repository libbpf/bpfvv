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
  KnownMessageInfoType,
  GlobalFuncValidInfo,
  InstructionLine,
  BpfStateExprsInfo,
  OperandType,
  BpfOperand,
  BpfInstruction,
  parseStackSlotId,
} from "./parser";
import {
  BpfMemSlotMap,
  insEntersNewFrame,
  stackSlotIdFromDisplayId,
  siblingInsLine,
} from "./utils";

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
export class BpfState {
  values: BpfMemSlotMap<BpfValue>;
  lastKnownWrites: BpfMemSlotMap<number>;
  frame: number;
  idx: number;
  pc: number;
  constructor({
    frame = 0,
    idx = 0,
    pc = 0,
    values = null,
    lastKnownWrites = null,
  }: {
    frame?: number;
    idx?: number;
    pc?: number;
    values?: BpfMemSlotMap<BpfValue> | null;
    lastKnownWrites?: BpfMemSlotMap<number> | null;
  }) {
    this.frame = frame;
    this.idx = idx;
    this.pc = pc;

    if (values !== null) {
      this.values = values;
    } else {
      this.values = new BpfMemSlotMap<BpfValue>(frame);
      for (let i = 0; i < 10; i++) {
        this.values.set(`r${i}`, { value: "", effect: Effect.NONE });
      }
      this.values.set("r1", makeValue("ctx()"));
      this.values.set("r10", makeValue("fp-0"));
    }

    if (lastKnownWrites !== null) {
      this.lastKnownWrites = lastKnownWrites;
    } else {
      this.lastKnownWrites = new BpfMemSlotMap<number>(this.frame);
      this.lastKnownWrites.set("r1", 0);
      this.lastKnownWrites.set("r10", 0);
    }
  }

  copy(): BpfState {
    const values = new BpfMemSlotMap<BpfValue>(this.frame);
    for (const [key, val] of this.values.entries()) {
      // Don't copy the effect, only the value
      if (val?.value)
        values.set(key, { value: val.value, effect: Effect.NONE });
    }
    const lastKnownWrites = new BpfMemSlotMap<number>(this.frame);
    for (const [key, val] of this.lastKnownWrites.entries()) {
      lastKnownWrites.set(key, val);
    }
    return new BpfState({
      frame: this.frame,
      idx: this.idx,
      pc: this.pc,
      values,
      lastKnownWrites,
    });
  }

  setLineMetaData(line: ParsedLine) {
    if (line.type !== ParsedLineType.INSTRUCTION) return;
    this.idx = line.idx;
    this.pc = line.bpfIns.pc || 0;
    // If frame was explicitly printed by verifier, use that value
    const frame = line.bpfStateExprs[0]?.frame;
    if (frame !== undefined) {
      this.frame = frame;
      this.values.setFrame(frame);
      this.lastKnownWrites.setFrame(frame);
    }
  }
}

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

export function getBpfState(bpfStates: BpfState[], idx: number): BpfState {
  if (bpfStates.length === 0 || idx < 0) {
    return new BpfState({});
  }
  idx = Math.min(idx, bpfStates.length - 1);
  return bpfStates[idx];
}

function pushStackFrame(
  bpfState: BpfState,
  savedBpfStates: BpfState[],
): BpfState {
  // In a new stack frame we only copy the scratch (argument) registers
  // Everything else is cleared
  savedBpfStates.push(bpfState.copy());
  const nextFrame = bpfState.frame + 1;

  let values = new BpfMemSlotMap<BpfValue>(nextFrame);
  for (const r of BPF_SCRATCH_REGS) {
    const val = bpfState.values.get(r)?.value;
    values.set(r, { value: val || "", effect: Effect.READ });
  }
  for (const r of ["r0", ...BPF_CALLEE_SAVED_REGS]) {
    values.set(r, { value: "", effect: Effect.WRITE });
  }
  values.set("r10", makeValue("fp-0"));

  let lastKnownWrites = new BpfMemSlotMap<number>(nextFrame);
  for (const r of BPF_SCRATCH_REGS) {
    lastKnownWrites.set(r, bpfState.lastKnownWrites.get(r) || 0);
  }

  // Carry over the stack slot values from the parent frames
  // using the fp[frame]-offset notation
  for (const [id, val] of bpfState.values.entries()) {
    const stackSlotId = parseStackSlotId(id);
    if (stackSlotId === null) continue;
    const frame =
      stackSlotId.frame !== undefined ? stackSlotId.frame : bpfState.frame;
    const nestedId = `fp[${frame}]${stackSlotId.offset}`;
    values.set(nestedId, val);
    lastKnownWrites.set(nestedId, bpfState.lastKnownWrites.get(id) || 0);
  }

  return new BpfState({
    frame: nextFrame,
    idx: bpfState.idx,
    pc: bpfState.pc,
    values,
    lastKnownWrites,
  });
}

function popStackFrame(
  innerFrameState: BpfState,
  savedBpfStates: BpfState[],
): BpfState {
  // input log might be incomplete
  // if exit is encountered before any subprogram calls
  // return a fresh stack frame
  if (savedBpfStates.length === 0) {
    return new BpfState({});
  }
  // no need to copy the full state here, it was copied on push
  let state = savedBpfStates.pop();
  if (!state) {
    return new BpfState({});
  }

  for (const r of BPF_SCRATCH_REGS) {
    state.values.set(r, { value: "", effect: Effect.WRITE });
    state.lastKnownWrites.delete(r);
  }

  // When popping a stack frame, we have to carry over any writes
  // to the parent stack slots, so that they are included in dependencies.
  // For example, if the current stack is 2 and there was a write to fp[1]-16
  // we have to copy this information, because it was absent in a saved (popped) state
  for (const [id, writeIdx] of innerFrameState.lastKnownWrites) {
    const stackSlotId = parseStackSlotId(id);
    if (
      stackSlotId &&
      stackSlotId.frame !== undefined &&
      stackSlotId.frame <= state.frame
    ) {
      state.lastKnownWrites.set(id, writeIdx);
      const val = innerFrameState.values.get(id);
      if (val !== undefined) state.values.set(id, val);
    }
  }

  // copy r0 info from the exiting state
  const val = innerFrameState.values.get("r0")?.value || "";
  state.values.set("r0", { value: val, effect: Effect.NONE });
  state.lastKnownWrites.set(
    "r0",
    innerFrameState.lastKnownWrites.get("r0") || 0,
  );

  return state;
}

function srcValue(ins: BpfInstruction, state: BpfState): string {
  if (ins.kind === BpfInstructionKind.ALU) {
    return state.values.get(ins.src.id)?.value || "";
  } else {
    return "";
  }
}

function collectVerifierReportedValues(
  state: BpfState,
  line: InstructionLine,
  insEffects: Map<string, Effect>,
): Map<string, BpfValue> {
  const verifierReportedValues = new Map<string, BpfValue>();
  for (const expr of line.bpfStateExprs) {
    const val: BpfValue | undefined = state.values.get(expr.id);
    let effect = insEffects.get(expr.id) || Effect.NONE;
    if (!val) {
      effect = Effect.WRITE;
    } else if (expr.value !== val.value && effect !== Effect.WRITE) {
      effect = Effect.UPDATE;
    }
    verifierReportedValues.set(
      expr.id,
      makeValue(expr.value, effect, val?.prevValue || ""),
    );
  }
  return verifierReportedValues;
}

function updateBpfStateValues(
  state: BpfState,
  line: InstructionLine,
  verifierReportedValues: Map<string, BpfValue>,
) {
  for (const [id, val] of verifierReportedValues.entries()) {
    state.values.set(id, val);
    if (val.effect === Effect.WRITE || val.effect === Effect.UPDATE)
      state.lastKnownWrites.set(id, line.idx);
  }
}

function nextBpfState(
  bpfState: BpfState,
  line: ParsedLine,
  savedBpfStates: BpfState[],
): BpfState {
  if (line.type !== ParsedLineType.INSTRUCTION) return bpfState;

  let newState: BpfState;
  const ins = line.bpfIns;
  if (insEntersNewFrame(ins)) {
    newState = pushStackFrame(bpfState, savedBpfStates);
    newState.setLineMetaData(line);
    // In some cases, such as bpf_loop, the call instruction line may contain state updates
    // That is: line.bpfStateExprs may be non-empty, as usual for subprogram calls
    // So we have to do collectVerifierReportedValues() here
    const verifierReportedValues = collectVerifierReportedValues(
      newState,
      line,
      new Map<string, Effect>(),
    );
    updateBpfStateValues(newState, line, verifierReportedValues);
    return newState;
  } else if (
    ins.kind === BpfInstructionKind.JMP &&
    ins.jmpKind === BpfJmpKind.EXIT
  ) {
    newState = popStackFrame(bpfState, savedBpfStates);
    newState.setLineMetaData(line);
    return newState;
  }

  newState = bpfState.copy();
  newState.setLineMetaData(line);

  let effects = new Map<string, Effect>();
  for (const id of line.bpfIns?.reads || []) {
    effects.set(id, Effect.READ);
  }

  for (const id of line.bpfIns?.writes || []) {
    if (effects.has(id)) effects.set(id, Effect.UPDATE);
    else effects.set(id, Effect.WRITE);

    const val = makeValue(srcValue(ins, newState), effects.get(id));
    if (val.effect === Effect.UPDATE)
      val.prevValue = newState.values.get(id)?.value;
    newState.values.set(id, val);
    newState.lastKnownWrites.set(id, line.idx);
  }

  const verifierReportedValues = collectVerifierReportedValues(
    newState,
    line,
    effects,
  );
  updateBpfStateValues(newState, line, verifierReportedValues);

  // Evaluate indirect stack load/store
  // For any memory access, check the current value of the register.
  // If it is a pointer to stack (e.g. fp-16),
  // then evaluate the offsets to get the referenced stack slot id
  // and update the values map accordingly.
  // For example:
  //     r6 = *(u64 *)(r1 -8) ; R1=fp-16
  // We know that r1=fp-16, and the load is from r1-8, so
  // we calculate: -8 + -16 = -24 and know that the value at
  // fp-24 was loaded into r6.
  function fpIdFromMemref(op: BpfOperand): string | null {
    if (!op.memref) return null;
    const { reg, offset } = op.memref;
    const val = newState.values.get(reg)?.value || "";
    const stackSlotId = parseStackSlotId(val);
    if (stackSlotId === null) return null;
    const off = offset + stackSlotId.offset;
    const frame =
      stackSlotId.frame === undefined ? newState.frame : stackSlotId.frame;
    return `fp[${frame}]${off}`;
  }

  if (ins.kind === BpfInstructionKind.ALU && ins.operator === "=") {
    if (ins.dst.type === OperandType.MEM) {
      const id = fpIdFromMemref(ins.dst);
      if (id) {
        const value =
          verifierReportedValues.get(id)?.value || srcValue(ins, newState);
        newState.values.set(id, makeValue(value, Effect.WRITE));
        newState.lastKnownWrites.set(id, line.idx);
      }
    }
    if (ins.src.type === OperandType.MEM) {
      const id = fpIdFromMemref(ins.src);
      if (id) {
        const value =
          verifierReportedValues.get(id)?.value ||
          newState.values.get(id)?.value ||
          "";
        newState.values.set(id, makeValue(value, Effect.READ));
        newState.values.set(ins.dst.id, makeValue(value, Effect.WRITE));
        newState.lastKnownWrites.set(ins.dst.id, line.idx);
      }
    }
  }

  return newState;
}

export function getEmptyVerifierState(): VerifierLogState {
  return {
    lines: [],
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

function updatePrevInsBpfState(
  lines: ParsedLine[],
  info: BpfStateExprsInfo,
  idx: number,
) {
  // the heuristic for BPF_STATE_EXPRS messages is to append
  // the exprs to the state of the _previous_ instruction
  const prevIdx = siblingInsLine(lines, idx, -1);
  if (prevIdx < idx) {
    const prevLine = <InstructionLine>lines[prevIdx];
    prevLine.bpfStateExprs.push(...info.bpfStateExprs);
  }
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
    if (parsedLine.type !== ParsedLineType.KNOWN_MESSAGE) return;
    const info = parsedLine.info;
    if (info.type === KnownMessageInfoType.GLOBAL_FUNC_VALID && idx > 0) {
      updateGlobalFuncCall(lines[idx - 1], info);
    } else if (info.type === KnownMessageInfoType.BPF_STATE_EXPRS) {
      updatePrevInsBpfState(lines, info, idx);
    }
  });

  let prevState = new BpfState({});
  // Second pass: build CSourceMap and BpfState[]
  lines.forEach((parsedLine, idx) => {
    const bpfState = nextBpfState(prevState, parsedLine, savedBpfStates);

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
        // fixup ids in `reads` and `writes` of an instruction
        parsedLine.bpfIns.reads = parsedLine.bpfIns.reads.map((id) =>
          stackSlotIdFromDisplayId(id, bpfState.frame),
        );
        parsedLine.bpfIns.writes = parsedLine.bpfIns.writes.map((id) =>
          stackSlotIdFromDisplayId(id, bpfState.frame),
        );

        break;
      }
    }

    bpfStates.push(bpfState);
    prevState = bpfState;
  });
  if (currentCSourceLine) {
    cSourceMap.addCSourceLine(currentCSourceLine, idxsForCLine);
  }

  return {
    lines,
    bpfStates,
    cSourceMap,
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

  if (selectedLine === 0) {
    deps.add(0);
    return deps;
  }

  const bpfState = bpfStates[selectedLine];
  if (!bpfState) return deps;

  memSlotId = stackSlotIdFromDisplayId(memSlotId, bpfState.frame);

  const effect = bpfState.values.get(memSlotId)?.effect;
  if (!effect) return deps;

  const depIdx = bpfState.lastKnownWrites.get(memSlotId);
  if (depIdx === undefined || lines[depIdx].type !== ParsedLineType.INSTRUCTION)
    return deps;

  const depIns = lines[depIdx].bpfIns;
  const nReads = depIns?.reads?.length;

  if (depIdx === selectedLine && effect === Effect.UPDATE) {
    const prevBpfState = getBpfState(bpfStates, selectedLine - 1);
    if (prevBpfState.lastKnownWrites.has(memSlotId)) {
      const prevDepIdx = prevBpfState.lastKnownWrites.get(memSlotId);
      if (prevDepIdx === undefined) return deps;

      // stop the chain on scratches
      const prevDepState = getBpfState(bpfStates, prevDepIdx);
      const writtenValue = prevDepState.values.get(memSlotId)?.value;
      if (!writtenValue) return deps;

      deps = getMemSlotDependencies(verifierLogState, prevDepIdx, memSlotId);
    }
  } else if (nReads === 1 && depIns.writes?.includes(memSlotId)) {
    // following a direct write from a singular source
    deps = getMemSlotDependencies(verifierLogState, depIdx, depIns.reads[0]);
  } else if (depIdx !== selectedLine) {
    // following a side effect
    deps = getMemSlotDependencies(verifierLogState, depIdx, memSlotId);
  }

  deps.add(depIdx);

  return deps;
}
