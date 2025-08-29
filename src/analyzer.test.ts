import {
  BpfState,
  BpfValue,
  initialBpfState,
  processRawLines,
  VerifierLogState,
} from "./analyzer";

import {
  BPF_CALLEE_SAVED_REGS,
  BPF_SCRATCH_REGS,
  Effect,
  ParsedLineType,
  BpfInstructionKind,
  BpfJmpKind,
} from "./parser";

function expectInitialBpfState(s: BpfState) {
  expect(s.frame).toBe(0);
  expect(s.idx).toBe(0);
  expect(s.pc).toBe(0);
  expect(s.values.get("r1")).toMatchObject({
    value: "ctx()",
    effect: Effect.NONE,
  });
  expect(s.values.get("r10")).toMatchObject({
    value: "fp-0",
    effect: Effect.NONE,
  });
  for (const [key, val] of s.values.entries()) {
    if (key !== "r1" && key !== "r10") {
      expect(val).toMatchObject({ value: "", effect: Effect.NONE });
    }
  }
}

function bpfStatesFromLog(logString: string): BpfState[] {
  const strings = logString.split("\n");
  strings.shift(); // remove the first \n
  const logState: VerifierLogState = processRawLines(strings);
  const { bpfStates } = logState;
  return bpfStates;
}

