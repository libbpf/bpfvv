### Disclaimer

Like many other debugging tools, **bpfvv** may help you better understand **what** is happening with the verification of your BPF program but it is up to you to figure out **why** it is happening.

# How to use bpfvv

The tool itself is hosted here: https://libbpf.github.io/bpfvv/

You can load a  log by pasting it into the text box or choosing a local file.

You can also use the `url` query parameter to link to a raw log file, for example:
```
https://libbpf.github.io/bpfvv/?url=https://gist.githubusercontent.com/theihor/e0002c119414e6b40e2192bd7ced01b1/raw/866bcc155c2ce848dcd4bc7fd043a97f39a2d370/gistfile1.txt
```

The app expects BPF verifier log of `BPF_LOG_LEVEL1`[^1]. This is a log
that you get when your BPF program has failed verification on load
attempt.

Here is a small example:
```
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
```

This log represents a particular trace through the BPF program that
led to an invalid state (as judged by the BPF verifier). It contains a
lot of information about the interpreted state of the program on each
instruction. The app parses the log and re-constructs program states
in order to display potentially useful information in interactive way.

## UI overview

There are three main views of the program:
* (on the left) C source view 
* (in the middle) interactive instruction stream
* (on the right) program state: known values of registers and stack slots for the *selected log line*

The left and right views are collapsible

https://github.com/user-attachments/assets/758d650b-22f1-49f0-ab46-ae1a089667a8

### Top bar

The top bar contains basic app controls such as:
* clear current log
* load an example log
* load a local file
* link to this howto doc

https://github.com/user-attachments/assets/4d3f8aa0-cb9d-46e0-ae46-a1224c7a5600

### The instruction stream

The main view of the log is the interactive instruction stream.

Notice that the displayed text has content different from the raw log.
For example, consider this line:
```
1: (7b) *(u64 *)(r10 -24) = r2        ; R2_w=1 R10=fp0 fp-24_w=1
```
In the log view you will only see:
```
*(u64 *)(r10 -24) = r2
```
And program counter (pc) in a spearate column on the left.

This is intentional, as the comment on the right in the original line
is the state of values as reported by BPF verifier. Since it is
captured and displayed in a separate view, printing it in the log view
is redundant.

Some instructions also are printed differently to facilitate
interactive features. Notable example is call instructions.

For example, consider the following raw log line:
```
7: (85) call bpf_probe_read_user#112
```

It is displayed like this:
```
r0 = bpf_probe_read_user(dst: r1, size: r2, unsafe_ptr: r3)
```

If bpfvv is aware of a helper signature, it knows the number and names of arguments and displays them in the format `name: reg`.
For known helpers its name is also a link to documentation for that helper.

Notice also that the lines not recognized by the parser are greyed
out. If you notice an unrecognized instruction, please submit a bug
report.

#### Data dependencies

The app computes a use-def analysis [^2] and you can interactively view dependencies between the instructions.

The concept is simple. Every instruction may read some slots (registers, stack, memory) and write to others.
Knowing these it is possible to determine, for a given slot, where its value came from, from what slot, and at what instruction.

You can view the results of this analysis by clicking on some instruction operands (registers and stack slots).

The selected slot is identified by a box around it. This selection changes the log view, greying out "irrelevant" instructions, and leaving only data-dependent instructions in the foreground.

On the left side of the instruction stream are the lines visualizing the dependencies. The lines are interactive and can be used for navigation.

https://github.com/user-attachments/assets/82ae80d6-314e-47bf-9892-f5dded4b9944

#### Subprogram calls

When there is a subprogram call in the log instruction stream, the 
stack frames are tracked by the app when computing state. When a subprogram
call is detected it is visualized in the main log view.

https://github.com/user-attachments/assets/14b2302e-9814-4d9a-ae94-e176727fd11a

### The state panel

The state panel displays the current state of the program based on the loaded log, with the current state determined by the line selected in the instruction stream view.

Remember that the verifier log is a trace through the program.
This means that a particular instruction may be visited more than once, and the state at the same instruction (but a different point of execution) is usually also different. And so a log line roughly represents a particular point of the program execution, as interpreted by the BPF verifier.

The verifier reports changes in the program state like this:
```
1: (7b) *(u64 *)(r10 -24) = r2        ; R2_w=1 R10=fp0 fp-24_w=1
```
After the semicolon `;`, there are expressions showing relevant register and stack slot states. The visualizer accumulates this information from all the prior instructions, and in the state panel this accumulated state is displayed. 

The header of the state panel shows the context of the state: log line number, C line number, program counter (PC) and the stack frame index.

The known values of the registers and stack slots are displayed in a table.

The background color of a row in the state panel indicates that the relevant value has been affected by the selected instruction.
Rows marked with red background indicate a "write" and the previous value is also often displayed, for example:
```
r6	scalar(id=1) -> 0
```
This means that current instruction changes the value of `r6` from `scalar(id=1)` to `0`.

The values that are read by the current instruction have a blue background.

Note that for "update" instructions (such as `r1 += 8`), the slot will be marked as written.

This then allows you to "step through" the instruction stream and watch how the values are changing, similar to classic debugger UIs.
You can click on the lines that interest you, or use arrow keys to navigate.

https://github.com/user-attachments/assets/c6b5b5b1-30fb-4309-a90a-1832a0a33502

#### The rows in the state panel are clickable!

It is sometimes useful to jump to the source of a particular slot value from the selected instruction, even if the slot is not relevant to that instruction.

