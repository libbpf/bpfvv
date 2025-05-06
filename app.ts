import {
    BPF_CALLEE_SAVED_REGS,
    BPF_SCRATCH_REGS,
    BpfJmpCode,
    BpfJmpKind,
    BpfOperand,
    OperandType,
    ParsedLine,
    ParsedLineType,
    parseLine
} from './parser.js';

import BPF_HELPERS_JSON from './bpf-helpers.json' with { type: "json" };

export enum Effect {
    NONE = "NONE",
    READ = "READ",
    WRITE = "WRITE",
    UPDATE = "UPDATE", // read then write, e.g. r0 += 1
}

type BpfValue = {
    value: string;
    effect: Effect;
}

const makeValue = (value: string, effect: Effect = Effect.NONE): BpfValue => {
    // @Hack display fp0 as fp-0
    if (value === 'fp0')
        value = 'fp-0';
    return { value, effect };
}

type BpfState = {
    values: Map<string, BpfValue>;
    lastKnownWrites: Map<string, number>;
    frame: number;
    idx: number;
    pc: number;
}

const initialBpfState = (): BpfState => {
    let values = new Map<string, BpfValue>();
    for (let i = 0; i < 10; i++) {
        values.set(`r${i}`, null);
    }
    values.set('r1', makeValue('ctx()'));
    values.set('r10', makeValue('fp0'));
    let lastKnownWrites = new Map<string, number>();
    lastKnownWrites.set('r1', 0);
    lastKnownWrites.set('r10', 0);
    return {
        values,
        lastKnownWrites,
        frame: 0,
        idx: 0,
        pc: 0,
     };
}

const copyBpfState = (state: BpfState): BpfState => {
    let values = new Map<string, BpfValue>();
    for (const [key, val] of state.values.entries()) {
        // Don't copy the effect, only the value
        if (val?.value)
            values.set(key, { value: val.value, effect: Effect.NONE });
    }
    let lastKnownWrites = new Map<string, number>();
    for (const [key, val] of state.lastKnownWrites.entries()) {
        lastKnownWrites.set(key, val);
    }
    return {
        values,
        lastKnownWrites,
        frame: state.frame,
        idx: state.idx,
        pc: state.pc
    };
}

// The stack of saved BpfStates, only needed while we are loading the log
const SAVED_BPF_STATES : BpfState[] = [];

const pushStackFrame = (state: BpfState): BpfState => {
    // In a new stack frame we only copy the scratch (argument) registers
    // Everything else is cleared
    SAVED_BPF_STATES.push(copyBpfState(state));

    let values = new Map<string, BpfValue>();
    for (const r of BPF_SCRATCH_REGS) {
        const val = state.values.get(r)?.value;
        values.set(r, { value: val, effect: Effect.READ });
    }
    for (const r of ['r0', ...BPF_CALLEE_SAVED_REGS]) {
        values.set(r, { value: '', effect: Effect.WRITE });
    }
    values.set('r10', makeValue('fp0'));

    let lastKnownWrites = new Map<string, number>();
    for (const r of BPF_SCRATCH_REGS) {
        lastKnownWrites.set(r, state.lastKnownWrites.get(r));
    }

    return {
        values,
        lastKnownWrites,
        frame: state.frame + 1,
        idx: state.idx,
        pc: state.pc
    };
}

const popStackFrame = (exitingState: BpfState): BpfState => {
    // input log might be incomplete
    // if exit is encountered before any subprogram calls
    // return a fresh stack frame
    if (SAVED_BPF_STATES.length == 0) {
        return initialBpfState();
    }
    // no need to copy the full state here, it was copied on push
    const state = SAVED_BPF_STATES.pop();
    for (const r of BPF_SCRATCH_REGS) {
        state.values.set(r, { value: '', effect: Effect.WRITE });
        state.lastKnownWrites.delete(r);
    }
    // copy r0 info from the exiting state
    const val = exitingState.values.get('r0')?.value || '';
    state.values.set('r0', { value: val, effect: Effect.NONE });
    state.lastKnownWrites.set('r0', exitingState.lastKnownWrites.get('r0'));
    return state;
}

