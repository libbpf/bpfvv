# How to use bpfvv

> [!WARNING]
> The bpfvv app is in early stages of development, and you should expect
> bugs, UI inconveniences and significant changes from week to week.
>
> If you're working with BPF and you think this tool (or a better
> version of it) would be useful, feel free to use it and don't be shy
> to report issues and request features via github. Thanks!

Go here: https://libbpf.github.io/bpfvv/

Load a log by pasting it into the text box or choosing a file.

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

There are two main views of the program:
* (on the left) formatted log, instruction stream
* (on the right) program state: known values of registers and stack slots
<img width="1306" alt="Screenshot 2025-04-25 at 4 19 21 PM" src="https://github.com/user-attachments/assets/ccd9337a-14b0-4c13-afcc-cdfc1b2d46e5" />

## What's in the log

Notice that the displayed text has different content than the raw log.
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
23: (85) call bpf_map_lookup_elem#1   ; R0=map_value_or_null(id=3,map=eventmap,ks=4,vs=2452)
```

It is displayed like this:
```
r0 = call bpf_map_lookup_elem#1(r1, r2, r3, r4, r5)
```

Notice also that the lines not recognized by the parser are greyed
out. If you notice an unrecognized instruction, please submit a bug
report.

### Subprogram calls

When there is a subprogram call in the log instruction stream, the 
stack frames are tracked by the app when computing state. When subprogram
call is detected there is indentation and comments in the main log view to
visualize it.

<img width="1211" alt="Screenshot 2025-04-25 at 4 35 14 PM" src="https://github.com/user-attachments/assets/3b53abaf-609e-4d6f-b28b-a977016a00c0" />


## What can you do?

### Step through the instruction stream

The most basic feature of the visualizer is "stepping" through the
log, similar to what you'd do in a debugger.

You can select a line by clicking on it, or by navigating with arrows
(you can also use pgup, pgdown, home and end). The selected line has
light-blue background.

When a line is selected, current state of known values is displayed in
the panel on the right. By moving the selected line up/down the log,
you can see how the values change with each instruction.

In the "state panel", the values that are written by selected
instruction are marked with light-red background and the previous
value is also often displayed, for example:
```
r6	scalar(id=1) -> 0
```
Means that current instruction changes the value of `r6` from
`scalar(id=1)` to `0`.

The values that are read by current instruction have light-green
background.

Note that for "update" instructions (such as `r1 += 8`), the slot
will be marked as written.

#### Sometimes a value of a slot has changed, but it's not highlighted as a write. Is that a bug?

Currently the visualizer only considers writes derived from the instructions
themselves. For example, `r1 = r2` is a write by definition, or a call would
scratch some registers.

But remember that we are looking at the BPF verifier log. BPF verifier
simulates execution of a program, which requires maintaining and continuously
updating a virtual state of the program. This means that whenever the verifier
gains some knowledge about a value (which is not necesarily a write instruction),
it will update it.

For example when processing conditional jumps such as `if (r2 == 0) goto pc+6`,
the verifier usually explores both branches. But in both cases it gained information
about r2: it's either 0 or not. And so while there was no explicit write into r2,
it's value is known (and has changed) after the jump instruction, when you look at 
it in the verifier log.

Going forward the visualizer will likely treat all value updates as writes,
as it is useful to know at what point verifier inferred a particular value. 

### View data dependencies

The app computes a use-def analysis [^2] and you can interactively
view dependencies between the instructions.

The concept is simple. Every instruction may read some slots
(registers, stack, memory) and write to others. Knowing these sets
(verifier log contains enough information to compute them), it is
possible to determine for a slot used by current instruction, where
its value came from (from what slot in what instruction).

You can view the results of this analysis by clicking on some
instruction operands (registers and stack slots).

The selected slot is identified by a box. This selection changes the
log view, greying out "irrelevant" instructions, and leaving only
data-dependent instructions in the foreground.
<img width="762" alt="Screenshot 2025-04-25 at 4 50 11 PM" src="https://github.com/user-attachments/assets/7cfc0109-6c8c-4a94-a9b5-37af9a4e877a" />

#### What's clickable?

Registers r0-r9 and explicit stack accesses such as `*(u32 *)(r10 -8)`.

r10 (stack frame pointer) is not clickable because it's effectively a
constant [^3].

Note that the stack slots may be accessed indirectly: if say `r6 = fp-64`
and then you do `*(u32 *)(r6 -8)` it's equivalent to `*(u32 *)(r10 -72)`.
The visualizer does not show such dependencies (yet). Although state values
are tracked correctly.

#### How deep is the displayed dependency chain?

It depends, but usually not deep.

The problem with showing all dependencies is that it's too much
information, which renders it useless.

Currently the upstream instruction is highlighted if it's an
unambiguous dependency. For example:
```
42: r1 = 13
43: r7 = 0
44: r2 = r1
```

Instruction 42 is an unambiguous dependency of instruction 44, because
r1 is the only read slot, and there were no modifications to it along
the way.

All such direct dependencies up the chain are shown.

However, when more than one value is read in the upstream instruction,
the UI will stop highlighting at that instruction.

Consider an example:
```
42: r1 = r2
43: r3 = *(u32 *)(r10 -16)
44: r1 += r3
45: *(u32 *)(r10 -64) = r1
```

If you select `r1` at instruction 45, only instruction 44 will be
highlighted, even though 42 and 43 are its transitive dependencies
(`r1 += r3` reads both `r1` and `r3`).

The reason for this UI behavior is that showing all dependencies (both
r1 and r3 and in turn all their dependencies) may very quickly cover
most of the instructions. This is especially true for call
instructions, which read up to 5 registers.

On the other hand the app can't know what the user is looking for, and
there is no point in guessing. So, for an instruction like `r1 += r3`,
the user must choose specific operand (r1 or r3 in this case) to
expand the dependency chain further.

#### Note on memory stores and loads

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


## Footnotes

[^1]: `BPF_LOG_LEVEL2` can be parsed, however since level 2 log contains 
all states of the BPF program explored by the verifier, and the app does 
not distinguish between them (yet), the accumulated state at a particular 
log line is likely to be wrong. Also, log level 2 is usually quite big, so
the browser will not be happy to render it.

[^2]: https://en.wikipedia.org/wiki/Use-define_chain

[^3]: https://docs.cilium.io/en/latest/reference-guides/bpf/architecture/
