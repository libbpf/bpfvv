/*
    This is sort of a LR parser for the BPF verifier log, except that we match substrings and use regexps.
    Similarity to LR parser is in that we consume a piece of the input string from left to right while building the internal representation.
    A couple of reasons for this approach:
        - We can't and shouldn't treat verifier log as a formal language
        - Most (if not all) meaningful "expressions" can easily be represented with a regex
        - This is just a prototype at this point, so ad-hoc implementation is fine
 */

enum BpfInstructionClass {
    LD = 0x0,
    LDX = 0x1,
    ST = 0x2,
    STX = 0x3,
    ALU = 0x4,
    JMP = 0x5,
    JMP32 = 0x6,
    ALU64 = 0x7,
}

enum BpfAluCode {
    ADD = 0x0,
    SUB = 0x1,
    MUL = 0x2,
    DIV = 0x3,
    OR = 0x4,
    AND = 0x5,
    LSH = 0x6,
    RSH = 0x7,
    NEG = 0x8,
    MOD = 0x9,
    XOR = 0xa,
    MOV = 0xb,
    ARSH = 0xc,
    END = 0xd,
}

enum OpcodeSource {
    K = 'K', // use 32-bit ‘imm’ value as source operand
    X = 'X', // use ‘src_reg’ register value as source operand
}

type BpfOpcode = {
    iclass: BpfInstructionClass;
    code: BpfAluCode;
    source: OpcodeSource;
}

type BpfInstruction = {
    pc?: number;
    opcode: BpfOpcode;
    operator: string;
    dst: BpfOperand;
    src: BpfOperand;
    reads: string[];
    writes: string[];
}

enum OperandType {
    UNKNOWN = 'UNKNOWN',
    REG = 'REG',
    MEM = 'MEM',
    IMM = 'IMM',
}

type BpfOperand = {
    type: OperandType;
    id: string; // r0-r10 for regs, 'fp-off' for stack, unique id for mem refs
    size: number;
    memref?: {
        address_reg: string;
        offset: number;
    };
}

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

export enum ParsedLineType {
    UNRECOGNIZED = "UNRECOGNIZED",
    INSTRUCTION = "INSTRUCTION",
}

