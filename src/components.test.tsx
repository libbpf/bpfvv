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
  BPF_SCRATCH_REGS,
} from "./parser";
import { BpfState, initialBpfState, makeValue } from "./analyzer";
import { Effect } from "./parser";

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
      reg: "r2",
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
    target: string = "pc+3",
  ): BpfTargetJmpInstruction {
    return {
      kind: BpfInstructionKind.JMP,
      jmpKind,
      opcode: {
        iclass: BpfInstructionClass.JMP,
        code: jmpCode,
        source: OpcodeSource.K,
      },
      target,
      reads: [],
      writes: [],
      // corresponds to "pc+3" in ParsedLine.raw
      location: {
        offset: -4,
        size: 4,
      },
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
      raw: "call pc+3",
      idx: 0,
      bpfIns,
      bpfStateExprs: [],
      type: ParsedLineType.INSTRUCTION,
    };
  }

  function dummyBpfState(frame: number = 0): BpfState {
    const state = initialBpfState();
    state.frame = frame;
    for (const reg of BPF_SCRATCH_REGS) {
      state.values.set(reg, makeValue("", Effect.UPDATE));
    }
    return state;
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

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("<b>} exit ; return to stack frame 1</b>");
  });

  it("renders a subprogram and target", () => {
    const ins = createTargetJmpIns(BpfJmpCode.JA, BpfJmpKind.SUBPROGRAM_CALL);
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe("<b>pc+3() { ; enter new stack frame 1</b>");
  });

  it("renders a helper call and target", () => {
    const ins = createTargetJmpIns(BpfJmpCode.JA, BpfJmpKind.HELPER_CALL);
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      '<span id="mem-slot-r0-line-0" class="mem-slot r0" data-id="r0">r0</span>&nbsp;=&nbsp;pc+3()',
    );
  });

  it("renders an unconditional goto and target", () => {
    const ins = createGotoJmpIns(
      "goto",
      BpfJmpCode.JA,
      BpfJmpKind.UNCONDITIONAL_GOTO,
    );
    const line = createLine(ins);

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
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

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
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

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
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

    render(<JmpInstruction ins={ins} line={line} state={dummyBpfState(1)} />);
    const divs = document.getElementsByTagName("div");
    expect(divs.length).toBe(1);
    expect(divs[0].innerHTML).toBe(
      'if (<span id="mem-slot-r7-line-0" class="mem-slot r7" data-id="r7">r7</span>&nbsp;==&nbsp;<span id="mem-slot-r8-line-0" class="mem-slot r8" data-id="r8">r8</span>)&nbsp;goto&nbsp;pc+3',
    );
  });

  function setCallArgValue(state: BpfState, arg: string, preCallValue: string) {
    state.values.set(arg, makeValue("", Effect.UPDATE, preCallValue));
  }

  describe("CallHtml argument counting", () => {
    it("shows 3 arguments when r4 and r5 are scratched", () => {
      const ins = createTargetJmpIns(
        BpfJmpCode.JA,
        BpfJmpKind.HELPER_CALL,
        "bpf_helper#123",
      );
      const line = createLine(ins);
      const state = initialBpfState();

      setCallArgValue(state, "r1", "ctx()");
      setCallArgValue(state, "r2", "16");
      setCallArgValue(state, "r3", "fp-8");
      setCallArgValue(state, "r4", "");
      setCallArgValue(state, "r5", "");

      render(<JmpInstruction ins={ins} line={line} state={state} />);
      const divs = document.getElementsByTagName("div");
      expect(divs.length).toBe(1);

      // Should show r0 = call bpf_helper#123(r1, r2, r3)
      const innerHTML = divs[0].innerHTML;
      expect(innerHTML).toContain("r1");
      expect(innerHTML).toContain("r2");
      expect(innerHTML).toContain("r3");
      expect(innerHTML).not.toMatch(/r4.*,/);
      expect(innerHTML).not.toMatch(/r5.*,/);
    });

    it("shows 4 arguments when only r4 is not scratched", () => {
      const ins = createTargetJmpIns(
        BpfJmpCode.JA,
        BpfJmpKind.HELPER_CALL,
        "bpf_helper#123",
      );
      const line = createLine(ins);
      const state = initialBpfState();

      setCallArgValue(state, "r1", "");
      setCallArgValue(state, "r2", "");
      setCallArgValue(state, "r3", "");
      setCallArgValue(state, "r4", "scalar()");
      setCallArgValue(state, "r5", "");

      render(<JmpInstruction ins={ins} line={line} state={state} />);
      const divs = document.getElementsByTagName("div");
      expect(divs.length).toBe(1);

      // Should show r0 = call bpf_helper#123(r1, r2, r3)
      const innerHTML = divs[0].innerHTML;
      expect(innerHTML).toContain("r1");
      expect(innerHTML).toContain("r2");
      expect(innerHTML).toContain("r3");
      expect(innerHTML).toContain("r4");
      expect(innerHTML).not.toMatch(/r5.*,/);
    });
  });

  describe("global function call rendering", () => {
    it("renders global function name", () => {
      // After analyzer transformation, a global function call becomes a HELPER_CALL
      // with the function name as the target (e.g., "my_global_func" instead of "pc+10")
      const ins = createTargetJmpIns(
        BpfJmpCode.CALL,
        BpfJmpKind.HELPER_CALL,
        "my_global_func",
      );
      const line = createLine(ins);
      const state = initialBpfState();
      setCallArgValue(state, "r1", "ctx()");
      setCallArgValue(state, "r2", "buffer_ptr");
      setCallArgValue(state, "r3", "");

      render(<JmpInstruction ins={ins} line={line} state={state} />);
      const divs = document.getElementsByTagName("div");
      expect(divs.length).toBe(1);

      const innerHTML = divs[0].innerHTML;
      expect(innerHTML).toContain("my_global_func");
      expect(innerHTML).toContain("r1");
      expect(innerHTML).toContain("r2");
    });
  });
});
