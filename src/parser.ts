/*
    The job of the parser is to take a string from a verifier log, and produce a ParsedLine.
    ParsedLine object includes read/write information, however it is limited to a specific isolated instruction.
    No relationships between instructions are taken into account in the parser, therefore the interface to the parser
    is parseLine(str: string, idx: number): ParsedLine

    This is sort of a LR parser for the BPF verifier log, except that we match substrings and use regexps.
    Similarity to LR parser is in that we consume a piece of the input string from left to right while building the internal representation.
    A couple of reasons for this approach:
        - We can't and shouldn't treat verifier log as a formal language
        - Most (if not all) meaningful "expressions" can easily be represented with a regex
        - It is feasible to modify verifier log upstream to make it more friendly to parsing, but even then we want to be able to parse older formats
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

export enum BpfJmpCode {
  JA = 0x0,
  JEQ = 0x1,
  JGT = 0x2,
  JGE = 0x3,
  JSET = 0x5,
  JSGT = 0x6,
  JSGE = 0x7,
  CALL = 0x8,
  EXIT = 0x9,
  JLT = 0xa,
  JLE = 0xb,
  JSLT = 0xc,
  JSLE = 0xd,
}

export enum Effect {
  NONE = "NONE",
  READ = "READ",
  WRITE = "WRITE",
  UPDATE = "UPDATE", // read then write, e.g. r0 += 1
}

enum OpcodeSource {
  K = "K", // use 32-bit ‘imm’ value as source operand
  X = "X", // use ‘src_reg’ register value as source operand
}

type BpfOpcode = {
  iclass: BpfInstructionClass;
  code: BpfAluCode | BpfJmpCode;
  source: OpcodeSource;
};

export type RawLineLocation = {
  offset: number; // negative: -10 means length-10
  size: number;
};

export enum BpfJmpKind {
  EXIT = 1,
  UNCONDITIONAL_GOTO = 2,
  CONDITIONAL_GOTO = 3,
  HELPER_CALL = 4,
  SUBPROGRAM_CALL = 5,
}

export enum BpfInstructionKind {
  ALU = "ALU",
  JMP = "JMP",
}

type GenericBpfInstruction = {
  pc?: number;
  opcode: BpfOpcode;
  reads: string[];
  writes: string[];
  location?: RawLineLocation;
};

type GenericJmpInstruction = {
  kind: BpfInstructionKind.JMP;
} & GenericBpfInstruction;

export type BpfExitInstruction = {
  jmpKind: BpfJmpKind.EXIT;
} & GenericJmpInstruction;

export type BpfUnconditionalJmpInstruction = {
  jmpKind: BpfJmpKind.UNCONDITIONAL_GOTO;
  target: string;
} & GenericJmpInstruction;

export type BpfConditionalJmpInstruction = {
  jmpKind: BpfJmpKind.CONDITIONAL_GOTO;
  target: string;
  cond: {
    left: BpfOperand;
    op: string;
    right: BpfOperand;
  };
} & GenericJmpInstruction;

export type BpfHelperCallInstruction = {
  jmpKind: BpfJmpKind.HELPER_CALL;
  target: string;
} & GenericJmpInstruction;

export type BpfSubprogramCallInstruction = {
  jmpKind: BpfJmpKind.SUBPROGRAM_CALL;
  target: string;
} & GenericJmpInstruction;

export type BpfJmpInstruction =
  | BpfExitInstruction
  | BpfHelperCallInstruction
  | BpfSubprogramCallInstruction
  | BpfConditionalJmpInstruction
  | BpfUnconditionalJmpInstruction;

export type BpfAluInstruction = {
  kind: BpfInstructionKind.ALU;
  operator: string;
  dst: BpfOperand;
  src: BpfOperand;
} & GenericBpfInstruction;

export type BpfInstruction = BpfJmpInstruction | BpfAluInstruction;

export enum OperandType {
  UNKNOWN = "UNKNOWN",
  REG = "REG",
  FP = "FP",
  IMM = "IMM",
  MEM = "MEM",
}

export type BpfOperand = {
  type: OperandType;
  id: string; // r0-r10 for regs, 'fp-off' for stack
  size: number;
  memref?: {
    address_reg: string;
    offset: number;
  };
  location?: RawLineLocation;
};

type BpfOperandPair = [BpfOperand | undefined, string];

type BpfInstructionPair = {
  ins: BpfInstruction | undefined;
  rest: string;
};

export enum ParsedLineType {
  UNRECOGNIZED = "UNRECOGNIZED",
  INSTRUCTION = "INSTRUCTION",
}

export type ParsedLine = {
  idx: number;
  type: ParsedLineType;
  raw: string;
  bpfIns?: BpfInstruction;
  bpfStateExprs?: BpfStateExpr[];
};

type BpfStateExpr = {
  id: string;
  value: string;
  rawKey: string;
  frame?: number;
};

export const BPF_SCRATCH_REGS = ["r1", "r2", "r3", "r4", "r5"];
export const BPF_CALLEE_SAVED_REGS = ["r6", "r7", "r8", "r9"];

const parseBpfStateExpr = (
  str: string,
): { expr: BpfStateExpr; rest: string } | undefined => {
  const equalsIndex = str.indexOf("=");
  if (equalsIndex === -1) return undefined;
  const key = str.substring(0, equalsIndex);
  let id = key;
  if (key.endsWith("_w")) id = key.substring(0, key.length - 2);
  id = id.toLowerCase();

  // the next value starts after a space outside of any parentheses
  let i = equalsIndex + 1;
  let stack = [];
  while (i < str.length) {
    if (str[i] === "(") {
      stack.push(str[i]);
    }
    if (str[i] === ")" && stack.length > 0) {
      stack.pop();
    } else if (str[i] === " " && stack.length === 0) {
      break;
    }
    i++;
  }
  const expr = {
    id,
    value: str.substring(equalsIndex + 1, i),
    rawKey: key,
  };
  return { expr, rest: str.substring(i) };
};

export const parseBpfStateExprs = (
  str: string,
): { exprs: BpfStateExpr[]; rest: string } => {
  let { match, rest } = consumeString("; ", str);
  if (!match) return { exprs: [], rest: str };

  let frame = consumeRegex(RE_FRAME_ID, rest);
  let frameId = 0;
  if (frame.match) {
    frameId = parseInt(frame.match[1], 10);
    rest = frame.rest;
  }

  let exprs = [];
  while (rest.length > 0) {
    const parsed = parseBpfStateExpr(rest);
    if (!parsed) break;
    rest = consumeSpaces(parsed.rest);
    parsed.expr.frame = frameId;
    exprs.push(parsed.expr);
  }
  return { exprs, rest };
};

const RE_WHITESPACE = /^\s+/;
const RE_PROGRAM_COUNTER = /^([0-9]+):/;
const RE_BPF_OPCODE = /^\(([0-9a-f][0-9a-f])\)/;
const RE_REGISTER = /^(r10|r[0-9]|w[0-9])/;
const RE_MEMORY_REF = /^\*\((u8|u16|u32|u64) \*\)\((r10|r[0-9]) ([+-][0-9]+)\)/;
const RE_IMM_VALUE = /^(0x[0-9a-f]+|[+-]?[0-9]+)/;
const RE_CALL_TARGET = /^call ([0-9a-z_#+-]+)/;
const RE_JMP_TARGET = /^goto (pc[+-][0-9]+)/;
const RE_FRAME_ID = /^frame([0-9]+): /;

const BPF_ALU_OPERATORS = [
  "s>>=",
  "s<<=",
  "<<=",
  ">>=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "=",
];
const BPF_COND_OPERATORS = [
  "s>=",
  "s<=",
  "==",
  "!=",
  "<=",
  ">=",
  "s<",
  "s>",
  "<",
  ">",
];

const consumeRegex = (
  regex: RegExp,
  str: string,
): { match: string[] | null; rest: string } => {
  const match = regex.exec(str);
  const rest = match ? str.substring(match[0].length) : str;
  return { match, rest };
};

const consumeString = (
  toMatch: string,
  str: string,
): { match: boolean; rest: string } => {
  const match = str.startsWith(toMatch);
  const rest = match ? str.substring(toMatch.length) : str;
  return { match, rest };
};

const consumeSpaces = (str: string): string => {
  const match = str.match(RE_WHITESPACE);
  return match ? str.substring(match[0].length) : str;
};

const parseOpcodeHex = (opcodeHex: string): BpfOpcode => {
  const code = parseInt(opcodeHex[0], 16);
  const sclass = parseInt(opcodeHex[1], 16);
  const iclass = sclass & 0x7;
  const source = sclass >> 3 === 1 ? OpcodeSource.X : OpcodeSource.K;
  return { code, iclass, source };
};

const CAST_TO_SIZE = new Map<string, number>([
  ["u8", 1],
  ["u16", 2],
  ["u32", 4],
  ["u64", 8],
]);

const registerOp = (reg: string): BpfOperand => {
  let size = 8;
  if (reg.startsWith("w")) {
    size = 4;
    reg = "r" + reg.substring(1);
  }
  return { id: reg, type: OperandType.REG, size };
};

const immOp = (imm: string, size = -1): BpfOperand => {
  if (size === -1) {
    size = 8;
  }
  return { id: "IMM", type: OperandType.IMM, size };
};

const parseMemoryRef = (str: string): BpfOperandPair => {
  const { match, rest } = consumeRegex(RE_MEMORY_REF, str);
  if (!match) return [undefined, rest];
  const size = CAST_TO_SIZE.get(match[1]) || 0;
  const address_reg = match[2];
  const offset = parseInt(match[3], 10);
  // We do not currently use memory ids, and they blow up the lastKnownWrites map in the app
  // So let's use a dummy id for now, like for immediates
  let id = "MEM";
  let type = OperandType.MEM;
  if (address_reg === "r10") {
    id = "fp" + offset;
    type = OperandType.FP;
  }
  const op = { id, type, size, memref: { address_reg, offset } };
  return [op, rest];
};

const parseAluDst = (str: string): BpfOperandPair => {
  let { match, rest } = consumeRegex(RE_REGISTER, str);
  if (match) return [registerOp(match[1]), rest];

  let memref = parseMemoryRef(rest);
  if (memref[0]) return memref;

  return [undefined, rest];
};

const parseAluSrc = (str: string): BpfOperandPair => {
  let { match, rest } = consumeRegex(RE_REGISTER, str);
  if (match) return [registerOp(match[1]), rest];
  let memref = parseMemoryRef(rest);
  if (memref[0]) return memref;
  let imm = consumeRegex(RE_IMM_VALUE, str);
  if (imm.match) return [immOp(imm.match[1]), imm.rest];
  return [undefined, rest];
};

const collectReads = (
  operator: string,
  dst: BpfOperand,
  src: BpfOperand,
): string[] => {
  const reads = [];
  if (operator !== "=") reads.push(dst.id);
  if (src.type === OperandType.MEM && src.memref)
    reads.push(src.memref.address_reg);
  if (dst.type === OperandType.MEM && dst.memref)
    reads.push(dst.memref.address_reg);
  // do not add src to reads if it's a store from immediate value
  if (src.type !== OperandType.IMM) reads.push(src.id);
  return reads;
};

const parseAluInstruction = (
  str: string,
  opcode: BpfOpcode,
): BpfInstructionPair => {
  let dst;
  let src;
  let rest: string;

  let _dst = parseAluDst(str);
  dst = _dst[0];
  if (!dst) return { ins: undefined, rest: str };
  dst.location = {
    offset: -str.length,
    size: str.length - _dst[1].length,
  };
  rest = consumeSpaces(_dst[1]);

  let operator = null;
  for (const op of BPF_ALU_OPERATORS) {
    const m = consumeString(op, rest);
    if (m.match) {
      operator = op;
      rest = consumeSpaces(m.rest);
      break;
    }
  }
  if (!operator) return { ins: undefined, rest: str };

  let _src = parseAluSrc(rest);
  src = _src[0];
  if (!src) return { ins: undefined, rest: str };
  src.location = {
    offset: -rest.length,
    size: rest.length - _src[1].length,
  };
  rest = consumeSpaces(_src[1]);

  const ins: BpfAluInstruction = {
    kind: BpfInstructionKind.ALU,
    opcode: opcode,
    operator: operator,
    dst: dst,
    src: src,
    reads: collectReads(operator, dst, src),
    writes: [dst.id],
  };

  return { ins, rest };
};

const helperCall = (
  opcode: BpfOpcode,
  target: string,
): BpfHelperCallInstruction => {
  return {
    kind: BpfInstructionKind.JMP,
    opcode: opcode,
    target: target,
    jmpKind: BpfJmpKind.HELPER_CALL,
    reads: BPF_SCRATCH_REGS,
    writes: ["r0", ...BPF_SCRATCH_REGS],
  };
};

const bpfSubprogramCall = (
  opcode: BpfOpcode,
  target: string,
): BpfSubprogramCallInstruction => {
  return {
    kind: BpfInstructionKind.JMP,
    jmpKind: BpfJmpKind.SUBPROGRAM_CALL,
    opcode: opcode,
    target: target,
    reads: BPF_SCRATCH_REGS,
    writes: ["r0", ...BPF_CALLEE_SAVED_REGS],
  };
};

const parseCall = (str: string, opcode: BpfOpcode): BpfInstructionPair => {
  const { match, rest } = consumeRegex(RE_CALL_TARGET, str);
  if (!match) return { ins: undefined, rest: str };
  const target = match[1];

  let ins: BpfJmpInstruction;
  // TODO: is this heuristic good enough?
  if (target.startsWith("pc+") || target.startsWith("pc-")) {
    ins = bpfSubprogramCall(opcode, target);
  } else {
    ins = helperCall(opcode, target);
  }

  ins.location = {
    offset: -str.length,
    size: match[0].length,
  };
  return { ins, rest };
};

const parseCondOp = (
  str: string,
): { op: BpfOperand | undefined; rest: string } => {
  let { match, rest } = consumeRegex(RE_REGISTER, str);
  if (match) return { op: registerOp(match[1]), rest };
  let imm = consumeRegex(RE_IMM_VALUE, str);
  if (imm.match) return { op: immOp(imm.match[1]), rest: imm.rest };
  return { op: undefined, rest };
};

const parseConditionalJmp = (
  str: string,
  opcode: BpfOpcode,
): BpfInstructionPair => {
  let { match, rest } = consumeString("if ", str);
  if (!match) return { ins: undefined, rest: str };

  let leftOp = parseCondOp(rest);
  if (!leftOp.op) return { ins: undefined, rest: str };
  leftOp.op.location = {
    offset: -rest.length,
    size: rest.length - leftOp.rest.length,
  };
  rest = consumeSpaces(leftOp.rest);

  let operator = null;
  for (const op of BPF_COND_OPERATORS) {
    const m = consumeString(op, rest);
    if (m.match) {
      operator = op;
      rest = consumeSpaces(m.rest);
      break;
    }
  }
  if (!operator) return { ins: undefined, rest: str };

  let rightOp = parseCondOp(rest);
  if (!rightOp.op) return { ins: undefined, rest: str };
  rightOp.op.location = {
    offset: -rest.length,
    size: rest.length - rightOp.rest.length,
  };
  rest = consumeSpaces(rightOp.rest);

  let jmpTarget = consumeRegex(RE_JMP_TARGET, consumeSpaces(rest));
  if (!jmpTarget.match) return { ins: undefined, rest: str };
  const target = jmpTarget.match[1];
  rest = consumeSpaces(jmpTarget.rest);

  const ins: BpfConditionalJmpInstruction = {
    kind: BpfInstructionKind.JMP,
    jmpKind: BpfJmpKind.CONDITIONAL_GOTO,
    opcode: opcode,
    target: target,
    cond: {
      left: leftOp.op,
      op: operator,
      right: rightOp.op,
    },
    reads: [leftOp.op.id, rightOp.op.id],
    writes: [], // technically goto writes pc, but we don't care about it (?)
  };
  return { ins, rest };
};

const parseUnconditionalJmp = (
  str: string,
  opcode: BpfOpcode,
): BpfInstructionPair => {
  let { match, rest } = consumeString("goto ", str);
  if (!match) return { ins: undefined, rest: str };
  const target = consumeRegex(RE_JMP_TARGET, str);
  if (!target.match) return { ins: undefined, rest: str };
  const ins: BpfUnconditionalJmpInstruction = {
    kind: BpfInstructionKind.JMP,
    jmpKind: BpfJmpKind.UNCONDITIONAL_GOTO,
    opcode: opcode,
    target: target.match[1],
    reads: [],
    writes: [],
  };
  return { ins, rest };
};

const parseExit = (str: string, opcode: BpfOpcode): BpfInstructionPair => {
  const match = consumeString("exit", str);
  if (!match) return { ins: undefined, rest: str };
  const ins: BpfExitInstruction = {
    kind: BpfInstructionKind.JMP,
    jmpKind: BpfJmpKind.EXIT,
    opcode,
    reads: [],
    // exit (return) writes all regs because
    // r0 is set to return value
    // r1-r5 are considered scratched by the caller
    // r6-r9 are callee saved, and so will be restored by the caller
    writes: ["r0", ...BPF_SCRATCH_REGS, ...BPF_CALLEE_SAVED_REGS],
  };
  return { ins, rest: match.rest };
};

const parseJmpInstruction = (
  str: string,
  opcode: BpfOpcode,
): BpfInstructionPair => {
  switch (opcode.code) {
    case BpfJmpCode.CALL:
      return parseCall(str, opcode);
    case BpfJmpCode.JEQ:
    case BpfJmpCode.JGT:
    case BpfJmpCode.JGE:
    case BpfJmpCode.JSET:
    case BpfJmpCode.JSGT:
    case BpfJmpCode.JSGE:
    case BpfJmpCode.JLT:
    case BpfJmpCode.JLE:
    case BpfJmpCode.JSLT:
    case BpfJmpCode.JSLE:
      return parseConditionalJmp(str, opcode);
    case BpfJmpCode.JA:
      return parseUnconditionalJmp(str, opcode);
    case BpfJmpCode.EXIT:
      return parseExit(str, opcode);
    default:
      return { ins: undefined, rest: str };
  }
};

const parseInstruction = (
  str: string,
  opcode: BpfOpcode,
): BpfInstructionPair => {
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
      return parseJmpInstruction(str, opcode);
    default:
      return { ins: undefined, rest: str };
  }
};

export const parseOpcodeIns = (str: string, pc: number): BpfInstructionPair => {
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
  return { ins: undefined, rest: str };
};

export const parseLine = (rawLine: string, idx: number): ParsedLine => {
  let { match, rest } = consumeRegex(
    RE_PROGRAM_COUNTER,
    consumeSpaces(rawLine),
  );
  let ins = undefined;
  if (match) {
    const pc = parseInt(match[1], 10);
    const parsedIns = parseOpcodeIns(consumeSpaces(rest), pc);
    if (parsedIns.ins) {
      ins = parsedIns.ins;
    }
    rest = consumeSpaces(parsedIns.rest);
  }

  if (ins) {
    let exprs: BpfStateExpr[] = [];
    const parsedExprs = parseBpfStateExprs(rest);
    if (parsedExprs.exprs) {
      exprs = parsedExprs.exprs;
    }
    return {
      idx,
      type: ParsedLineType.INSTRUCTION,
      raw: rawLine,
      bpfIns: ins,
      bpfStateExprs: exprs,
    };
  }

  return {
    idx,
    type: ParsedLineType.UNRECOGNIZED,
    raw: rawLine,
  };
};
