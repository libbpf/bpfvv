import {
    BPF_CALLEE_SAVED_REGS,
    BPF_SCRATCH_REGS,
    BpfJmpKind,
    ParsedLine,
    ParsedLineType,
} from "./parser.js";

export enum Effect {
    NONE = "NONE",
    READ = "READ",
    WRITE = "WRITE",
    UPDATE = "UPDATE", // read then write, e.g. r0 += 1
}

export type BpfValue = {
    value: string;
    effect: Effect;
};

export type BpfState = {
    values: Map<string, BpfValue>;
    lastKnownWrites: Map<string, number>;
    frame: number;
    idx: number;
    pc: number;
};

export const makeValue = (
    value: string,
    effect: Effect = Effect.NONE
): BpfValue => {
    // @Hack display fp0 as fp-0
    if (value === "fp0") value = "fp-0";
    return { value, effect };
};

export const initialBpfState = (): BpfState => {
    let values = new Map<string, BpfValue>();
    for (let i = 0; i < 10; i++) {
        values.set(`r${i}`, null);
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
};

export const copyBpfState = (state: BpfState): BpfState => {
    let values = new Map<string, BpfValue>();
    for (const [key, val] of state.values.entries()) {
        // Don't copy the effect, only the value
        if (val?.value)
            values.set(key, { value: val.value, effect: Effect.NONE });
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
};

// The stack of saved BpfStates, only needed while we are loading the log
const SAVED_BPF_STATES: BpfState[] = [];

export const pushStackFrame = (state: BpfState): BpfState => {
    // In a new stack frame we only copy the scratch (argument) registers
    // Everything else is cleared
    SAVED_BPF_STATES.push(copyBpfState(state));

    let values = new Map<string, BpfValue>();
    for (const r of BPF_SCRATCH_REGS) {
        const val = state.values.get(r)?.value;
        values.set(r, { value: val, effect: Effect.READ });
    }
    for (const r of ["r0", ...BPF_CALLEE_SAVED_REGS]) {
        values.set(r, { value: "", effect: Effect.WRITE });
    }
    values.set("r10", makeValue("fp0"));

    let lastKnownWrites = new Map<string, number>();
    for (const r of BPF_SCRATCH_REGS) {
        lastKnownWrites.set(r, state.lastKnownWrites.get(r));
    }

    return {
        values,
        lastKnownWrites,
        frame: state.frame + 1,
        idx: state.idx,
        pc: state.pc,
    };
};

export const popStackFrame = (exitingState: BpfState): BpfState => {
    // input log might be incomplete
    // if exit is encountered before any subprogram calls
    // return a fresh stack frame
    if (SAVED_BPF_STATES.length == 0) {
        return initialBpfState();
    }
    // no need to copy the full state here, it was copied on push
    const state = SAVED_BPF_STATES.pop();
    for (const r of BPF_SCRATCH_REGS) {
        state.values.set(r, { value: "", effect: Effect.WRITE });
        state.lastKnownWrites.delete(r);
    }
    // copy r0 info from the exiting state
    const val = exitingState.values.get("r0")?.value || "";
    state.values.set("r0", { value: val, effect: Effect.NONE });
    state.lastKnownWrites.set("r0", exitingState.lastKnownWrites.get("r0"));
    return state;
};

export const nextBpfState = (state: BpfState, line: ParsedLine): BpfState => {
    if (line.type !== ParsedLineType.INSTRUCTION) return state;

    const setIdxAndPc = (bpfState: BpfState) => {
        bpfState.idx = line.idx;
        bpfState.pc = line.bpfIns?.pc;
    };

    let newState: BpfState;
    switch (line.bpfIns?.jmp?.kind) {
        case BpfJmpKind.BPF2BPF_CALL:
            newState = pushStackFrame(state);
            setIdxAndPc(newState);
            return newState;
        case BpfJmpKind.EXIT:
            newState = popStackFrame(state);
            setIdxAndPc(newState);
            return newState;
        default:
            break;
    }

    newState = copyBpfState(state);
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
    for (const expr of line.bpfStateExprs) {
        let effect = effects.get(expr.id) || Effect.NONE;
        newState.values.set(expr.id, makeValue(expr.value, effect));
    }

    setIdxAndPc(newState);
    return newState;
};
