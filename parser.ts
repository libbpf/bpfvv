export type InsnArgs = {
    src: string;
    dst: string;
    src_reg: string;
    dst_reg: string;
}

export type ParsedInsnLine = {
    idx: number;
    hex: string;
    insn: InsnArgs;
    comment: string;
}

export enum Effect {
    NONE = 0,
    READ = 1,
    WRITE = 2,
}

export type BpfValue = {
    value: string;
    effect: Effect;
}

const makeValue = (value: string, effect: Effect = Effect.NONE): BpfValue => {
    return { value, effect };
}

export type BpfState = {
    values: Map<string, BpfValue>;
}

export const initialBpfState = (): BpfState => {
    let values = new Map<string, BpfValue>();
    for (let i = 0; i < 10; i++) {
        values.set(`r${i}`, null);
    }
    values.set('r1', makeValue('ctx()'));
    values.set('r10', makeValue('fp0'));
    return { values: values };
}

const copyBpfState = (state: BpfState): BpfState => {
    let values = new Map<string, BpfValue>();
    for (const [key, val] of state.values.entries()) {
        // Don't copy the effect, only the value
        const bpfValue = val ? { value: val.value, effect: Effect.NONE } : null;
        values.set(key, bpfValue);
    }
    return { values: values };
}

export type ParsedLine = {
    idx: number; // index of the line in the input file and state.lines array
    raw: string;
    insnLine?: ParsedInsnLine;
    bpfState?: BpfState;
}

export const parseInsn = (rawLine: string): ParsedInsnLine => {

    const regex = /([0-9]+): \(([0-9a-f]+)\) (.*)\s+; (.*)/;
    const match = rawLine.match(regex);
    if (!match)
        return null;

    const insn_str = match[3].trim();
    if (insn_str.startsWith('call ')) {
        return {
            idx: parseInt(match[1], 10),
            hex: match[2],
            insn: {
                src: insn_str,
                dst: insn_str,
                src_reg: null,
                dst_reg: 'r0',
            },
            comment: match[4].trim(),
        };
    }

    const insn_match = insn_str.split(' = ');

    let dst = null;
    let src = null;
    let dst_reg = null;
    let src_reg = null;
    if (insn_match) {
        dst = insn_match[0];
        const dst_match = dst?.match(/\br[0-9]\b/);
        dst_reg = dst_match ? dst_match[0] : null;
        if (insn_match.length > 1) {
            src = insn_match[1];
            const src_match = src?.match(/\br[0-9]\b/);
            src_reg = src_match ? src_match[0] : null;
        }
    }

    return {
        idx: parseInt(match[1], 10),
        hex: match[2],
        insn: {
            src: insn_match[1],
            dst: insn_match[0],
            src_reg: src_reg,
            dst_reg: dst_reg,
        },
        comment: match[4].trim(),
    };
}

export const parseBpfState = (prevBpfState: BpfState, rawLine: string): BpfState => {
    const regex = /[0-9]+:\s+.*\s+; (.*)/;
    const match = rawLine.match(regex);
    if (!match)
        return prevBpfState;
    let bpfState = copyBpfState(prevBpfState);
    const str = match[0];
    const exprs = str.split(' ');
    for (const expr of exprs) {
        const equalsIndex = expr.indexOf('=');
        if (equalsIndex === -1)
            continue;
        const kv = [expr.substring(0, equalsIndex), expr.substring(equalsIndex + 1)];
        let key = kv[0].trim().toLowerCase();
        let effect = Effect.NONE;
        if (!key)
            continue;
        if (key.endsWith('_w')) {
            key = key.substring(0, key.length - 2);
            effect = Effect.WRITE;
        }
        const value = makeValue(kv[1], effect);
        bpfState.values.set(key, value);
    };
    return bpfState;
}
