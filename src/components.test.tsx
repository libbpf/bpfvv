/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { JmpInstruction, MemSlot } from "./components";
import {
  BpfJmpKind,
  BpfInstructionClass,
  BpfInstructionKind,
  BpfJmpCode,
  BpfOperand,
  OperandType,
  OpcodeSource,
  ParsedLine,
  ParsedLineType,
  BpfTargetJmpInstruction,
  BpfConditionalJmpInstruction,
  BpfJmpInstruction,
  BpfExitInstruction,
  BpfGotoJmpInstruction,
  parseLine,
  InstructionLine,
} from "./parser";

function createOp(
  type: OperandType,
  size: number,
  offset: number,
  id = "",
): BpfOperand {
  return {
    type,
    id,
    location: {
      offset,
      size,
    },
    size: 0, // unused for MemSlot
  };
}

describe("MemSlot", () => {
  function createParsedLine(raw: string, idx: number): ParsedLine {
    return parseLine(raw, idx);
  }

  it("renders raw line when op is undefined", () => {
    const line = createParsedLine("test raw line", 0);
    render(<MemSlot line={line} op={undefined} />);
    expect(screen.getByText("test raw line")).toBeInTheDocument();
  });

  it("renders the sliced memslot string when op is UNKNOWN", () => {
    const line = createParsedLine("test raw line", 0);
    render(<MemSlot line={line} op={createOp(OperandType.UNKNOWN, 10, -5)} />);
    // screen.debug()
    expect(screen.getByText("line")).toBeInTheDocument();
  });

  it("renders the sliced memslot string when op is IMM", () => {
    const line = createParsedLine("test raw line", 0);
    render(<MemSlot line={line} op={createOp(OperandType.IMM, 10, -7)} />);
    expect(screen.getByText("aw line")).toBeInTheDocument();
  });

  it("renders a RegSpan when op is REG", () => {
    const line = createParsedLine(
      "5: (b7) r7 = 1                        ; R7_w=1 refs=2",
      0,
    );
    render(
      <MemSlot line={line} op={createOp(OperandType.REG, 2, -45, "r7")} />,
    );
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      '<span id="mem-slot-r7-line-0" class="mem-slot r7" data-id="r7">r7</span>',
    );
  });

  it("renders a RegSpan when op is FP", () => {
    const line = createParsedLine(
      "1768: (79) r1 = *(u64 *)(r10 -8)      ; frame2: R1_w=scalar(umax=511,var_off=(0x0; 0x1ff)) R10=fp0",
      0,
    );
    render(
      <MemSlot line={line} op={createOp(OperandType.FP, 16, -82, "fp-8")} />,
    );
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      '<span id="mem-slot-fp-8-line-0" class="mem-slot fp-8" data-id="fp-8">*(u64 *)(r10 -8)</span>',
    );
  });

  it("renders a RegSpan and mem slot strings when op is MEM", () => {
    const line = createParsedLine(
      "1609: (61) r2 = *(u32 *)(r2 +0)       ; frame1: R2_w=0",
      0,
    );
    const op = createOp(OperandType.MEM, 15, -38, "MEM");
    op.memref = {
      address_reg: "r2",
      offset: 0,
    };
    render(<MemSlot line={line} op={op} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      '*(u32 *)(<span id="mem-slot-r2-line-0" class="mem-slot r2" data-id="r2">r2</span> +0)',
    );
  });
});

describe("JmpInstruction", () => {
  function createTargetJmpIns(
    jmpCode: BpfJmpCode,
    jmpKind: BpfJmpKind.HELPER_CALL | BpfJmpKind.SUBPROGRAM_CALL,
  ): BpfTargetJmpInstruction {
    return {
      kind: BpfInstructionKind.JMP,
      jmpKind,
      opcode: {
        iclass: BpfInstructionClass.JMP,
        code: jmpCode,
        source: OpcodeSource.K,
      },
      target: "pc+3",
      reads: [],
      writes: [],
    };
  }

  function createGotoJmpIns(
    goto: string,
    jmpCode: BpfJmpCode,
    jmpKind:
      | BpfJmpKind.MAY_GOTO
      | BpfJmpKind.GOTO_OR_NOP
      | BpfJmpKind.UNCONDITIONAL_GOTO,
  ): BpfGotoJmpInstruction {
    return {
      kind: BpfInstructionKind.JMP,
      goto,
      jmpKind,
      opcode: {
        iclass: BpfInstructionClass.JMP,
        code: jmpCode,
        source: OpcodeSource.K,
      },
      target: "pc+3",
      reads: [],
      writes: [],
    };
  }

  function createLine(bpfIns: BpfJmpInstruction): InstructionLine {
    return {
      raw: "",
      idx: 0,
      bpfIns,
      bpfStateExprs: [],
      type: ParsedLineType.INSTRUCTION,
    };
  }

  it("renders an exit", () => {
    const ins: BpfExitInstruction = {
      kind: BpfInstructionKind.JMP,
      jmpKind: BpfJmpKind.EXIT,
      opcode: {
        iclass: BpfInstructionClass.JMP,
        code: BpfJmpCode.JEQ,
        source: OpcodeSource.K,
      },
      reads: [],
      writes: [],
    };
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("<b>} exit ; return to stack frame 1</b>");
  });

  it("renders a subprogram and target", () => {
    const ins = createTargetJmpIns(BpfJmpCode.JA, BpfJmpKind.SUBPROGRAM_CALL);
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("<b> { ; enter new stack frame 1</b>");
  });

  it("renders a helper call and target", () => {
    const ins = createTargetJmpIns(BpfJmpCode.JA, BpfJmpKind.HELPER_CALL);
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      '<span id="mem-slot-r0-line-0" class="mem-slot r0" data-id="r0">r0</span>&nbsp;=&nbsp;',
    );
  });

  it("renders an unconditional goto and target", () => {
    const ins = createGotoJmpIns(
      "goto",
      BpfJmpCode.JA,
      BpfJmpKind.UNCONDITIONAL_GOTO,
    );
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("goto&nbsp;pc+3");
  });

  it("renders a may_goto and target", () => {
    const ins = createGotoJmpIns(
      "may_goto",
      BpfJmpCode.JCOND,
      BpfJmpKind.MAY_GOTO,
    );
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("may_goto&nbsp;pc+3");
  });

  it("renders a goto_or_nop and target", () => {
    const ins = createGotoJmpIns(
      "goto_or_nop",
      BpfJmpCode.JCOND,
      BpfJmpKind.GOTO_OR_NOP,
    );
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("goto_or_nop&nbsp;pc+3");
  });

  it("renders a mem slot wrapped goto", () => {
    const ins: BpfConditionalJmpInstruction = {
      kind: BpfInstructionKind.JMP,
      jmpKind: BpfJmpKind.CONDITIONAL_GOTO,
      opcode: {
        iclass: BpfInstructionClass.JMP,
        code: BpfJmpCode.JEQ,
        source: OpcodeSource.K,
      },
      target: "pc+3",
      cond: {
        left: createOp(OperandType.REG, 2, -45, "r7"),
        op: "==",
        right: createOp(OperandType.REG, 2, -45, "r8"),
      },
      reads: [],
      writes: [],
    };
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} frame={1} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      'if (<span id="mem-slot-r7-line-0" class="mem-slot r7" data-id="r7">r7</span>&nbsp;==&nbsp;<span id="mem-slot-r8-line-0" class="mem-slot r8" data-id="r8">r8</span>)&nbsp;goto&nbsp;pc+3',
    );
  });
});