https://github.com/user-attachments/assets/8f5d03cc-54a5-426b-8428-c8b11f4ccf11

### The C source view

The C source view panel (on the left) shows reconstructed C source lines.

A raw verifier log might contain source line information, and bpfvv attempts to reconstruct the source code and associate it with the instructions.
Here is how it looks in the raw log:
```
1800: R1=scalar() R10=fp0
; int rb_print(rbtree_t __arg_arena *rbtree) @ rbtree.bpf.c:507
1800: (b4) w0 = -22                   ; R0_w=0xffffffea
; if (unlikely(!rbtree)) @ rbtree.bpf.c:517
1801: (15) if r1 == 0x0 goto pc+132   ; R1=scalar(umin=1)
```

The original source code is not available in the log of course. So bpfvv doesn't have enough information to even format it properly.

However, it allows you to see a rough correspondence between BPF instructions and the original C source code.

Be aware though that this information is noisy and may be inaccurate, since it reached the visualizer through a long way:
* the compiler generated DWARF with line info, which is already "best-effort"
* DWARF was transformed into BTF with line data
* BTF was processed by the verifier and available information was dumped interleaved with the program trace

https://github.com/user-attachments/assets/3e8c52f0-3823-4d5f-abbd-f7c2d8e31d19

### The bottom panel

The bottom panel shows original log text for the selected line and for the current hovered line.
It is sometimes useful to check the source of the information displayed by the visualizer.


## Not frequently asked questions

### What exactly do "read" and "written" values means here?

Here is a couple of trivial examples:
* `r1 = 0` this is a write to `r1`
* `r2 = r3` this is a read of `r3` and write to `r2`
* `r2 += 1` this is a read of `r2` and write to `r2`, aka an update

Here is a couple of more complicated examples:
* `*(u64 *)(r10 -32) = r1` this is a read of `r1` and a write to `fp-32`
  * `r10` is effectively constant[^3], as it is always a pointer to the top of a BPF stack frame, so stores to `r10-offset` are writes to the stack slots, identified by `fp-off` or `fp[frame]-off` in the visualizer
* `r1 = *(u64 *)(r2 -8)` this is a write to `r1` and a read of `r2`, however it may also be a read of the stack, if `r2` happens to contain a pointer to the stack slot 

Most instructions have intrinsic "read" and "write" sets, defined by its semantics. However context also matters, as you can see from the last example.

The visualizer takes into account a few important things, when determining data dependencies:
* it is aware of scratch and callee-saved register semantics of subprogram/helper calls
* it is aware of the stack frames: we enter new stack memory in a subprogram, and pop back on exit
* it is aware of indirect stack slot access and basic pointer arithmetic

### Side effects?

One counterintuitive thing about data dependencies in the context of BPF verification is that the instructions which don't do any arithmetic or memory stores can still change the progam state.

Remember, we are looking at the BPF verifier log.
The BPF verifier simulates the execution of a program, which requires maintaining a virtual state of the program.
This means that whenever the verifier gains some knowledge about a value (which is not necesarily an intrinsic write instruction), it will update the program state.

For example, when processing conditional jumps such as `if (r2 == 0) goto pc+6`,
the verifier usually explores both branches. But in both cases it gained information
about `r2`: it's either 0 or not. And so while there was no explicit write into r2,
it's value is known (and has changed) after the jump instruction, when you look at 
it in the verifier log.

https://github.com/user-attachments/assets/94d271e2-f033-439b-8554-d9f8a66b4143

### What if we write to memory or a BPF arena?

Currently non-stack memory access is a "black hole" from the point of
view of use-def analysis in this app. The reason is that it's
impossible to be sure what is the value of a memory slot between
stores and loads from it, because it may have been written outside of
BPF program, and because it's not always simple to identify a specific
memory slot.

So, when you see a store/load instruction to/from something like
`*(u32 *)(r8 +0)` you can only click on r8 to check it's
dependencies. If you see `*(u32 *)(r8 +0)` down the instruction
stream, even if value of r8 hasn't changed, the analysis does not
recognize these slots as "the same".

**Unless** `r8` contains a pointer to a stack slot.
In that case you can click both on the register to see where its value came from, and on the dereference expression to see where the stack slot value came from.

https://github.com/user-attachments/assets/f345ec63-b91d-411c-b1d2-3890ed8f1c99

### An instruction is highlighted as dependency, but I don't understand why. Is that a bug?

Probably not[^4].

The visualizer has a single source of information: the verifier log.
The log contains two streams of information: the instructions and the associated state change, as reported by the verifier.

Some of the state that the visualizer computes is derived from the instructions themselves.
However, the state reported by the verifier always takes precedence.

Since the values in the context of the visualizer are just strings, if the verifier reported a slightly different string, we treat it as an update.
For example, you might see something like this:
```
r8	ptr_or_null_node_data(id=9,ref_obj_id=9,off=16) -> ptr_node_data(ref_obj_id=9,off=16)
```

The verifier reported a different value, and that's what bpfvv shows.

## Footnotes

[^1]: `BPF_LOG_LEVEL2` can be parsed, however since level 2 log contains 
all states of the BPF program explored by the verifier, and the app does 
not distinguish between them (yet), the accumulated state at a particular 
log line is likely to be wrong. Also, log level 2 is usually quite big, so
the browser will not be happy to render it.

[^2]: https://en.wikipedia.org/wiki/Use-define_chain

[^3]: https://docs.cilium.io/en/latest/reference-guides/bpf/architecture/

[^4]: But maybe yes... If you suspect a bug, please report.