describe("analyzer", () => {
  it("returns valid initialBpfState()", () => {
    expectInitialBpfState(initialBpfState());
  });

  const basicVerifierLog = `
processed 23 insns (limit 1000000) max_states_per_insn 0 total_states 1 peak_states 1 mark_read 1
ERROR: Error loading BPF program for usdt___a_out_test_struct_by_val_reg_pair_loc0_2.
Kernel error log:
0: R1=ctx() R10=fp0
;  @ bpftrace.bpf.o:0
0: (b7) r2 = 1                        ; R2_w=1
1: (7b) *(u64 *)(r10 -24) = r2        ; R2_w=1 R10=fp0 fp-24_w=1
2: (79) r3 = *(u64 *)(r1 +32)         ; R1=ctx() R3_w=scalar()
3: (07) r3 += -16                     ; R3_w=scalar()
4: (bf) r1 = r10                      ; R1_w=fp0 R10=fp0
5: (07) r1 += -8                      ; R1_w=fp-8
6: (b7) r2 = 16                       ; R2_w=16
7: (85) call bpf_probe_read_user#112
invalid indirect access to stack R1 off=-8 size=16
processed 8 insns (limit 1000000) max_states_per_insn 0 total_states 0 peak_states 0 mark_read 0
ERROR: Loading BPF object(s) failed.
`;
  describe("processes basicVerifierLog end to end normally", () => {
    const bpfStates = bpfStatesFromLog(basicVerifierLog);
    for (let i = 0; i <= 4; i++) {
      expectInitialBpfState(bpfStates[i]);
    }

    it("r2 = 1", () => {
      const s = bpfStates[5];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(5);
      expect(s.pc).toBe(0);
      expect(s.values.get("r2")).toMatchObject({
        value: "1",
        effect: Effect.WRITE,
      });
    });

    it("*(u64 *)(r10 -24) = r2", () => {
      const s = bpfStates[6];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(6);
      expect(s.pc).toBe(1);
      expect(s.values.get("r2")).toMatchObject({
        value: "1",
        effect: Effect.READ,
      });
      expect(s.values.get("fp-24")).toMatchObject({
        value: "1",
        effect: Effect.WRITE,
      });
    });

    it("r3 = *(u64 *)(r1 +32)", () => {
      const s = bpfStates[7];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(7);
      expect(s.pc).toBe(2);
      expect(s.values.get("r1")).toMatchObject({
        value: "ctx()",
        effect: Effect.READ,
      });
      expect(s.values.get("r3")).toMatchObject({
        value: "scalar()",
        effect: Effect.WRITE,
      });
    });

    it("r3 += -16", () => {
      const s = bpfStates[8];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(8);
      expect(s.pc).toBe(3);
      expect(s.values.get("r3")).toMatchObject({
        value: "scalar()",
        effect: Effect.UPDATE,
        prevValue: "scalar()",
      });
    });

    it("r1 = r10", () => {
      const s = bpfStates[9];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(9);
      expect(s.pc).toBe(4);
      expect(s.values.get("r10")).toMatchObject({
        value: "fp-0",
        effect: Effect.READ,
      });
      expect(s.values.get("r1")).toMatchObject({
        value: "fp-0",
        effect: Effect.WRITE,
      });
    });

    it("r1 += -8", () => {
      const s = bpfStates[10];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(10);
      expect(s.pc).toBe(5);
      expect(s.values.get("r1")).toMatchObject({
        value: "fp-8",
        effect: Effect.UPDATE,
        prevValue: "fp-0",
      });
    });

    it("r2 = 16", () => {
      const s = bpfStates[11];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(11);
      expect(s.pc).toBe(6);
      expect(s.values.get("r2")).toMatchObject({
        value: "16",
        effect: Effect.WRITE,
      });
    });

    it("call bpf_probe_read_user#112", () => {
      const s = bpfStates[12];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(12);
      expect(s.pc).toBe(7);
      expect(s.values.get("r0")).toEqual({
        value: "",
        effect: Effect.WRITE,
      });
      for (let i = 1; i <= 5; i++) {
        expect(s.values.get(`r${i}`)).toMatchObject({
          value: "",
          effect: Effect.UPDATE,
        });
      }
      expect(s.values.get("r1")?.prevValue).toBe("fp-8");
      expect(s.values.get("r2")?.prevValue).toBe("16");
      expect(s.values.get("r3")?.prevValue).toBe("scalar()");
      expect(s.values.get("r4")?.prevValue).toBeUndefined();
      expect(s.values.get("r5")?.prevValue).toBeUndefined();
    });
  });

  describe("processes indirect stack access correctly", () => {
    const sampleLog = `
525: (bf) r1 = r10                    ; R1_w=fp0 R10=fp0
526: (07) r1 += -24                   ; R1_w=fp-24
527: (79) r2 = *(u64 *)(r10 -56)      ; R2_w=0 R10=fp0 fp-56=0
528: (0f) r1 += r2
529: (7b) *(u64 *)(r1 +0) = r8        ; R1_w=fp-24 R8=scalar(id=102) fp-24_w=scalar(id=102)
900: (bf) r2 = r10                    ; R2_w=fp0 R10=fp0
901: (07) r2 += -24                   ; R2_w=fp-24
902: (79) r6 = *(u64 *)(r2 +0)        ; R2=fp-24 R6_w=scalar(id=102) fp-24=scalar(id=102)
`;
    const bpfStates = bpfStatesFromLog(sampleLog);
    it("*(u64 *)(r1 +0) = r8", () => {
      const s = bpfStates[4];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(4);
      expect(s.pc).toBe(529);
      expect(s.values.get("fp-24")).toMatchObject({
        value: "scalar(id=102)",
        effect: Effect.WRITE,
      });
    });

    it("r6 = *(u64 *)(r2 +0)", () => {
      const s = bpfStates[7];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(7);
      expect(s.pc).toBe(902);
      expect(s.values.get("fp-24")).toMatchObject({
        value: "scalar(id=102)",
      });
      expect(s.lastKnownWrites.get("fp-24")).toBe(4);
    });
  });

  const verifierLogFragmentWithASubprogramCall = `
702: (bf) r1 = r7                     ; frame0: R1_w=map_value(off=0,ks=4,vs=2808,imm=0) R7=map_value(off=0,ks=4,vs=2808,imm=0)
703: (bf) r2 = r6                     ; frame0: R2_w=rcu_ptr_task_struct(off=0,imm=0) R6=rcu_ptr_task_struct(off=0,imm=0)
704: (85) call pc+420
reg type unsupported for arg#0 function populate_cmdline#890
caller:
 frame0: R6=rcu_ptr_task_struct(off=0,imm=0) R7=map_value(off=0,ks=4,vs=2808,imm=0) R8=fp-24 R10=fp0 fp-8=mmmmmmmm fp-16=mmmmmmmm fp-24=mmmmmmmm
callee:
 frame1: R1_w=map_value(off=0,ks=4,vs=2808,imm=0) R2_w=rcu_ptr_task_struct(off=0,imm=0) R10=fp0
1125: frame1:
; static void populate_cmdline(struct armr_proc* proc, struct task_struct* task) {
1125: (bf) r0 = r2                    ; frame1: R0_w=rcu_ptr_task_struct(off=0,imm=0) R2=rcu_ptr_task_struct(off=0,imm=0)
1126: (95) exit
returning from callee:
 frame1: R0_w=rcu_ptr_task_struct(off=0,imm=0) R2=rcu_ptr_task_struct(off=0,imm=0) R8_w=rcu_ptr_task_struct(off=0,imm=0)
to caller at 705:
 R0_w=rcu_ptr_task_struct(off=0,imm=0)
705: (bf) r9 = r0                       ; R0=rcu_ptr_task_struct(off=0,imm=0) R9_w=rcu_ptr_task_struct(off=0,imm=0)
`;
  describe("processes verifierLogFragmentWithASubprogramCall end to end normally", () => {
    const bpfStates = bpfStatesFromLog(verifierLogFragmentWithASubprogramCall);

    const r1Value = "map_value(off=0,ks=4,vs=2808,imm=0)";
    const r2Value = "rcu_ptr_task_struct(off=0,imm=0)";

    it("r1 = r7", () => {
      const s = bpfStates[0];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(0);
      expect(s.pc).toBe(702);
      expect(s.values.get("r7")?.value).toBe(r1Value);
      expect(s.values.get("r1")).toMatchObject({
        value: r1Value,
        effect: Effect.WRITE,
      });
    });

    it("r2 = r6", () => {
      const s = bpfStates[1];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(1);
      expect(s.pc).toBe(703);
      expect(s.values.get("r6")?.value).toBe(r2Value);
      expect(s.values.get("r2")).toMatchObject({
        value: r2Value,
        effect: Effect.WRITE,
      });
    });

    // compute savedRegValues for the exit test
    const beforeCallValues = bpfStates[1];
    const savedRegValues = new Map<string, BpfValue>();
    for (const reg of BPF_CALLEE_SAVED_REGS) {
      if (beforeCallValues.values.has(reg)) {
        savedRegValues.set(reg, {
          value: beforeCallValues.values.get(reg)?.value || "",
          effect: Effect.NONE,
        });
      }
    }

    it("call pc+420", () => {
      const s = bpfStates[2];
      expect(s.frame).toBe(1);
      expect(s.idx).toBe(2);
      expect(s.pc).toBe(704);
      expect(s.values.get("r1")).toMatchObject({
        value: r1Value,
        effect: Effect.READ,
      });
      expect(s.values.get("r2")).toMatchObject({
        value: r2Value,
        effect: Effect.READ,
      });
      for (const reg of ["r3", "r4", "r5"]) {
        expect(s.values.get(reg)).toMatchObject({
          value: "",
          effect: Effect.READ,
        });
      }
      for (const reg of ["r0", ...BPF_CALLEE_SAVED_REGS]) {
        expect(s.values.get(reg)).toMatchObject({
          value: "",
          effect: Effect.WRITE,
        });
      }
    });

    it("; call comments", () => {
      for (const s of bpfStates.slice(3, 10)) {
        expect(s).toMatchObject(bpfStates[2]);
      }
    });

    it("r0 = r2", () => {
      const s = bpfStates[10];
      expect(s.frame).toBe(1);
      expect(s.idx).toBe(10);
      expect(s.pc).toBe(1125);
      expect(s.values.get("r2")).toMatchObject({
        value: r2Value,
        effect: Effect.READ,
      });
      expect(s.values.get("r0")).toMatchObject({
        value: r2Value,
        effect: Effect.WRITE,
      });
    });

    it("exit", () => {
      const s = bpfStates[11];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(11);
      expect(s.pc).toBe(1126);
      for (const reg of BPF_SCRATCH_REGS) {
        expect(s.values.get(reg)).toMatchObject({
          value: "",
          effect: Effect.WRITE,
        });
      }
      for (const reg of BPF_CALLEE_SAVED_REGS) {
        expect(s.values.get(reg)).toEqual(savedRegValues.get(reg));
      }
    });

    it("; exit comments", () => {
      for (const s of bpfStates.slice(12, 16)) {
        expect(s).toMatchObject(bpfStates[11]);
      }
    });

    it("r9 = r0", () => {
      const s = bpfStates[16];
      expect(s.frame).toBe(0);
      expect(s.idx).toBe(16);
      expect(s.pc).toBe(705);
      expect(s.values.get("r0")).toMatchObject({
        value: r2Value,
        effect: Effect.READ,
      });
      expect(s.values.get("r9")).toMatchObject({
        value: r2Value,
        effect: Effect.WRITE,
      });
    });
  });

  describe("builds correct CSourceMap", () => {
    const verifierLogFragmentWithSimpleCSource = `
; n->key = 3; @ rbtree.c:201
0: (b7) r2 = 1                        ; R2_w=1
1: (7b) *(u64 *)(r10 -24) = r2        ; R2_w=1 R10=fp0 fp-24_w=1
; proc->pid = task->pid; @ rbtree.c:204
2: (79) r3 = *(u64 *)(r1 +32)         ; R1=ctx() R3_w=scalar()
3: (07) r3 += -16                     ; R3_w=scalar()
; n->key = 5; @ rbtree.c:206
4: (bf) r1 = r10                      ; R1_w=fp0 R10=fp0
`;

    describe("for verifierLogFragmentWithSimpleCSource", () => {
      const strings = verifierLogFragmentWithSimpleCSource.split("\n");
      strings.shift(); // remove the first \n
      const logState: VerifierLogState = processRawLines(strings);
      const { cSourceMap } = logState;

      it("creates correct C source line entries", () => {
        expect(cSourceMap.cSourceLines.size).toBe(3);

        let line = cSourceMap.cSourceLines.get("rbtree.c:201");
        expect(line).toMatchObject({
          content: "n->key = 3;",
          fileName: "rbtree.c",
          lineNum: 201,
          id: "rbtree.c:201",
        });

        line = cSourceMap.cSourceLines.get("rbtree.c:204");
        expect(line).toMatchObject({
          content: "proc->pid = task->pid;",
          fileName: "rbtree.c",
          lineNum: 204,
          id: "rbtree.c:204",
        });

        line = cSourceMap.cSourceLines.get("rbtree.c:206");
        expect(line).toMatchObject({
          content: "n->key = 5;",
          fileName: "rbtree.c",
          lineNum: 206,
          id: "rbtree.c:206",
        });
      });

      it("maps log lines to C source lines correctly", () => {
        expect(cSourceMap.logLineToCLine.get(1)).toBe("rbtree.c:201");
        expect(cSourceMap.logLineToCLine.get(2)).toBe("rbtree.c:201");
        expect(cSourceMap.logLineToCLine.get(4)).toBe("rbtree.c:204");
        expect(cSourceMap.logLineToCLine.get(5)).toBe("rbtree.c:204");
        expect(cSourceMap.logLineToCLine.get(7)).toBe("rbtree.c:206");
      });

      it("maps C source lines to log lines correctly", () => {
        expect(cSourceMap.cLineToLogLines.get("rbtree.c:201")).toEqual(
          new Set([1, 2]),
        );
        expect(cSourceMap.cLineToLogLines.get("rbtree.c:204")).toEqual(
          new Set([4, 5]),
        );
        expect(cSourceMap.cLineToLogLines.get("rbtree.c:206")).toEqual(
          new Set([7]),
        );
      });

      it("tracks file range correctly", () => {
        const rbtreeRange = cSourceMap.fileRange.get("rbtree.c");
        expect(rbtreeRange).toEqual([201, 206]);
      });
    });

    const verifierLogFragmentWithAPieceOfLoop = `
; for (int i = 0; i < STACK_MAX_LEN; ++i) { @ pyperf.h:313
195: (07) r7 += 150                   ; R7=300
196: (55) if r7 != 0x258 goto pc+4    ; R7=300
; for (int i = 0; i < STACK_MAX_LEN; ++i) { @ pyperf.h:313
195: (07) r7 += 150                   ; R7_w=150
196: (55) if r7 != 0x258 goto pc+4    ; R7_w=150
`;

    describe("processes verifierLogFragmentWithAPieceOfLoop correctly", () => {
      const strings = verifierLogFragmentWithAPieceOfLoop.split("\n");
      strings.shift(); // remove the first \n
      const logState: VerifierLogState = processRawLines(strings);
      const { cSourceMap } = logState;

      it("creates correct C source line entries", () => {
        expect(cSourceMap.cSourceLines.size).toBe(1);

        let line = cSourceMap.cSourceLines.get("pyperf.h:313");
        expect(line).toMatchObject({
          content: "for (int i = 0; i < STACK_MAX_LEN; ++i) {",
          fileName: "pyperf.h",
          lineNum: 313,
          id: "pyperf.h:313",
        });
      });

      it("maps log lines to C source lines correctly", () => {
        [1, 2, 4, 5].forEach((idx) => {
          expect(cSourceMap.logLineToCLine.get(idx)).toBe("pyperf.h:313");
        });
      });

      it("maps C source lines to log lines correctly", () => {
        expect(cSourceMap.cLineToLogLines.get("pyperf.h:313")).toEqual(
          new Set([1, 2, 4, 5]),
        );
      });

      it("tracks file range correctly", () => {
        const rbtreeRange = cSourceMap.fileRange.get("pyperf.h");
        expect(rbtreeRange).toEqual([313, 313]);
      });
    });
  });

  describe("processes known messages", () => {
    const verifierLogWithGlobalFuncCall = `
0: (b7) r2 = 1                        ; R2_w=1
1: (85) call pc+10
Func#123 ('my_global_func') is global and assumed valid.
2: (bf) r0 = r1                       ; R0_w=ctx() R1=ctx()
`;

    describe("global func call", () => {
      const strings = verifierLogWithGlobalFuncCall.split("\n");
      strings.shift(); // remove the first \n
      const logState: VerifierLogState = processRawLines(strings);
      const { lines, bpfStates } = logState;

      it("transforms global function call correctly", () => {
        // Check that line 1 is transformed from SUBPROGRAM_CALL to HELPER_CALL
        expect(lines[1]).toMatchObject({
          type: ParsedLineType.INSTRUCTION,
          bpfIns: {
            kind: BpfInstructionKind.JMP,
            jmpKind: BpfJmpKind.HELPER_CALL,
            target: "my_global_func",
            reads: BPF_SCRATCH_REGS,
            writes: ["r0", ...BPF_SCRATCH_REGS],
          },
        });
      });

      it("processes BPF states correctly after transformation", () => {
        // Check that the transformed call is processed as a helper call
        const callState = bpfStates[1];
        expect(callState.frame).toBe(0);
        expect(callState.pc).toBe(1);
        for (const reg of BPF_SCRATCH_REGS) {
          expect(callState.values.get(reg)).toMatchObject({
            effect: Effect.UPDATE,
          });
        }
        expect(callState.values.get("r0")).toMatchObject({
          effect: Effect.WRITE,
        });
      });
    });
  });
});