const nextBpfState = (state: BpfState, line: ParsedLine): BpfState => {
    if (line.type !== ParsedLineType.INSTRUCTION)
        return state;

    const setIdxAndPc = (bpfState: BpfState) => {
        bpfState.idx = line.idx;
        bpfState.pc = line.bpfIns?.pc;
    }

    let newState : BpfState;
    switch (line.bpfIns?.jmp?.kind) {
        case BpfJmpKind.BPF2BPF_CALL:
            newState = pushStackFrame(state);
            setIdxAndPc(newState);
            return newState;
        case BpfJmpKind.EXIT:
            newState = popStackFrame(state);
            setIdxAndPc(newState);
            return newState;
        default:
            break;
    }

    newState = copyBpfState(state);
    let effects = new Map<string, Effect>();
    for (const id of line.bpfIns?.reads || []) {
        effects.set(id, Effect.READ);
    }
    for (const id of line.bpfIns?.writes || []) {
        if (effects.has(id))
            effects.set(id, Effect.UPDATE);
        else
            effects.set(id, Effect.WRITE);
        newState.values.set(id, makeValue('', effects.get(id)));
        newState.lastKnownWrites.set(id, line.idx);
    }

    // verifier reported values
    for (const expr of line.bpfStateExprs) {
        let effect = effects.get(expr.id) || Effect.NONE;
        newState.values.set(expr.id, makeValue(expr.value, effect));
    }

    setIdxAndPc(newState);
    return newState;
}

type AppState = {
    fileBlob: Blob;
    lines: ParsedLine[];
    bpfStates: BpfState[];
    selectedLineIdx: number;
    selectedMemSlotId: string; // 'r1', 'fp-244' etc.
    memSlotDependencies: Set<number>; // set of idx
}

const getUrlParameter = (param: string): string | null => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

const fetchLogFromUrl = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return '';
        }
        return await response.text();
    } catch (error) {
        console.error('Error fetching log:', error);
        return '';
    }
};

