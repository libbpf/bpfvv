/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemSlot } from "./components";
import { BpfOperand, OperandType, ParsedLine, ParsedLineType } from "./parser";

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

function createParsedLine(raw: string, idx: number): ParsedLine {
  return { raw, idx, type: ParsedLineType.INSTRUCTION };
}

describe("MemSlot", () => {
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