export type ParsedLine = {
    idx?: number;
    type: ParsedLineType;
    raw: string;
    insnLine?: ParsedInsnLine;
    bpfState?: BpfState;
    bpfIns?: BpfInstruction;
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

const RE_WHITESPACE = /\s+/;
const RE_PROGRAM_COUNTER = /^([0-9]+):/;
const RE_BPF_OPCODE = /^\(([0-9a-f][0-9a-f])\)/;
const RE_REGISTER = /^(r10|r[0-9]|w[0-9])/;
const RE_MEMORY_REF = /^\*\((u8|u16|u32|u64) \*\)\((r10|r[0-9]) ([+-][0-9]+)\)/;
const RE_IMM_VALUE = /^(0x[0-9a-f]+|[+-]?[0-9]+)/;
const BPF_OPERATORS = [ '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', 's>>=', 's<<='];

const consumeRegex = (regex: RegExp, str: string): { match: string[], rest: string } => {
    const match = regex.exec(str);
    const rest = match ? str.substring(match[0].length) : str;
    return { match, rest };
}

const consumeString = (toMatch: string, str: string): { match: boolean, rest: string } => {
    const match = str.startsWith(toMatch);
    const rest = match ? str.substring(toMatch.length) : str;
    return { match, rest };
}

const consumeSpaces = (str: string): string => {
    const match = str.match(RE_WHITESPACE);
    return match ? str.substring(match[0].length) : str;
}

const parseOpcodeHex = (opcodeHex: string): BpfOpcode => {
    const code = parseInt(opcodeHex[0], 16);
    const sclass = parseInt(opcodeHex[1], 16);
    const iclass = sclass & 0x7;
    const source = (sclass >> 3) === 1 ? OpcodeSource.X : OpcodeSource.K;
    return { code, iclass, source };
}

let MEMORY_REF_COUNTER = 0;

const CAST_TO_SIZE = new Map<string, number>([
    ['u8', 1],
    ['u16', 2],
    ['u32', 4],
    ['u64', 8],
]);

const registerOp = (reg: string): BpfOperand => {
    let size = 8;
    if (reg.startsWith('w')) {
        size = 4;
        reg = 'r' + reg.substring(1);
    }
    return { id: reg, type: OperandType.REG, size };
}

const immOp = (imm: string, size: number = -1): BpfOperand => {
    if (size === -1) {
        size = 8;
    }
    return { id: 'IMM', type: OperandType.IMM, size };
}

const parseMemoryRef = (str: string): { op: BpfOperand, rest: string } => {
    const { match, rest } = consumeRegex(RE_MEMORY_REF, str);
    if (!match)
        return { op: null, rest };
    const size = CAST_TO_SIZE.get(match[1]);
    const address_reg = match[2];
    const offset = parseInt(match[3], 10);
    let id;
    if (address_reg === 'r10') {
        id = 'fp' + offset;
    } else {
        const plus = offset < 0 ? '' : '+';
        id = address_reg + plus + offset + '/' + MEMORY_REF_COUNTER++; // example: 'r1+16/133'
    }
    const op = { id, type: OperandType.MEM, size, memref: { address_reg, offset } };
    return { op, rest };
}

const parseAluDst = (str: string): { op: BpfOperand, rest: string } => {
    let { match, rest } = consumeRegex(RE_REGISTER, str);
    if (match)
        return { op: registerOp(match[1]), rest };

    let memref = parseMemoryRef(rest);
    if (memref.op)
        return memref;

    return { op: null, rest };
}

const parseAluSrc = (str: string): { op: BpfOperand, rest: string } => {
    let { match, rest } = consumeRegex(RE_REGISTER, str);
    if (match)
        return { op: registerOp(match[1]), rest };
    let memref = parseMemoryRef(rest);
    if (memref.op)
        return memref;
    let imm = consumeRegex(RE_IMM_VALUE, str);
    if (imm.match)
        return { op: immOp(imm.match[1]), rest: imm.rest };
    return { op: null, rest };
}

const collectReads = (operator: string, dst: BpfOperand, src: BpfOperand): string[] => {
    const reads = [];
    if (operator !== '=')
        reads.push(dst.id);
    if (src.type === OperandType.MEM)
        reads.push(src.memref.address_reg);
    if (dst.type === OperandType.MEM)
        reads.push(dst.memref.address_reg);
    // do not add src to reads if it's a store from immediate value
    if (src.type !== OperandType.IMM)
        reads.push(src.id);
    return reads;
}

const parseAluInstruction = (str: string, opcode: BpfOpcode): { ins: BpfInstruction, rest: string } => {
    let dst : BpfOperand;
    let src : BpfOperand;
    let rest : string;

    let _dst = parseAluDst(str);
    dst = _dst.op;
    rest = _dst.rest;
    if (!dst)
        return { ins: null, rest: str };

    rest = consumeSpaces(rest);
    let operator = null;
    for (const op of BPF_OPERATORS) {
        const m = consumeString(op, rest);
        if (m.match) {
            operator = op;
            rest = consumeSpaces(m.rest);
            break;
        }
    }
    if (!operator)
        return { ins: null, rest: str };

    let _src = parseAluSrc(rest);
    src = _src.op;
    rest = _src.rest;
    if (!src)
        return { ins: null, rest: str };
    rest = consumeSpaces(rest);

    const ins : BpfInstruction = {
        opcode: opcode,
        dst: dst,
        src: src,
        operator: operator,
        reads: collectReads(operator, dst, src),
        writes: [dst.id],
    };

    return { ins, rest };
}

const parseInstruction = (str: string, opcode: BpfOpcode): { ins: BpfInstruction, rest: string } => {
    switch (opcode.iclass) {
        case BpfInstructionClass.LD:
        case BpfInstructionClass.LDX:
        case BpfInstructionClass.ST:
        case BpfInstructionClass.STX:
        case BpfInstructionClass.ALU:
        case BpfInstructionClass.ALU64:
            return parseAluInstruction(str, opcode);
        case BpfInstructionClass.JMP:
        case BpfInstructionClass.JMP32:
        default:
            return { ins: null, rest: str };
    }
}

export const parseOpcodeIns = (str: string, pc: number): { ins: BpfInstruction, rest: string } => {
    const { match, rest } = consumeRegex(RE_BPF_OPCODE, str);
    if (match) {
        const opcode = parseOpcodeHex(match[1]);
        if (opcode) {
            const parsed = parseInstruction(consumeSpaces(rest), opcode);
            if (parsed.ins)
                parsed.ins.pc = pc;
            return parsed;
        }
    }
    return { ins: null, rest: str };
}

export const parseLine = (rawLine: string): ParsedLine => {
    const { match, rest } = consumeRegex(RE_PROGRAM_COUNTER, rawLine);
    if (match) {
        const pc = parseInt(match[1], 10);
        const parsed = parseOpcodeIns(consumeSpaces(rest), pc);
        if (parsed.ins) {
            return {
                type: ParsedLineType.INSTRUCTION,
                raw: rawLine,
                bpfIns: parsed.ins,
            };
        }
    }

    return {
        type: ParsedLineType.UNRECOGNIZED,
        raw: rawLine,
    }
}
