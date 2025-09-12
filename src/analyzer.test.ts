import {
  BpfState,
  BpfValue,
  getMemSlotDependencies,
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
  BpfTargetJmpInstruction,
  InstructionLine,
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

function getVerifierLogState(logString: string): VerifierLogState {
  const strings = logString.split("\n");
  strings.shift(); // remove the first \n
  return processRawLines(strings);
}

describe("analyzer", () => {
  it("returns valid new BpfState()", () => {
    expectInitialBpfState(new BpfState({}));
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
    const { bpfStates } = getVerifierLogState(basicVerifierLog);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      expect(s.lastKnownWrites.get("r3")).toBe(7);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      expect(s.lastKnownWrites.get("r3")).toBe(8);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      expect(s.lastKnownWrites.get("r3")).toBe(8);
      expect(s.lastKnownWrites.get("r1")).toBe(9);
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
      expect(s.lastKnownWrites.get("r2")).toBe(5);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      expect(s.lastKnownWrites.get("r3")).toBe(8);
      expect(s.lastKnownWrites.get("r1")).toBe(10);
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
      expect(s.lastKnownWrites.get("r2")).toBe(11);
      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      expect(s.lastKnownWrites.get("r3")).toBe(8);
      expect(s.lastKnownWrites.get("r1")).toBe(10);
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

      expect(s.lastKnownWrites.get("fp-24")).toBe(6);
      for (const id of ["r0", "r1", "r2", "r3", "r4", "r5"]) {
        expect(s.lastKnownWrites.get(id)).toBe(12);
      }
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
    const { bpfStates } = getVerifierLogState(sampleLog);
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
    const { bpfStates } = getVerifierLogState(
      verifierLogFragmentWithASubprogramCall,
    );

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
      expect(s.lastKnownWrites.get("r1")).toBe(0);
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
      expect(s.lastKnownWrites.get("r1")).toBe(0);
      expect(s.lastKnownWrites.get("r2")).toBe(1);
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
      expect(s.lastKnownWrites.get("r1")).toBe(0);
      expect(s.lastKnownWrites.get("r2")).toBe(1);
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
      expect(s.lastKnownWrites.get("r1")).toBe(0);
      expect(s.lastKnownWrites.get("r2")).toBe(1);
      expect(s.lastKnownWrites.get("r0")).toBe(10);
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
      expect(s.lastKnownWrites.get("r0")).toBe(10);
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
      expect(s.lastKnownWrites.get("r0")).toBe(10);
      expect(s.lastKnownWrites.get("r9")).toBe(16);
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
      const { cSourceMap } = getVerifierLogState(
        verifierLogFragmentWithSimpleCSource,
      );

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
      const { cSourceMap } = getVerifierLogState(
        verifierLogFragmentWithAPieceOfLoop,
      );

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
      const { lines, bpfStates } = getVerifierLogState(
        verifierLogWithGlobalFuncCall,
      );

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

  describe("takes into accout BPF_STATE_EXPRS messages", () => {
    const rawLog = `
96: (18) r1 = 0xffff888370cf0a00      ; frame1: R1_w=map_ptr(map=bpfj_log_map,ks=0,vs=0)
98: (b7) r2 = 196                     ; frame1: R2_w=196
99: (b7) r3 = 0                       ; frame1: R3_w=0
100: (85) call bpf_ringbuf_reserve#131
101: frame1: R0=ringbuf_mem_or_null(id=5,ref_obj_id=5,sz=196) refs=5
101: (bf) r7 = r0                     ; frame1: R0=ringbuf_mem_or_null(id=5,ref_obj_id=5,sz=196) R7_w=ringbuf_mem_or_null(id=5,ref_obj_id=5,sz=196) refs=5
`;
    const { bpfStates } = getVerifierLogState(rawLog);
    const val = "ringbuf_mem_or_null(id=5,ref_obj_id=5,sz=196)";
    it("call bpf_ringbuf_reserve#131 contains state from the next log line", () => {
      const s = bpfStates[3];
      expect(s.idx).toBe(3);
      expect(s.pc).toBe(100);
      expect(s.values.get("r0")).toMatchObject({
        value: val,
        effect: Effect.WRITE,
      });
    });

    it("101: (bf) r7 = r0 depends on the call", () => {
      const s = bpfStates[5];
      expect(s.idx).toBe(5);
      expect(s.pc).toBe(101);
      expect(s.values.get("r0")).toMatchObject({
        value: val,
        effect: Effect.READ,
      });
      expect(s.values.get("r7")).toMatchObject({
        value: val,
        effect: Effect.WRITE,
      });
      expect(s.lastKnownWrites.get("r0")).toBe(3);
      expect(s.lastKnownWrites.get("r7")).toBe(5);
    });
  });

  // The following two tests aim to verify that the analyzer correctly
  // identifies an indirect access to a stack slot
  // note that typically verifier would print an appropriate expression after ;
  // but analyzer must be able to infer the access independently
  describe("evaluates indirect stack store", () => {
    const rawLog = `
525: (bf) r1 = r10                    ; R1_w=fp0 R10=fp0
526: (07) r1 += -24                   ; R1_w=fp-24
527: (79) r2 = *(u64 *)(r10 -56)      ; R2_w=0 R10=fp0 fp-56=0
528: (0f) r1 += r2
529: R1_w=fp-24 R2_w=0
529: (7b) *(u64 *)(r1 +0) = r8        ; R1_w=fp-24 R8=scalar(id=102)
530: (79) r6 = *(u64 *)(r10 -24)
`;
    const { bpfStates } = getVerifierLogState(rawLog);
    const val = "scalar(id=102)";
    it("*(u64 *)(r1 +0) = r8", () => {
      const s = bpfStates[5];
      expect(s.idx).toBe(5);
      expect(s.pc).toBe(529);
      expect(s.values.get("r8")?.value).toBe(val);
      expect(s.values.get("fp-24")?.value).toBe(val);
    });
    it("r6 = *(u64 *)(r10 -24)", () => {
      const s = bpfStates[6];
      expect(s.idx).toBe(6);
      expect(s.pc).toBe(530);
      expect(s.values.get("fp-24")?.value).toBe(val);
      expect(s.values.get("r6")?.value).toBe(val);
    });
  });

  describe("evaluates indirect stack load", () => {
    const rawLog = `
524: (7b) *(u64 *)(r10 -24) = r9      ; fp-24_w=42 R9=42
525: (bf) r1 = r10                    ; R1_w=fp0 R10=fp0
526: (07) r1 += -16                   ; R1_w=fp-16
527: (18) r2 = 0                      ; R2_w=0 R10=fp0
528: (0f) r1 += r2                    ; R1_w=fp-16 R2_w=0
530: (79) r6 = *(u64 *)(r1 -8)
`;
    const { bpfStates } = getVerifierLogState(rawLog);
    it("*(u64 *)(r10 -24) = r9", () => {
      const s = bpfStates[0];
      expect(s.idx).toBe(0);
      expect(s.pc).toBe(524);
      expect(s.values.get("r9")?.value).toBe("42");
      expect(s.values.get("fp-24")?.value).toBe("42");
    });
    it("r6 = *(u64 *)(r1 -8)", () => {
      const s = bpfStates[5];
      expect(s.idx).toBe(5);
      expect(s.pc).toBe(530);
      expect(s.values.get("fp-24")?.value).toBe("42");
      expect(s.values.get("r6")?.value).toBe("42");
    });
  });

  describe("tracks side effect dependencies", () => {
    const rawLog = `
3: (85) call bpf_obj_new_impl#54651 ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
4: (bf) r6 = r0 ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) R6_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
6: (15) if r6 == 0x0 goto pc+104 ; R6_w=ptr_node_data(ref_obj_id=2) refs=2
42: (85) call bpf_rbtree_add_impl#54894 ; R0_w=scalar() R6=ptr_node_data(non_own_ref) R7=2 R8=ptr_node_data(ref_obj_id=4) R9=ptr_node_data(ref_obj_id=6) R10=fp0 refs=4,6
99: (55) if r0 != 0x0 goto pc+13 113: R0_w=ptr_node_data(non_own_ref,off=16) R6=scalar() R7=5 R8=scalar() R9=scalar() R10=fp0
117: (18) r1 = 0xff434b28008e3de8     ; R1_w=map_value(map=.data.A,ks=4,vs=72,off=16)
119: (85) call bpf_spin_unlock#94     ;
120: (79) r7 = *(u64 *)(r6 +8)
`;
    const logState = getVerifierLogState(rawLog);
    it("120: (79) r7 = *(u64 *)(r6 +8)", () => {
      const idx = 7;
      const s = logState.bpfStates[idx];
      expect(s.idx).toBe(7);
      expect(s.pc).toBe(120);
      const r6Deps = getMemSlotDependencies(logState, idx, "r6");
      expect(r6Deps).toEqual(new Set<number>([4, 3, 2, 1, 0]));
    });
  });

  describe("tracks parent stack slot writes", () => {
    const rawLog = `
2829: (7b) *(u64 *)(r10 -8) = r1      ; R1_w=0 R10=fp0 fp-8_w=0
2830: (bf) r3 = r10                   ; R3_w=fp0 R10=fp0
2831: (07) r3 += -8                   ; R3_w=fp-8
2832: (bf) r1 = r6                    ; R1_w=scalar(id=5800,umin=1) R6_w=scalar(id=5800,umin=1)
2833: (18) r2 = 0xdeadbeef            ; R2=0xdeadbeef
2835: (85) call pc+140
2976: frame1: R1=scalar(id=5800,umin=1) R2=0xdeadbeef R3=fp[0]-8 R10=fp0
; bt_node *btn = btree->root; @ btree.bpf.c:146
2976: (bf) r1 = addr_space_cast(r1, 0, 1)     ; frame1: R1_w=arena
2992: (79) r6 = *(u64 *)(r3 +0)       ; frame1: R6_w=0 R3=fp[0]-8
2993: (07) r6 += 13                   ; frame1: R6_w=13
2994: (7b) *(u64 *)(r3 +0) = r6       ; frame1: R3=fp[0]-8 R6=13
2995: (b4) w0 = 0                     ; frame1: R0_w=0
3028: (95) exit
3050: (79) r7 = *(u64 *)(r10 -8)      ; fp-8=13 R7_w=13
`;
    const logState = getVerifierLogState(rawLog);
    it("tracks fp-8 dependency on write at pc 2994", () => {
      const idx = 14;
      const s = logState.bpfStates[idx];
      expect(s.idx).toBe(14);
      expect(s.pc).toBe(3050);
      const deps = getMemSlotDependencies(logState, idx, "fp-8");
      expect(deps).toEqual(new Set<number>([11]));
      expect(logState.bpfStates[11].pc).toBe(2994);
    });
  });

  describe("identifies bpf_loop as a subprogram call", () => {
    const rawLog = `
1187: (7b) *(u64 *)(r10 -64) = r9     ; frame1: R9=42 R10=fp0 fp-64_w=42 refs=84
1189: (bf) r3 = r10                   ; frame1: R3_w=fp0 R10=fp0 refs=84
1190: (07) r3 += -64                  ; frame1: R3_w=fp-64 refs=84
; bpf_loop(BPFJ_FILE_MAX_RECURSION, &bpfj_file_save_path, &ctx, 0); @ file.h:256
1191: (b4) w1 = 256                   ; frame1: R1_w=256 refs=84
1192: (18) r2 = 0x1bf                 ; frame1: R2_w=func() refs=84
1194: (b7) r4 = 0                     ; frame1: R4=0 refs=84
1195: (85) call bpf_loop#181
1640: frame2: R1=scalar() R2=fp[1]-64 R10=fp0 refs=84 cb
1641: (a7) r1 ^= -1                   ; frame2: R1_w=scalar(smin=0xffffffff00000000,smax=-1,umin=0xffffffff00000000,var_off=(0xffffffff00000000; 0xffffffff)) refs=84 cb
1649: (63) *(u32 *)(r2 +16) = r1      ; frame2: R1_w=0xfffffff9 R2=fp[1]-64 refs=84 cb
1650: (05) goto pc+27
1678: (95) exit
returning from callee:
 frame2: R0=1 R1=0xfffffff9 R2=fp[1]-64
to caller at 1195:
 frame1: R0=map_value(map=bpfj_file_scrat,ks=4,vs=1024) R1=256 R2=func() R3=fp-64
1196: (71) r1 = *(u8 *)(r6 +1)        ; frame1: R1_w=scalar(smin=smin32=0,smax=umax=smax32=umax32=255,var_off=(0x0; 0xff)) R6=map_value(map=bpfj_file_scrat,ks=4,vs=1024) refs=84
`;
    const logState = getVerifierLogState(rawLog);
    it("bpf_loop is in new frame", () => {
      const s = logState.bpfStates[7];
      expect(s.idx).toBe(7);
      expect(s.pc).toBe(1195);
      expect(s.frame).toBe(2);
      expect(s.values.get("r1")?.value).toBe("scalar()");
      expect(s.values.get("r2")?.value).toBe("fp[1]-64");
      expect(s.values.get("fp-64")?.value).toBeUndefined();
      expect(s.values.get("fp[1]-64")?.value).toBe("42");

      let line = logState.lines[7];
      expect(line.type).toBe(ParsedLineType.INSTRUCTION);
      line = <InstructionLine>line;
      expect(line.bpfIns).toMatchObject({
        kind: BpfInstructionKind.JMP,
        jmpKind: BpfJmpKind.HELPER_CALL,
      });
      const ins = <BpfTargetJmpInstruction>line.bpfIns;
      expect(ins.target).toContain("bpf_loop");
    });
    it("r2+16 at 1649 writes to fp[1]-48", () => {
      const s = logState.bpfStates[10];
      expect(s.idx).toBe(10);
      expect(s.pc).toBe(1649);
      expect(s.frame).toBe(2);
      expect(s.values.get("r1")?.value).toBe("0xfffffff9");
      expect(s.values.get("fp[1]-48")?.value).toBe("0xfffffff9");
      expect(s.values.get("fp[0]-48")?.value).toBeUndefined();
      expect(s.values.get("fp-48")?.value).toBeUndefined();
    });
    it("exit pops the frame", () => {
      const s = logState.bpfStates[12];
      expect(s.idx).toBe(12);
      expect(s.pc).toBe(1678);
      expect(s.frame).toBe(1);
      expect(s.values.get("fp[1]-64")?.value).toBe("42");
      expect(s.values.get("fp-64")?.value).toBe("42");
    });
  });

  describe("computes dependencies correctly for stack slot", () => {
    const rawLog = `
3172: (bf) r1 = addr_space_cast(r8, 0, 1) ; frame1: R1_w=arena R8=scalar()
3173: (7b) *(u64 *)(r10 -8) = r1 ; frame1: R1_w=arena R10=fp0 fp-8_w=arena
3314: (79) r1 = *(u64 *)(r10 -8) ; frame1: R1_w=arena R10=fp0 fp-8=arena
3315: (0f) r2 += r1
`;
    const logState = getVerifierLogState(rawLog);
    it("fp-8 dependencies at 3314", () => {
      const s = logState.bpfStates[2];
      expect(s.idx).toBe(2);
      expect(s.pc).toBe(3314);
      const deps = getMemSlotDependencies(logState, s.idx, "fp-8");
      expect(deps).toEqual(new Set<number>([1, 0]));
    });
    it("r1 dependencies at 3315", () => {
      const s = logState.bpfStates[3];
      expect(s.idx).toBe(3);
      expect(s.pc).toBe(3315);
      const deps = getMemSlotDependencies(logState, s.idx, "r1");
      expect(deps).toEqual(new Set<number>([2, 1, 0]));
    });
  });
});
