import {
  parseLine,
  parseBpfStateExprs,
  ParsedLineType,
  BpfJmpKind,
  BpfJmpCode,
  BpfInstruction,
  BpfAluInstruction,
  BpfInstructionKind,
  ParsedLine,
  BpfJmpInstruction,
  BpfTargetJmpInstruction,
  BpfAddressSpaceCastInstruction,
  InstructionLine,
  KnownMessageInfoType,
} from "./parser";

const AluInstructionSample = "0: (b7) r2 = 1                        ; R2_w=1";
const BPFStateExprSample = "; R2_w=1 R10=fp0 fp-24_w=1";
const MemoryWriteSample = "1: (7b) *(u64 *)(r10 -24) = r2" + BPFStateExprSample;
const CallInstructionSample = "7: (85) call bpf_probe_read_user#112";
const AddrSpaceCastSample1 =
  "2976: (bf) r1 = addr_space_cast(r7, 0, 1)     ; frame1: R1_w=arena";
const AddrSpaceCastSample2 = "75: (bf) r1 = addr_space_cast(r2, 0, 64)";
const ConditionalPseudoMayGotoSample = "2984: (e5) may_goto pc+3";
const ConditionalPseudoGotoOrNopSample = "2984: (e5) goto_or_nop pc+3";
const CSourceLineSample = "; n->key = 3; @ rbtree.c:201";
const CSourceLineEmptySample1 = "; @ foo.h:42";
const CSourceLineEmptySample2 = "; int i = 0; @ foo.h:0";

function expectBpfIns(line: ParsedLine): BpfInstruction {
  expect(line.type).toBe(ParsedLineType.INSTRUCTION);
  const insLine = <InstructionLine>line;
  return insLine.bpfIns;
}

function expectBpfAluIns(line: ParsedLine): BpfAluInstruction {
  const ins = expectBpfIns(line);
  expect(ins.kind).toBe(BpfInstructionKind.ALU);
  return <BpfAluInstruction>ins;
}

function expectBpfJmpIns(line: ParsedLine): BpfJmpInstruction {
  const ins = expectBpfIns(line);
  expect(ins.kind).toBe(BpfInstructionKind.JMP);
  return <BpfJmpInstruction>ins;
}

function expectBpfMayJmpInstruction(line: ParsedLine): BpfTargetJmpInstruction {
  const ins = expectBpfIns(line);
  expect(ins.kind).toBe(BpfInstructionKind.JMP);
  const jmpIns = <BpfJmpInstruction>ins;
  expect(jmpIns.jmpKind).toBe(BpfJmpKind.MAY_GOTO);
  return <BpfTargetJmpInstruction>ins;
}

function expectBpfJmpOrNopInstruction(
  line: ParsedLine,
): BpfTargetJmpInstruction {
  const ins = expectBpfIns(line);
  expect(ins.kind).toBe(BpfInstructionKind.JMP);
  const jmpIns = <BpfJmpInstruction>ins;
  expect(jmpIns.jmpKind).toBe(BpfJmpKind.GOTO_OR_NOP);
  return <BpfTargetJmpInstruction>ins;
}

function expectAddrSpaceCastIns(
  line: ParsedLine,
): BpfAddressSpaceCastInstruction {
  const ins = expectBpfIns(line);
  expect(ins.kind).toBe(BpfInstructionKind.ADDR_SPACE_CAST);
  return <BpfAddressSpaceCastInstruction>ins;
}

