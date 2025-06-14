import { describe, it, expect } from 'vitest';
import { parseLine, parseOpcodeIns, parseBpfStateExprs, ParsedLineType, BpfJmpKind } from '../parser';

const AluInstructionSample = '0: (b7) r2 = 1                        ; R2_w=1';
const BPFStateExprSample = '; R2_w=1 R10=fp0 fp-24_w=1';
const MemoryWriteSample = '1: (7b) *(u64 *)(r10 -24) = r2' + BPFStateExprSample;
const CallInstructionSample = '(85) call bpf_probe_read_user#112';
const CallLineSample = '7: ' + CallInstructionSample;

describe('parser', () => {
  it('parses ALU instructions with state expressions', () => {
    const parsed = parseLine(AluInstructionSample);
    expect(parsed.type).toBe(ParsedLineType.INSTRUCTION);
    expect(parsed.bpfIns?.pc).toBe(0);
    expect(parsed.bpfIns?.alu?.operator).toBe('=');
    expect(parsed.bpfIns?.writes).toContain('r2');
    expect(parsed.bpfStateExprs?.[0]).toMatchObject({ id: 'r2', value: '1' });
  });

  it('parses memory write instruction', () => {
    const parsed = parseLine(MemoryWriteSample);
    expect(parsed.type).toBe(ParsedLineType.INSTRUCTION);
    expect(parsed.bpfIns?.pc).toBe(1);
    expect(parsed.bpfIns?.alu?.dst.id).toBe('fp-24');
    expect(parsed.bpfIns?.alu?.src.id).toBe('r2');
    expect(parsed.bpfStateExprs?.length).toBe(3);
  });

  it('parses call instruction via parseOpcodeIns', () => {
    const { ins, rest } = parseOpcodeIns(CallInstructionSample, 7);
    expect(rest).toBe('');
    expect(ins.jmp?.kind).toBe(BpfJmpKind.HELPER_CALL);
    expect(ins.jmp?.target).toBe('bpf_probe_read_user#112');
    expect(ins.reads).toContain('r1');
    expect(ins.writes).toContain('r0');
  });

  it('parses call line with parseLine', () => {
    const parsed = parseLine(CallLineSample);
    expect(parsed.bpfIns?.pc).toBe(7);
    expect(parsed.bpfIns?.jmp?.kind).toBe(BpfJmpKind.HELPER_CALL);
  });

  it('parses verifier state expressions', () => {
    const { exprs, rest } = parseBpfStateExprs(BPFStateExprSample);
    expect(rest).toBe('');
    expect(exprs.map(e => e.id)).toEqual(['r2', 'r10', 'fp-24']);
  });
});
