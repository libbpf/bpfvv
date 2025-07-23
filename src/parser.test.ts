import {
  parseLine,
  parseBpfStateExprs,
  ParsedLineType,
  BpfJmpKind,
  BpfAluInstruction,
  BpfInstructionKind,
  ParsedLine,
  BpfJmpInstruction,
  BpfSubprogramCallInstruction,
} from "./parser";

const AluInstructionSample = "0: (b7) r2 = 1                        ; R2_w=1";
const BPFStateExprSample = "; R2_w=1 R10=fp0 fp-24_w=1";
const MemoryWriteSample = "1: (7b) *(u64 *)(r10 -24) = r2" + BPFStateExprSample;
const CallInstructionSample = "7: (85) call bpf_probe_read_user#112";

function expectBpfAluIns(line: ParsedLine): BpfAluInstruction {
  expect(line.type).toBe(ParsedLineType.INSTRUCTION);
  expect(line.bpfIns).toBeDefined();
  const ins = line.bpfIns!;
  expect(ins.kind).toBe(BpfInstructionKind.ALU);
  return <BpfAluInstruction>ins;
}

function expectBpfJmpIns(line: ParsedLine): BpfJmpInstruction {
  expect(line.type).toBe(ParsedLineType.INSTRUCTION);
  expect(line.bpfIns).toBeDefined();
  const ins = line.bpfIns!;
  expect(ins.kind).toBe(BpfInstructionKind.JMP);
  return <BpfJmpInstruction>ins;
}

describe("parser", () => {
  it("parses ALU instructions with state expressions", () => {
    const parsed = parseLine(AluInstructionSample, 0);
    const ins: BpfAluInstruction = expectBpfAluIns(parsed);
    expect(ins?.pc).toBe(0);
    expect(ins?.operator).toBe("=");
    expect(ins?.writes).toContain("r2");
    expect(parsed.bpfStateExprs?.[0]).toMatchObject({
      id: "r2",
      value: "1",
    });
  });

  it("parses memory write instruction", () => {
    const parsed = parseLine(MemoryWriteSample, 0);
    const ins: BpfAluInstruction = expectBpfAluIns(parsed);
    expect(ins.pc).toBe(1);
    expect(ins.kind).toBe(BpfInstructionKind.ALU);
    expect(ins.dst.id).toBe("fp-24");
    expect(ins.src.id).toBe("r2");
    expect(parsed.bpfStateExprs?.length).toBe(3);
  });

  it("parses call instruction via parseOpcodeIns", () => {
    const parsed = parseLine(CallInstructionSample, 7);
    let ins: BpfJmpInstruction = expectBpfJmpIns(parsed);
    expect(ins.jmpKind).toBe(BpfJmpKind.HELPER_CALL);
    ins = <BpfSubprogramCallInstruction>ins;
    expect(ins.target).toBe("bpf_probe_read_user#112");
    expect(ins.reads).toContain("r1");
    expect(ins.writes).toContain("r0");
  });

  it("parses verifier state expressions", () => {
    const { exprs, rest } = parseBpfStateExprs(BPFStateExprSample);
    expect(rest).toBe("");
    expect(exprs.map((e) => e.id)).toEqual(["r2", "r10", "fp-24"]);
  });
});