const createApp = (url: string) => {

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const loadStatus = document.getElementById('load-status') as HTMLElement;

    const gotoStartButton = document.getElementById('goto-start') as HTMLButtonElement;
    const gotoLineInput = document.getElementById('goto-line') as HTMLInputElement;
    const gotoLineButton = document.getElementById('goto-line-btn') as HTMLButtonElement;
    const gotoEndButton = document.getElementById('goto-end') as HTMLButtonElement;

    const inputText = document.getElementById('input-text') as HTMLTextAreaElement;
    const mainContent = document.getElementById('main-content') as HTMLElement;
    const lineNumbersPc = document.getElementById('line-numbers-pc') as HTMLElement;
    const lineNumbersIdx = document.getElementById('line-numbers-idx') as HTMLElement;

    const logContainer = document.getElementById('log-container') as HTMLElement;
    const logLines = document.getElementById('formatted-log-lines') as HTMLElement;

    const exampleLink = document.getElementById('example-link') as HTMLAnchorElement;
    if (exampleLink) {
        const exampleLogUrl = 'https://gist.githubusercontent.com/theihor/e0002c119414e6b40e2192bd7ced01b1/raw/866bcc155c2ce848dcd4bc7fd043a97f39a2d370/gistfile1.txt';
        exampleLink.href = `${window.location.pathname}?url=${exampleLogUrl}`;
    }

    const state: AppState = {
        fileBlob: new Blob([]),
        lines: [],
        bpfStates: [],
        selectedLineIdx: 0,
        selectedMemSlotId: '',
        memSlotDependencies: new Set<number>(),
    };

    const buildBpfHelpersMap = async () : Promise<Map<string, any>> => {
        const map = new Map();
        for (const helper of BPF_HELPERS_JSON.helpers) {
            map.set(helper.name, helper.args)
        }
        return map;
    }

    let bpfHelpersMap = new Map();
    buildBpfHelpersMap().then(map => bpfHelpersMap = map);

    const mostRecentBpfState = (state: AppState, idx: number): { state: BpfState, idx: number } => {
        let bpfState = null;
        idx = Math.max(0, Math.min(idx, state.bpfStates.length - 1));
        for (let i = idx; i >= 0; i--) {
            bpfState = state.bpfStates[i];
            if (bpfState)
                return { state: bpfState, idx: i };
        }
        return { state: initialBpfState(), idx: 0 };
    }

    const collectMemSlotDependencies = (state: AppState, memSlotId: string): Set<number> => {
        let targetIdx = state.selectedLineIdx;
        const ins = state.lines[state.selectedLineIdx].bpfIns;
        if (!ins)
            return new Set<number>();
        // if user clicked on a mem slot that is written to,
        // then switch target to the first read slot
        if (!ins.reads.find(id => id === memSlotId)
                && ins.writes.find(id => id === memSlotId)
                && ins.reads.length > 0) {
            memSlotId = ins.reads[0];
        }
        let bpfState : BpfState = state.bpfStates[state.selectedLineIdx];
        const deps = new Set<number>();
        while (true) {
            let depIdx = bpfState.lastKnownWrites.get(memSlotId);
            if (depIdx === targetIdx) {
                // this is an Effect.UPDATE, so let's look at the previous bpfState
                const prevBpfState = state.bpfStates[targetIdx-1];
                depIdx = prevBpfState.lastKnownWrites.get(memSlotId);
            }
            if (!depIdx)
                break;
            deps.add(depIdx);
            targetIdx = depIdx;
            const depIns = state.lines[depIdx].bpfIns;
            if (!depIns?.reads || depIns.reads.length != 1)
                break;
            memSlotId = depIns.reads[0];
            bpfState = state.bpfStates[depIdx];
        }
        return deps;
    }

    const resetSelectedMemSlot = (state: AppState): void => {
        state.selectedMemSlotId = '';
        state.memSlotDependencies = new Set<number>();
    }

    const updateSelectedLineHint = (idx: number): void => {
        const hintLine = document.getElementById('hint-selected-line') as HTMLElement;
        hintLine.innerHTML = `<span style="font-weight: bold;">[selected] Raw line ${idx+1}:</span> ${state.lines[idx].raw}`;
    }

    const setSelectedLine = (idx: number, memSlotId: string = ''): void => {
        state.selectedLineIdx = normalIdx(idx);
        if (memSlotId && memSlotId !== 'MEM') {
            state.selectedMemSlotId = memSlotId;
            state.memSlotDependencies = collectMemSlotDependencies(state, memSlotId);
        } else {
            resetSelectedMemSlot(state);
        }
        updateSelectedLineHint(state.selectedLineIdx);
    }

    const handleLineClick = async (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const clickedLine = target.closest('.log-line');
        if (!clickedLine)
            return;
        const lineIndex = parseInt(clickedLine.getAttribute('line-index') || '0', 10);
        const memSlot = target.closest('.mem-slot');
        setSelectedLine(lineIndex, memSlot?.id || '');
        updateView(state);
    };

    const getTooltip = (): HTMLElement => {
        let tooltip = document.getElementById('mem-slot-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'mem-slot-tooltip';
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    const getTooltipArrow = (): HTMLElement => {
        let arrow = document.getElementById('mem-slot-tooltip-arrow');
        if (!arrow) {
            arrow = document.createElement('div');
            arrow.id = 'mem-slot-tooltip-arrow';
            document.body.appendChild(arrow);
        }
        return arrow;
    }

    const logLineMouseOver = (lineElement: HTMLElement): void => {
        const hintLine = document.getElementById('hint-hovered-line') as HTMLElement;
        if (lineElement) {
            const idx = parseInt(lineElement.getAttribute('line-index') || '0', 10);
            const content = state.lines[idx].raw;
            if (idx != state.selectedLineIdx)
                lineElement.classList.add('hovered-line');
            hintLine.innerHTML = `<span style="font-weight: bold;">Raw line ${idx+1}:</span> ${content}`;
        } else {
            hintLine.innerHTML = '<span style="color: transparent;">hint text</span>';
        }
    }

    const memSlotMouseOver = (memSlot: HTMLElement): void => {
        if (memSlot) {
            const tooltip = getTooltip();
            const arrow = getTooltipArrow();
            const idx = contentLineIdx(memSlot.closest('.log-line'));
            const displayValue = memSlotDisplayValue(state, memSlot.id, idx);
            memSlot.classList.add('hovered-mem-slot');
            if (displayValue) {
                // Text needs to be set first, so that position is calculated correctly
                tooltip.innerHTML = displayValue;
                tooltip.style.display = 'block';
                const rect = memSlot.getBoundingClientRect();
                const tooltipLeft = Math.max(0, rect.left - tooltip.offsetWidth / 2 + rect.width / 2);
                tooltip.style.left = `${tooltipLeft}px`;
                tooltip.style.top = `${rect.bottom + 5}px`;
                arrow.style.display = 'block';
                const arrowLeft = Math.max(0, rect.left + rect.width / 2);
                arrow.style.left = `${arrowLeft}px`;
                arrow.style.top = `${rect.bottom}px`;
            } else {
                tooltip.style.display = 'none';
                arrow.style.display = 'none';
            }
        }
    }

    const handleMouseOver = (e: MouseEvent): void => {
        const hoveredElement = e.target as HTMLElement;
        const logLine = hoveredElement.closest('.log-line') as HTMLElement;
        const memSlot = hoveredElement.closest('.mem-slot') as HTMLElement;
        logLineMouseOver(logLine);
        memSlotMouseOver(memSlot);
    };

    const memSlotMouseOut = (memSlot: HTMLElement): void => {
        if (memSlot) {
            memSlot.classList.remove('hovered-mem-slot');
            const tooltip = getTooltip();
            const arrow = getTooltipArrow();
            tooltip.style.display = 'none';
            arrow.style.display = 'none';
        }
    }

    const logLineMouseOut = (logLine: HTMLElement): void => {
        if (logLine)
            logLine.classList.remove('hovered-line');
    }

    const handleMouseOut = (e: MouseEvent): void => {
        const hoveredElement = e.target as HTMLElement;
        const logLine = hoveredElement.closest('.log-line') as HTMLElement;
        const memSlot = hoveredElement.closest('.mem-slot') as HTMLElement;
        logLineMouseOut(logLine);
        memSlotMouseOut(memSlot);
    };

    const LINE_HIGHLIGHT_CLASSES = [
        'normal-line',
        'selected-line',
        'ignorable-line',
        'faded-line',
        'hovered-line',
        'dependency-line'
    ];
    const setLineHighlightClass = (div: HTMLElement, highlightClass: string): void => {
        for (const cls of LINE_HIGHLIGHT_CLASSES) {
            div.classList.remove(cls);
        }
        if (highlightClass)
            div.classList.add(highlightClass);
    }

    const memSlotHtml = (line: ParsedLine, op: BpfOperand): string => {
        const start = line.raw.length + op.location.offset;
        const end = start + op.location.size;
        const memSlotString = line.raw.slice(start, end);
        switch (op.type) {
            case OperandType.REG:
            case OperandType.FP:
                return `<span class="mem-slot" id="${op.id}">${memSlotString}</span>`;
            case OperandType.MEM:
                // find register position and make a span around it
                const regStart = memSlotString.search(/r[0-9]/);
                const regEnd = regStart + 2;
                const reg = memSlotString.slice(regStart, regEnd);
                return `${memSlotString.slice(0, regStart)}<span class="mem-slot" id="${reg}">${reg}</span>${memSlotString.slice(regEnd)}`;
            default:
                return memSlotString;
        }
    }

    const regSpan = (reg: string, display: string = ''): string => {
        if (!display)
            display = reg;
        return `<span class="mem-slot" id="${reg}">${display}</span>`;
    }

    const callHtml = (line: ParsedLine): string => {
        const ins = line.bpfIns;
        let html = '';
        const start = line.raw.length + ins.location.offset;
        const end = start + ins.location.size;
        const target = ins.jmp?.target;
        const helperName = target.substring(0, target.indexOf('#'))

        if (bpfHelpersMap.has(helperName)) {
            const args = bpfHelpersMap.get(helperName);
            let i = 1;
            const href = `<a href=https://docs.ebpf.io/linux/helper-function/${helperName}/ target="_blank">${helperName}</a>`
            html += `${href}(`
            for (const arg of args) {
                if (typeof arg.name == 'string') {
                    const display = `${arg.name} = r${i}`;
                    html += `${regSpan(`r${i}`, `${display}`)}`
                } else {
                    html += `${regSpan(`r${i}`)}`
                }
                if (i < args.length)
                    html += ", "
                i += 1
            }
            html += ')'
        } else {
            const numArgs = 5;
            html += line.raw.slice(start, end);
            html += '(';
            for (let i = 1; i < 5; i++) {
                html += `${regSpan(`r${i}`)}, `;
            }
            html += `${regSpan(`r${numArgs}`)})`;
        }

        return html;
    }

    const helperCallInstructionHtml = (line: ParsedLine): string => {
        return `${regSpan("r0")} = ` + callHtml(line);
    }

    const bpf2bpfCallInstructionHtml = (line: ParsedLine, frame: number): string => {
        let html = callHtml(line);
        html += ` { ; enter new stack frame ${frame}`
        return `<b>${html}</b>`;
    }

    const jmpInstructionHtml = (line: ParsedLine): string => {
        const code = line?.bpfIns?.opcode?.code;
        if (code === BpfJmpCode.JA) {
            return `goto ${line.bpfIns.jmp.target}`;
        }
        const leftHtml = memSlotHtml(line, line.bpfIns.jmp.cond.left);
        const rightHtml = memSlotHtml(line, line.bpfIns.jmp.cond.right);
        return `if (${leftHtml} ${line.bpfIns.jmp.cond.op} ${rightHtml}) goto ${line.bpfIns.jmp.target}`;
    }

    const exitInstructionHtml = (frame: number): string => {
        return `<b>} exit ; return to stack frame ${frame}</b>`;
    }

    const indent = (s: string, depth: number): string => {
        for (let i = 0; i < depth; i++)
            s = "    " + s; // 4 spaces
        return s;
    }

    const logLineDiv = (line: ParsedLine, bpfState: BpfState): HTMLElement => {
        const div = document.createElement('div');
        if (!line?.bpfIns && !line?.bpfStateExprs)
            setLineHighlightClass(div, 'ignorable-line');
        else
            setLineHighlightClass(div, 'normal-line');
        div.classList.add('log-line');
        div.setAttribute('line-index', line.idx.toString());

        const ins = line.bpfIns;
        let html = '';
        let indentDepth = bpfState.frame;
        if (ins?.alu) {
            const dstHtml = memSlotHtml(line, ins.alu.dst);
            const srcHtml = memSlotHtml(line, ins.alu.src);
            html = `${dstHtml} ${ins.alu.operator} ${srcHtml}`;
        } else if (ins?.jmp?.kind == BpfJmpKind.BPF2BPF_CALL) {
            html = bpf2bpfCallInstructionHtml(line, bpfState.frame);
            indentDepth -= 1;
        } else if (ins?.jmp?.kind == BpfJmpKind.EXIT) {
            html = exitInstructionHtml(bpfState.frame);
        } else if (ins?.jmp?.kind == BpfJmpKind.HELPER_CALL) {
            html = helperCallInstructionHtml(line);
        } else if (ins?.jmp) {
            html = jmpInstructionHtml(line);
        } else {
            html = line.raw;
        }
        div.innerHTML = indent(html, indentDepth);
        return div;
    }

    const loadComplete = async (state: AppState): Promise<void> => {
        await Promise.all([
            updateView(state),
            updateLoadStatus(100, 100)
        ]);
        gotoEnd();
    }

    const textDiv = (text: string): HTMLElement => {
        const div = document.createElement('div');
        div.innerHTML = text;
        return div;
    }

    const loadRawLine = (state: AppState, rawLine: string) => {
        const parsedLine = parseLine(rawLine);
        const idx = state.lines.length;
        parsedLine.idx = idx;
        const bpfState = nextBpfState(mostRecentBpfState(state, idx).state, parsedLine);
        const pcText = typeof parsedLine.bpfIns?.pc === 'number' ? `${parsedLine.bpfIns.pc}:` : '\n';
        state.lines.push(parsedLine);
        state.bpfStates.push(bpfState);
        logLines.appendChild(logLineDiv(parsedLine, bpfState));
        lineNumbersPc.appendChild(textDiv(pcText));
        lineNumbersIdx.appendChild(textDiv(`${idx+1}`));
    }

    // Load and parse the file into memory from the beggining to the end
    const loadInputFile = async (state: AppState): Promise<void> => {
        const reader = state.fileBlob.stream()
                        .pipeThrough(new TextDecoderStream())
                        .getReader();
        let firstChunk = true;
        let remainder = '';
        let eof = false;
        let offset = 0;
        while (!eof) {
            let lines = [];
            const { done, value } = await reader.read();
            if (done) {
                eof = true;
                if (remainder.length > 0)
                    lines.push(remainder);
            } else {
                lines = value.split('\n');
                lines[0] = remainder + lines[0];
                if (lines.length > 1)
                    remainder = lines.pop();
                else
                    remainder = '';
            }
            lines.forEach(rawLine => {
                loadRawLine(state, rawLine);
                offset += rawLine.length + 1;
            });
            updateLoadStatus(offset + remainder.length, state.fileBlob.size);
            if (firstChunk) {
                firstChunk = false;
                updateView(state);
            }
            // This is a trick to yield control to the browser's rendering engine.
            // Otherwise the UI will wait until loadInputFile completes.
            // Note: it wasn't necessary with Blob.slice() because it yields implicitly.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        loadComplete(state);
    };

    const loadInputText = async (state: AppState, text: string): Promise<void> => {
        const lines = text.split('\n');
        lines.forEach(rawLine => {
            loadRawLine(state, rawLine);
        })
        loadComplete(state);
    };

    const updateLoadStatus = async (loaded: number, total: number): Promise<void> => {
        if (total === 0) {
            loadStatus.innerHTML = '';
            return;
        }
        const lastLine = state.lines[state.lines.length - 1];
        const percentage = 100 * loaded / total;
        loadStatus.innerHTML = `Loaded ${percentage.toFixed(0)}% (${lastLine.idx + 1} lines)`;
    };

    const contentLineIdx = (line: HTMLElement): number => {
        const idx = line?.getAttribute('line-index');
        if (!idx)
            return -1;
        return parseInt(idx, 10);
    }

    const resetSingleLineFormat = async (state: AppState, div: HTMLElement): Promise<void> => {
        const idx = contentLineIdx(div);
        if (idx === -1)
            return;

        // reset selections
        const memSlots = div.querySelectorAll('.mem-slot');
        memSlots.forEach(memSlot => {
            memSlot.classList.remove('selected-mem-slot');
            memSlot.classList.remove('dependency-mem-slot');
        });

        if (idx === state.selectedLineIdx)
            setLineHighlightClass(div, 'selected-line');
        else if (state.lines[idx]?.bpfIns || state.lines[idx]?.bpfStateExprs)
            setLineHighlightClass(div, 'normal-line');
        else
            setLineHighlightClass(div, 'ignorable-line');
    }

    const updateSingleLineFormat = async (state: AppState, div: HTMLElement): Promise<void> => {
        resetSingleLineFormat(state, div);
        const selectedLine = state.lines[state.selectedLineIdx];
        const isSelectedLineParsed = selectedLine?.bpfIns || selectedLine?.bpfStateExprs;
        const idx = contentLineIdx(div);

        if (!isSelectedLineParsed || !state.selectedMemSlotId || idx === -1)
            return;

        if (idx === state.selectedLineIdx || state.memSlotDependencies.has(idx)) {
            if (state.selectedMemSlotId) {
                div.querySelectorAll('.mem-slot').forEach(memSlot => {
                    memSlot.classList.add('dependency-mem-slot');
                });
            }
            if (idx === state.selectedLineIdx) {
                setLineHighlightClass(div, 'selected-line');
                const memSlotSpan = div.querySelector(`#${state.selectedMemSlotId}`) as HTMLElement;
                if (memSlotSpan)
                    setLineHighlightClass(memSlotSpan, 'selected-mem-slot');
            } else {
                setLineHighlightClass(div, 'dependency-line');
            }
            return;
        }

        const line = state.lines[idx];
        if (!line?.bpfIns && !line?.bpfStateExprs) {
            setLineHighlightClass(div, 'ignorable-line');
        } else if (isSelectedLineParsed) {
            setLineHighlightClass(div, 'faded-line');
        } else {
            setLineHighlightClass(div, 'normal-line');
        }
    }

    const getVisibleIdxRange = (): [number, number] => {
        const linesRect = logLines.getBoundingClientRect();
        const containerRect = logContainer.getBoundingClientRect();

        if (containerRect.height * 2 > linesRect.height) {
            return [0, state.lines.length - 1];
        }

        const relativeStart = (containerRect.top - linesRect.top) / linesRect.height;
        const relativeEnd = relativeStart + containerRect.height / linesRect.height;
        const minIdx = Math.floor(relativeStart * state.lines.length);
        const maxIdx = Math.ceil(relativeEnd * state.lines.length);

        return [minIdx, maxIdx];
    }

    const updateLineFormatting = async (state: AppState): Promise<void> => {
        // update more than just visible part to reduce flickering
        const [minVisibleIdx, maxVisibleIdx] = getVisibleIdxRange();
        const visibleCnt = maxVisibleIdx - minVisibleIdx + 1;
        const minIdx = normalIdx(minVisibleIdx - visibleCnt);
        const maxIdx = normalIdx(maxVisibleIdx + visibleCnt);
        for (let i = minIdx; i <= maxIdx; i++) {
            const child = logLines.children[i] as HTMLElement;
            const div = child as HTMLElement;
            // idx should be always equal to i,
            // but there is no point in enforcing this here
            const idx = contentLineIdx(div);
            if (idx === -1)
                continue;
            updateSingleLineFormat(state, div);
        }
    }

    const memSlotDisplayValue = (state: AppState, memSlotId: string, idx: number): string => {
        const { state: bpfState, idx: bpfStateIdx } = mostRecentBpfState(state, idx);
        const prevBpfState = mostRecentBpfState(state, bpfStateIdx - 1).state;
        const prevValue = prevBpfState.values.get(memSlotId);
        const value = bpfState.values.get(memSlotId);
        const ins = state.lines[idx].bpfIns;
        let content = '';
        switch (value?.effect) {
            case Effect.WRITE:
            case Effect.UPDATE:
                if (memSlotId == 'MEM') {
                    // show the value of register that was stored
                    const reg = ins?.alu?.src.id;
                    if (reg) {
                        const regValue = bpfState.values.get(reg);
                        content = `${RIGHT_ARROW} ${regValue?.value}`;
                    }
                    break;
                }
                let newVal = value?.value;
                let oldVal = prevValue?.value || '';
                if (newVal === oldVal)
                    content = newVal;
                else if (newVal)
                    content = `${oldVal} ${RIGHT_ARROW} ${newVal}`;
                else
                    content = `${oldVal} <span style="color:grey">-> scratched</span>`;
                break;
            case Effect.READ:
            case Effect.NONE:
            default:
                content = value?.value || '';
                break;
        }
        return content;
    }

    const RIGHT_ARROW = '->';

    const updateStatePanel = async (state: AppState): Promise<void> => {
        const { state: bpfState, idx } = mostRecentBpfState(state, state.selectedLineIdx);
        const statePanel = document.getElementById('state-panel') as HTMLElement;
        const header = document.getElementById('state-panel-header') as HTMLElement;
        const table = statePanel.querySelector('table');

        let headerHtml = `<div>Line: ${state.selectedLineIdx + 1}</div>`;
        headerHtml += `<div>PC: ${bpfState.pc}</div>`;
        headerHtml += `<div>Frame: ${bpfState.frame}</div>`;
        header.innerHTML = headerHtml;

        table.innerHTML = '';
        const addRow = (id: string) => {
            let content = memSlotDisplayValue(state, id, idx);
            const row = document.createElement('tr');
            const value = bpfState.values.get(id);
            switch (value?.effect) {
                case Effect.WRITE:
                case Effect.UPDATE:
                    row.classList.add('effect-write');
                    break;
                case Effect.READ:
                    row.classList.add('effect-read');
                    break;
                case Effect.NONE:
                default:
                    break;
            }
            const nameCell = document.createElement('td');
            nameCell.textContent = id;
            nameCell.style.width = '7ch';
            const valueCell = document.createElement('td');
            const valueSpan = document.createElement('span');
            valueSpan.innerHTML = content;
            valueCell.appendChild(valueSpan);
            row.appendChild(nameCell);
            row.appendChild(valueCell);

            // clear class list in case we the selected line is not an instruction
            const line = state.lines[state.selectedLineIdx];
            if (line?.type !== ParsedLineType.INSTRUCTION) {
                row.className = '';
            }

            table.appendChild(row);
        }

        // first add the registers
        for (let i = 0; i <= 10; i++) {
            addRow(`r${i}`);
        }

        // then the stack
        for (let i = 0; i <= 512; i++) {
            const key = `fp-${i}`;
            if (bpfState.values.has(key))
                addRow(key);
        }

        // then the rest
        const sortedValues = [];
        for (const key of bpfState.values.keys()) {
            if (!key.startsWith('r') && !key.startsWith('fp-')) {
                sortedValues.push(key);
            }
        }
        sortedValues.sort((a, b) => a.localeCompare(b));
        for (const key of sortedValues) {
            addRow(key);
        }
    }

    const scrollToLine = async (idx: number): Promise<void> => {
        const [minIdx, maxIdx] = getVisibleIdxRange();
        const page = maxIdx - minIdx + 1;
        const relativePosition = normalIdx(idx - page * 0.618) / state.lines.length;
        logContainer.scrollTop = relativePosition * logContainer.scrollHeight;
    }

    const updateView = async (state: AppState): Promise<void> => {
        if (state.lines.length === 0) {
            mainContent.style.display = 'none';
            inputText.style.display = 'flex';
            inputText.value = '';
        } else {
            mainContent.style.display = 'flex';
            inputText.style.display = 'none';
            updateLineFormatting(state);
            updateStatePanel(state);
        }
    };

    const handlePaste = async (e: ClipboardEvent) => {
        await loadInputText(state, e.clipboardData.getData('text'));
        updateView(state);
    };

    const normalIdx = (idx: number): number => {
        return Math.min(Math.max(0, Math.floor(idx)), state.lines.length);
    }

    const handleKeyDown = async (e: KeyboardEvent) => {
        let delta = 0;
        let [minIdx, maxIdx] = getVisibleIdxRange();
        let page = maxIdx - minIdx + 1;
        switch (e.key) {
            case 'ArrowDown':
            case 'j':
                delta = 1;
                break;
            case 'ArrowUp':
            case 'k':
                delta = -1;
                break;
            case 'PageDown':
                delta = page;
                break;
            case 'PageUp':
                delta = -page;
                break;
            case 'Home':
                gotoStart();
                return;
            case 'End':
                gotoEnd();
                return;
            case 'Escape':
                resetSelectedMemSlot(state);
                break;
            default:
                return;
        }
        e.preventDefault();
        setSelectedLine(state.selectedLineIdx + delta);
        if (state.selectedLineIdx < minIdx + 8 || state.selectedLineIdx > maxIdx - 8) {
            await scrollToLine(state.selectedLineIdx);
        }
        updateView(state);
    };

    const processFile = async (file: File): Promise<void> => {
        state.lines = [];
        state.fileBlob = file;
        loadInputFile(state);
    };

    const handleFileInput = (e: Event): void => {
        const files = (e.target as HTMLInputElement).files;
        if (files?.[0]) processFile(files[0]);
    };

    const gotoStart = () => {
        logContainer.scrollTop = 0;
    };

    const gotoEnd = () => {
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    const gotoLine = () => {
        const idx = normalIdx(parseInt(gotoLineInput.value, 10) - 1);
        setSelectedLine(idx);
        scrollToLine(idx);
        updateView(state);
    };

    const triggerUpdateView = (): void => {
        updateView(state);
    };

    fileInput.addEventListener('change', handleFileInput);
    document.addEventListener('keydown', handleKeyDown);
    inputText.addEventListener('paste', handlePaste);
    window.addEventListener('resize', triggerUpdateView);
    logContainer.addEventListener('scroll', triggerUpdateView);

    // Navigation panel
    gotoLineInput.addEventListener('input', gotoLine);
    gotoStartButton.addEventListener('click', gotoStart);
    gotoEndButton.addEventListener('click', gotoEnd);
    logLines.addEventListener('click', handleLineClick);
    logLines.addEventListener('mouseover', handleMouseOver);
    logLines.addEventListener('mouseout', handleMouseOut);


    if (url) {
        loadStatus.innerHTML = `Downloading ${url} ...`;
        fetchLogFromUrl(url).then(text => {
            if (text) {
                loadInputText(state, text);
                updateView(state);
            } else {
                const textArea = document.getElementById('input-text') as HTMLTextAreaElement;
                textArea.placeholder = `Failed to load log from ${url}\n` + textArea.placeholder;
                updateView(state);
            }
        });
    }

    updateView(state);

    // Return cleanup function
    return () => {
        fileInput.removeEventListener('change', handleFileInput);
        document.removeEventListener('keydown', handleKeyDown);
        inputText.removeEventListener('paste', handlePaste);
        gotoStartButton.removeEventListener('click', gotoStart);
        gotoLineButton.removeEventListener('click', gotoLine);
        gotoEndButton.removeEventListener('click', gotoEnd);
        logLines.removeEventListener('click', handleLineClick);
        logLines.removeEventListener('mouseover', handleMouseOver);
        logLines.removeEventListener('mouseout', handleMouseOut);
        window.removeEventListener('resize', triggerUpdateView);
        logContainer.removeEventListener('scroll', triggerUpdateView);
    };
};

document.addEventListener('DOMContentLoaded', () => {
    const url = getUrlParameter('url');
    createApp(url);
});