describe("parser", () => {
  it("parses ALU instructions with state expressions", () => {
    const parsed = parseLine(AluInstructionSample, 0);
    const ins: BpfAluInstruction = expectBpfAluIns(parsed);
    const bpfStateExprs = (<InstructionLine>parsed).bpfStateExprs;
    expect(ins?.pc).toBe(0);
    expect(ins?.operator).toBe("=");
    expect(ins?.writes).toContain("r2");
    expect(bpfStateExprs[0]).toMatchObject({
      id: "r2",
      value: "1",
    });
  });

  it("parses memory write instruction", () => {
    const parsed = parseLine(MemoryWriteSample, 0);
    const ins: BpfAluInstruction = expectBpfAluIns(parsed);
    const bpfStateExprs = (<InstructionLine>parsed).bpfStateExprs;
    expect(ins.pc).toBe(1);
    expect(ins.kind).toBe(BpfInstructionKind.ALU);
    expect(ins.dst.id).toBe("fp-24");
    expect(ins.src.id).toBe("r2");
    expect(bpfStateExprs.length).toBe(3);
  });

  it("parses call instruction", () => {
    const parsed = parseLine(CallInstructionSample, 7);
    let ins = expectBpfJmpIns(parsed);
    expect(ins.jmpKind).toBe(BpfJmpKind.HELPER_CALL);
    const targetIns = <BpfTargetJmpInstruction>ins;
    expect(targetIns.target).toBe("bpf_probe_read_user#112");
    expect(ins.reads).toContain("r1");
    expect(ins.writes).toContain("r0");
  });

  it("parses verifier state expressions", () => {
    const { exprs, rest } = parseBpfStateExprs(BPFStateExprSample);
    expect(rest).toBe("");
    expect(exprs.map((e) => e.id)).toEqual(["r2", "r10", "fp-24"]);
  });

  it("parses addr_space_cast", () => {
    let parsed = parseLine(AddrSpaceCastSample1, 13);
    let ins = expectAddrSpaceCastIns(parsed);
    expect(ins.dst.id).toBe("r1");
    expect(ins.src.id).toBe("r7");
    expect(ins.directionStr).toBe("0, 1");
    expect(ins.reads).toContain("r7");
    expect(ins.writes).toContain("r1");

    parsed = parseLine(AddrSpaceCastSample2, 13);
    ins = expectAddrSpaceCastIns(parsed);
    expect(ins.dst.id).toBe("r1");
    expect(ins.src.id).toBe("r2");
    expect(ins.directionStr).toBe("0, 64");
    expect(ins.reads).toContain("r2");
    expect(ins.writes).toContain("r1");
  });

  it("parses conditional pseudo may goto", () => {
    const parsed = parseLine(ConditionalPseudoMayGotoSample, 0);
    const ins = expectBpfMayJmpInstruction(parsed);
    expect(ins.target).toBe("pc+3");
    expect(ins.opcode.code).toBe(BpfJmpCode.JCOND);
  });

  it("parses conditional pseudo goto_or_nop", () => {
    const parsed = parseLine(ConditionalPseudoGotoOrNopSample, 0);
    const ins = expectBpfJmpOrNopInstruction(parsed);
    expect(ins.target).toBe("pc+3");
    expect(ins.opcode.code).toBe(BpfJmpCode.JCOND);
  });

  it("parses C source line matching RE_C_SOURCE_LINE regex", () => {
    const parsed = parseLine(CSourceLineSample, 5);
    expect(parsed).toEqual({
      type: ParsedLineType.C_SOURCE,
      idx: 5,
      raw: CSourceLineSample,
      content: "n->key = 3;",
      fileName: "rbtree.c",
      lineNum: 201,
      id: "rbtree.c:201",
      ignore: false,
    });
  });

  it("marks empty source lines", () => {
    expect(parseLine(CSourceLineEmptySample1, 13)).toEqual({
      type: ParsedLineType.C_SOURCE,
      idx: 13,
      raw: CSourceLineEmptySample1,
      content: "",
      fileName: "foo.h",
      lineNum: 42,
      id: "foo.h:42",
      ignore: true,
    });
    expect(parseLine(CSourceLineEmptySample2, 31)).toEqual({
      type: ParsedLineType.C_SOURCE,
      idx: 31,
      raw: CSourceLineEmptySample2,
      content: "int i = 0;",
      fileName: "foo.h",
      lineNum: 0,
      id: "foo.h:0",
      ignore: true,
    });
  });

  describe("Known message parsing", () => {
    const GlobalFuncValidSample =
      "Func#123 ('my_func') is global and assumed valid.";
    const NotAKnownMessage = "Some other verifier message that doesn't match";

    it("parses global function valid messages", () => {
      const parsed = parseLine(GlobalFuncValidSample, 10);
      expect(parsed).toMatchObject({
        type: ParsedLineType.KNOWN_MESSAGE,
        idx: 10,
        raw: GlobalFuncValidSample,
        info: {
          type: KnownMessageInfoType.GLOBAL_FUNC_VALID,
          funcId: 123,
          funcName: "my_func",
        },
      });
    });

    it("does not parse non-matching lines as known messages", () => {
      const parsed = parseLine(NotAKnownMessage, 5);
      expect(parsed.type).toBe(ParsedLineType.UNRECOGNIZED);
    });
  });
});
