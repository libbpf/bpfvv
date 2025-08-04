export const SAMPLE_LOG_DATA_1 = `
          0: (18) r1 = 0x11                     ; R1_w=17
2: (b7) r2 = 0                        ; R2_w=0
3: (85) call bpf_obj_new_impl#54651   ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
4: (bf) r6 = r0                       ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) R6_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
5: (b7) r7 = 1                        ; R7_w=1 refs=2
; if (!n) @ rbtree.c:199
6: (15) if r6 == 0x0 goto pc+104      ; R6_w=ptr_node_data(ref_obj_id=2) refs=2
7: (b7) r1 = 4                        ; R1_w=4 ref
            `;

export const SAMPLE_LOG_DATA_2 = `PROCESSING rbtree.bpf.o/rbtree_first_and_remove, DURATION US: 842, VERDICT: failure, VERIFIER LOG:
arg#0 reference type('UNKNOWN ') size cannot be determined: -22
0: R1=ctx() R10=fp0
; n = bpf_obj_new(typeof(*n)); @ rbtree.c:198
0: (18) r1 = 0x11                     ; R1_w=17
2: (b7) r2 = 0                        ; R2_w=0
3: (85) call bpf_obj_new_impl#54651   ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
4: (bf) r6 = r0                       ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) R6_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
5: (b7) r7 = 1                        ; R7_w=1 refs=2
; if (!n) @ rbtree.c:199
6: (15) if r6 == 0x0 goto pc+104      ; R6_w=ptr_node_data(ref_obj_id=2) refs=2
7: (b7) r1 = 4                        ; R1_w=4 refs=2
; n->data = 4; @ rbtree.c:202
8: (7b) *(u64 *)(r6 +8) = r1          ; R1_w=4 R6_w=ptr_node_data(ref_obj_id=2) refs=2
9: (b7) r1 = 3                        ; R1_w=3 refs=2
; n->key = 3; @ rbtree.c:201
10: (7b) *(u64 *)(r6 +0) = r1         ; R1_w=3 R6_w=ptr_node_data(ref_obj_id=2) refs=2
; m = bpf_obj_new(typeof(*m)); @ rbtree.c:204
11: (18) r1 = 0x11                    ; R1_w=17 refs=2
13: (b7) r2 = 0                       ; R2_w=0 refs=2
14: (85) call bpf_obj_new_impl#54651          ; R0=ptr_or_null_node_data(id=4,ref_obj_id=4) refs=2,4
15: (bf) r8 = r0                      ; R0=ptr_or_null_node_data(id=4,ref_obj_id=4) R8_w=ptr_or_null_node_data(id=4,ref_obj_id=4) refs=2,4
; if (!m) @ rbtree.c:205
16: (15) if r8 == 0x0 goto pc+52      ; R8_w=ptr_node_data(ref_obj_id=4) refs=2,4
17: (b7) r1 = 6                       ; R1_w=6 refs=2,4
; m->data = 6; @ rbtree.c:208
18: (7b) *(u64 *)(r8 +8) = r1         ; R1_w=6 R8_w=ptr_node_data(ref_obj_id=4) refs=2,4
19: (b7) r1 = 5                       ; R1_w=5 refs=2,4
; m->key = 5; @ rbtree.c:207
20: (7b) *(u64 *)(r8 +0) = r1         ; R1_w=5 R8_w=ptr_node_data(ref_obj_id=4) refs=2,4
; o = bpf_obj_new(typeof(*o)); @ rbtree.c:210
21: (18) r1 = 0x11                    ; R1_w=17 refs=2,4
23: (b7) r2 = 0                       ; R2_w=0 refs=2,4
24: (85) call bpf_obj_new_impl#54651          ; R0=ptr_or_null_node_data(id=6,ref_obj_id=6) refs=2,4,6
; if (!o) @ rbtree.c:211
25: (15) if r0 == 0x0 goto pc+79      ; R0=ptr_node_data(ref_obj_id=6) refs=2,4,6
26: (b7) r7 = 2                       ; R7_w=2 refs=2,4,6
; o->data = 2; @ rbtree.c:214
27: (7b) *(u64 *)(r0 +8) = r7         ; R0=ptr_node_data(ref_obj_id=6) R7_w=2 refs=2,4,6
28: (b7) r1 = 1                       ; R1_w=1 refs=2,4,6
; o->key = 1; @ rbtree.c:213
29: (7b) *(u64 *)(r0 +0) = r1         ; R0=ptr_node_data(ref_obj_id=6) R1_w=1 refs=2,4,6
; bpf_spin_lock(&glock); @ rbtree.c:216
30: (18) r1 = 0xff434b28008e3de8      ; R1_w=map_value(map=.data.A,ks=4,vs=72,off=16) refs=2,4,6
32: (bf) r9 = r0                      ; R0=ptr_node_data(ref_obj_id=6) R9_w=ptr_node_data(ref_obj_id=6) refs=2,4,6
33: (85) call bpf_spin_lock#93        ; refs=2,4,6
; bpf_rbtree_add(&groot, &n->node, less); @ rbtree.c:217
34: (bf) r2 = r6                      ; R2_w=ptr_node_data(ref_obj_id=2) R6=ptr_node_data(ref_obj_id=2) refs=2,4,6
35: (07) r2 += 16                     ; R2_w=ptr_node_data(ref_obj_id=2,off=16) refs=2,4,6
36: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72) refs=2,4,6
38: (18) r3 = 0x53                    ; R3_w=func() refs=2,4,6
40: (b7) r4 = 0                       ; R4_w=0 refs=2,4,6
41: (b7) r5 = 0                       ; R5=0 refs=2,4,6
42: (85) call bpf_rbtree_add_impl#54894       ; R0_w=scalar() R6=ptr_node_data(non_own_ref) R7=2 R8=ptr_node_data(ref_obj_id=4) R9=ptr_node_data(ref_obj_id=6) R10=fp0 refs=4,6
; bpf_rbtree_add(&groot, &m->node, less); @ rbtree.c:218
43: (07) r8 += 16                     ; R8_w=ptr_node_data(ref_obj_id=4,off=16) refs=4,6
44: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72) refs=4,6
46: (bf) r2 = r8                      ; R2_w=ptr_node_data(ref_obj_id=4,off=16) R8_w=ptr_node_data(ref_obj_id=4,off=16) refs=4,6
47: (18) r3 = 0x4a                    ; R3_w=func() refs=4,6
49: (b7) r4 = 0                       ; R4_w=0 refs=4,6
50: (b7) r5 = 0                       ; R5=0 refs=4,6
51: (85) call bpf_rbtree_add_impl#54894       ; R0_w=scalar() R6=ptr_node_data(non_own_ref) R7=2 R8=ptr_node_data(non_own_ref,off=16) R9=ptr_node_data(ref_obj_id=6) R10=fp0 refs=6
; bpf_rbtree_add(&groot, &o->node, less); @ rbtree.c:219
52: (07) r9 += 16                     ; R9_w=ptr_node_data(ref_obj_id=6,off=16) refs=6
53: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72) refs=6
55: (bf) r2 = r9                      ; R2_w=ptr_node_data(ref_obj_id=6,off=16) R9_w=ptr_node_data(ref_obj_id=6,off=16) refs=6
56: (18) r3 = 0x41                    ; R3_w=func() refs=6
58: (b7) r4 = 0                       ; R4_w=0 refs=6
59: (b7) r5 = 0                       ; R5=0 refs=6
60: (85) call bpf_rbtree_add_impl#54894       ; R0_w=scalar() R6=ptr_node_data(non_own_ref) R7=2 R8=ptr_node_data(non_own_ref,off=16) R9=ptr_node_data(non_own_ref,off=16) R10=fp0
; res = bpf_rbtree_first(&groot); @ rbtree.c:221
61: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72)
63: (85) call bpf_rbtree_first#54897          ; R0_w=ptr_or_null_node_data(id=7,non_own_ref,off=16)
; if (!res) { @ rbtree.c:222
64: (55) if r0 != 0x0 goto pc+6 71: R0=ptr_node_data(non_own_ref,off=16) R6=ptr_node_data(non_own_ref) R7=2 R8=ptr_node_data(non_own_ref,off=16) R9=ptr_node_data(non_own_ref,off=16) R10=fp0
; first_data[0] = o->data; @ rbtree.c:228
71: (79) r1 = *(u64 *)(r0 -8)         ; R0=ptr_node_data(non_own_ref,off=16) R1_w=scalar()
72: (18) r2 = 0xff6f3b1a00e97010      ; R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=16)
74: (7b) *(u64 *)(r2 +0) = r1         ; R1_w=scalar() R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=16)
; res = bpf_rbtree_remove(&groot, &o->node); @ rbtree.c:230
75: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72)
77: (bf) r2 = r0                      ; R0=ptr_node_data(non_own_ref,off=16) R2_w=ptr_node_data(non_own_ref,off=16)
78: (85) call bpf_rbtree_remove#54900         ; R0_w=ptr_or_null_node_data(id=9,ref_obj_id=9,off=16)
79: (bf) r8 = r0                      ; R0_w=ptr_or_null_node_data(id=9,ref_obj_id=9,off=16) R8_w=ptr_or_null_node_data(id=9,ref_obj_id=9,off=16)
; bpf_spin_unlock(&glock); @ rbtree.c:231
80: (18) r1 = 0xff434b28008e3de8      ; R1_w=map_value(map=.data.A,ks=4,vs=72,off=16)
82: (85) call bpf_spin_unlock#94      ; refs=9
83: (b7) r7 = 5                       ; R7_w=5 refs=9
; if (!res) @ rbtree.c:233
84: (15) if r8 == 0x0 goto pc+26      ; R8=ptr_node_data(ref_obj_id=9,off=16) refs=9
; removed_key = o->key; @ rbtree.c:237
85: (79) r1 = *(u64 *)(r8 -16)        ; R1_w=scalar() R8=ptr_node_data(ref_obj_id=9,off=16) refs=9
86: (18) r2 = 0xff6f3b1a00e97008      ; R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=8) refs=9
88: (7b) *(u64 *)(r2 +0) = r1         ; R1_w=scalar() R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=8) refs=9
; o = container_of(res, struct node_data, node); @ rbtree.c:236
89: (07) r8 += -16                    ; R8_w=ptr_node_data(ref_obj_id=9) refs=9
; bpf_obj_drop(o); @ rbtree.c:238
90: (bf) r1 = r8                      ; R1_w=ptr_node_data(ref_obj_id=9) R8_w=ptr_node_data(ref_obj_id=9) refs=9
91: (b7) r2 = 0                       ; R2_w=0 refs=9
92: (85) call bpf_obj_drop_impl#54635         ;
; bpf_spin_lock(&glock); @ rbtree.c:240
93: (18) r1 = 0xff434b28008e3de8      ; R1_w=map_value(map=.data.A,ks=4,vs=72,off=16)
95: (85) call bpf_spin_lock#93        ;
; res = bpf_rbtree_first(&groot); @ rbtree.c:241
96: (18) r1 = 0xff434b28008e3dd8      ; R1_w=map_value(map=.data.A,ks=4,vs=72)
98: (85) call bpf_rbtree_first#54897          ; R0_w=ptr_or_null_node_data(id=10,non_own_ref,off=16)
; if (!res) { @ rbtree.c:242
99: (55) if r0 != 0x0 goto pc+13 113: R0_w=ptr_node_data(non_own_ref,off=16) R6=scalar() R7=5 R8=scalar() R9=scalar() R10=fp0
; first_data[1] = o->data; @ rbtree.c:248
113: (79) r1 = *(u64 *)(r0 -8)        ; R0_w=ptr_node_data(non_own_ref,off=16) R1_w=scalar()
114: (18) r2 = 0xff6f3b1a00e97010     ; R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=16)
116: (7b) *(u64 *)(r2 +8) = r1        ; R1_w=scalar() R2_w=map_value(map=rbtree.data,ks=4,vs=32,off=16)
; bpf_spin_unlock(&glock); @ rbtree.c:249
117: (18) r1 = 0xff434b28008e3de8     ; R1_w=map_value(map=.data.A,ks=4,vs=72,off=16)
119: (85) call bpf_spin_unlock#94     ;
; return n->data; @ rbtree.c:251
120: (79) r7 = *(u64 *)(r6 +8)
R6 invalid mem access 'scalar'
verification time 842 usec
stack depth 0+0
processed 94 insns (limit 1000000) max_states_per_insn 0 total_states 10 peak_states 10 mark_read 6
`;
