import { BpfState } from "./analyzer";
import { CSourceRow } from "./components";
import {
  BpfInstruction,
  BpfInstructionKind,
  BpfJmpKind,
  ParsedLine,
  ParsedLineType,
  parseStackSlotId,
  StackSlotId,
} from "./parser";

export async function fetchLogFromUrl(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error("Error fetching log:", error);
    return null;
  }
}

export function normalIdx(idx: number, linesLen: number): number {
  return Math.min(Math.max(0, idx), linesLen - 1);
}

export function siblingInsLine(
  insLines: ParsedLine[],
  idx: number,
  delta: number,
): number {
  // if delta is 1 we are looking for the next instruction
  // if delta is -1 we are looking for the previous instruction
  const n = insLines.length;
  for (let i = normalIdx(idx + delta, n); 0 <= i && i < n; i += delta) {
    const line = insLines[i];
    if (line.type === ParsedLineType.INSTRUCTION) {
      return i;
    }
  }
  return normalIdx(idx, n);
}

export function siblingCLine(
  cLines: CSourceRow[],
  idx: number,
  delta: number,
): string {
  let cLineId = "";
  let nextVisibleIdx = idx;
  while (true) {
    nextVisibleIdx += delta;
    const cLine = cLines[nextVisibleIdx];
    if (cLine.type === "c_line" && !cLine.ignore) {
      cLineId = cLine.sourceId;
      break;
    }
    if (nextVisibleIdx <= 0 || nextVisibleIdx >= cLines.length - 1) {
      break;
    }
  }

  return cLineId;
}

export function insEntersNewFrame(ins: BpfInstruction): boolean {
  if (ins.kind === BpfInstructionKind.JMP) {
    switch (ins.jmpKind) {
      case BpfJmpKind.SUBPROGRAM_CALL:
        return true;
      case BpfJmpKind.HELPER_CALL:
        if (ins.target.startsWith("bpf_loop#")) return true;
    }
  }
  return false;
}

export function foreachStackSlot(
  currentFrame: number,
  func: (id: string) => void,
) {
  // current stack (no frame qualifier)
  for (let i = 0; i <= 512; i += 1) {
    const id = `fp-${i}`;
    func(id);
  }

  // nested stacks, e.g. fp[1]-16
  for (let frame = currentFrame - 1; frame >= 0; frame--) {
    for (let i = 0; i <= 512; i += 1) {
      const id = `fp[${frame}]-${i}`;
      func(id);
    }
  }
}

function normalMemSlotId(
  stackSlotId: StackSlotId,
  offset: number,
  frame: number,
): string {
  if (stackSlotId.frame !== undefined) {
    return `fp[${stackSlotId.frame}]${offset}`;
  } else {
    return `fp[${frame}]${offset}`;
  }
}

export function stackSlotIdFromDisplayId(
  displayId: string,
  frame: number,
): string {
  const stackSlotId = parseStackSlotId(displayId);
  if (stackSlotId) {
    return normalMemSlotId(stackSlotId, stackSlotId.offset, frame);
  }
  return displayId;
}

export function stackSlotIdForIndirectAccess(
  bpfState: BpfState,
  srcMemRef: { reg: string; offset: number } | undefined,
): string | null {
  if (!srcMemRef) {
    return null;
  }
  const regValue = bpfState.values.get(srcMemRef.reg);
  const stackSlotId = regValue ? parseStackSlotId(regValue.value) : null;
  if (stackSlotId === null) {
    return null;
  }
  const totalOffset = stackSlotId.offset + srcMemRef.offset;
  return normalMemSlotId(stackSlotId, totalOffset, bpfState.frame);
}

/* This class is essentially a string map, except it normalizes stack slot access ids
 * to a canonical form of `fp[${frame}]${offset}`
 * If [<frame>] is absent, the key refers to the current frame.
 */
export class BpfMemSlotMap<T> extends Map<string, T> {
  currentFrame: number;
  constructor(currentFrame: number) {
    super();
    this.currentFrame = currentFrame;
  }

  setFrame(frame: number): void {
    this.currentFrame = frame;
  }

  get(key: string): T | undefined {
    return super.get(stackSlotIdFromDisplayId(key, this.currentFrame));
  }

  set(key: string, value: T): this {
    return super.set(stackSlotIdFromDisplayId(key, this.currentFrame), value);
  }

  has(key: string): boolean {
    return super.has(stackSlotIdFromDisplayId(key, this.currentFrame));
  }
}
