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


export enum ParsedLineType {
    UNRECOGNIZED = "UNRECOGNIZED",
    INSTRUCTION = "INSTRUCTION",
}

export type ParsedLine = {
    idx?: number;
    type: ParsedLineType;
    raw: string;
    bpfIns?: BpfInstruction;
    bpfStateExprs?: BpfStateExpr[];
}

type BpfStateExpr = {
    id: string;
    value: string;
    rawKey: string;
}

const parseBpfStateExpr = (str: string): { expr: BpfStateExpr, rest: string } => {
    const equalsIndex = str.indexOf('=');
    if (equalsIndex === -1)
        return { expr: null, rest: str };
    const key = str.substring(0, equalsIndex);
    let id = key;
    if (key.endsWith('_w'))
        id = key.substring(0, key.length - 2);
    id = id.toLowerCase();

    // the next value starts after a space outside of any parentheses
    let i = equalsIndex + 1;
    let stack = [];
    while (i < str.length) {
        if (str[i] === '(') {
            stack.push(str[i]);
        } if (str[i] === ')' && stack.length > 0) {
            stack.pop();
        } else if (str[i] === ' ' && stack.length === 0) {
            break;
        }
        i++;
    }
    const expr = {
        id,
        value: str.substring(equalsIndex + 1, i),
        rawKey: key,
    }
    return { expr, rest: str.substring(i) };
}

export const parseBpfStateExprs = (str: string): { exprs: BpfStateExpr[], rest: string } => {
    let { match, rest } = consumeString('; ', str);
    if (!match)
        return { exprs: [], rest: str };

    let exprs = [];
    while (rest.length > 0) {
        const parsed = parseBpfStateExpr(rest);
        rest = consumeSpaces(parsed.rest);
        if (!parsed.expr)
            break;
        exprs.push(parsed.expr);
    }
    return { exprs, rest };
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
            let parsedIns = parseInstruction(consumeSpaces(rest), opcode);
            if (parsedIns.ins) {
                parsedIns.ins.pc = pc;
            }
            return parsedIns;
        }
    }
    return { ins: null, rest: str };
}

export const parseLine = (rawLine: string): ParsedLine => {
    let { match, rest } = consumeRegex(RE_PROGRAM_COUNTER, rawLine);
    let ins : BpfInstruction = null;
    if (match) {
        const pc = parseInt(match[1], 10);
        const parsedIns = parseOpcodeIns(consumeSpaces(rest), pc);
        if (parsedIns.ins) {
            ins = parsedIns.ins;
        }
        rest = parsedIns.rest;
    }

    if (ins) {
            let exprs : BpfStateExpr[] = [];
            const parsedExprs = parseBpfStateExprs(rest);
            if (parsedExprs.exprs) {
                exprs = parsedExprs.exprs;
            }
            return {
            type: ParsedLineType.INSTRUCTION,
            raw: rawLine,
            bpfIns: ins,
            bpfStateExprs: exprs,
        };
    }

    return {
        type: ParsedLineType.UNRECOGNIZED,
        raw: rawLine,
    };
}
