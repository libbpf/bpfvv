import { ParsedLine, ParsedLineType, parseLine } from './parser.js';

export enum Effect {
    NONE = "NONE",
    READ = "READ",
    WRITE = "WRITE",
    UPDATE = "UPDATE", // read then write, e.g. r0 += 1
}

export type BpfValue = {
    value: string;
    effect: Effect;
}

const makeValue = (value: string, effect: Effect = Effect.NONE): BpfValue => {
    return { value, effect };
}

export type BpfState = {
    values: Map<string, BpfValue>;
    lastKnownWrites: Map<string, number>;
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
    return { values, lastKnownWrites };
}

const copyBpfState = (state: BpfState): BpfState => {
    let values = new Map<string, BpfValue>();
    for (const [key, val] of state.values.entries()) {
        // Don't copy the effect, only the value
        const bpfValue = val ? { value: val.value, effect: Effect.NONE } : null;
        values.set(key, bpfValue);
    }
    let lastKnownWrites = new Map<string, number>();
    for (const [key, val] of state.lastKnownWrites.entries()) {
        lastKnownWrites.set(key, val);
    }
    return { values, lastKnownWrites };
}

const nextBpfState = (state: BpfState, line: ParsedLine): BpfState => {
    if (line.type !== ParsedLineType.INSTRUCTION)
        return state;
    let newState = copyBpfState(state);
    for (const expr of line.bpfStateExprs) {
        let effect = Effect.NONE;
        let read = line.bpfIns?.reads?.find(r => r === expr.id);
        let written = line.bpfIns?.writes?.find(r => r === expr.id);
        if (read && written)
            effect = Effect.UPDATE;
        else if (read)
            effect = Effect.READ;
        else if (written)
            effect = Effect.WRITE;
        newState.values.set(expr.id, makeValue(expr.value, effect));
    }
    for (const id of line.bpfIns?.writes || []) {
        // if it's a write, but value is unknown, assume scratch
        if (!newState.values.has(id))
            newState.values.set(id, makeValue('', Effect.WRITE));
        newState.lastKnownWrites.set(id, line.idx);
    }
    return newState;
}

const DEPENDENCIES_DEPTH = 4;

type AppState = {
    fileBlob: Blob;
    lines: ParsedLine[];
    bpfStates: BpfState[];

    visibleLines: number;
    totalHeight: number;
    lineHeight: number;

    topLineIdx: number; // index of the first line in the visible area
    selectedIdx: number;
    // dependencies by level, e.g. dependencies[0] is the dependencies of the selected line
    // dependencies[1] is the dependencies of dependencies[0] and so on
    // each level is the list of idx
    dependencies: Set<number>[];
}

const createApp = () => {

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const loadStatus = document.getElementById('load-status') as HTMLElement;

    const gotoStartButton = document.getElementById('goto-start') as HTMLButtonElement;
    const gotoLineInput = document.getElementById('goto-line') as HTMLInputElement;
    const gotoLineButton = document.getElementById('goto-line-btn') as HTMLButtonElement;
    const gotoEndButton = document.getElementById('goto-end') as HTMLButtonElement;

    const inputText = document.getElementById('input-text') as HTMLTextAreaElement;
    const mainContent = document.getElementById('main-content') as HTMLElement;
    const logContent = document.getElementById('log-content') as HTMLElement;
    const contentLines = document.getElementById('content-lines') as HTMLElement;
    const lineNumbers = document.getElementById('line-numbers') as HTMLElement;

    const state: AppState = {
        fileBlob: new Blob([]),
        lines: [],
        bpfStates: [],

        visibleLines: 50,
        totalHeight: 0,
        lineHeight: 16,
        selectedIdx: 13,
        dependencies: [],

        topLineIdx: 0,
    };

    const mostRecentBpfState = (state: AppState, idx: number): BpfState => {
        let bpfState = null;
        for (let i = Math.min(idx, state.bpfStates.length - 1); i >= 0; i--) {
            bpfState = state.bpfStates[i];
            if (bpfState)
                return bpfState;
        }
        return initialBpfState();
    }

    const computeDependencies = (state: AppState, target_idx: number): Set<number>[] => {
        let targets = [target_idx];
        let nTargets = 1;
        let dependencies : Set<number>[] = [];
        let levelDeps = new Set<number>();
        let level = 0;
        while (targets.length > 0 && level < DEPENDENCIES_DEPTH) {
            const idx = targets.pop();
            const bpfState = state.bpfStates[idx];
            const ins = state.lines[idx].bpfIns;
            for (const id of ins?.reads || []) {
                let depIdx = bpfState.lastKnownWrites.get(id);
                if (depIdx === idx && idx > 0) {
                    // this is an Effect.UPDATE, so let's look at the previous bpfState
                    const prevBpfState = state.bpfStates[idx-1];
                    depIdx = prevBpfState.lastKnownWrites.get(id);
                }
                if (depIdx) {
                    levelDeps.add(depIdx);
                }
            }
            nTargets--;
            if (nTargets === 0) {
                targets = Array.from(levelDeps);
                dependencies.push(levelDeps);
                levelDeps = new Set<number>();
                level++;
                nTargets = targets.length;
            }
        }
        return dependencies;
    }

    const updateSelectedLine = (idx: number): void => {
        state.selectedIdx = Math.max(0, Math.min(state.lines.length - 1, idx));
        state.dependencies = computeDependencies(state, state.selectedIdx);
    }

    const handleLineClick = async (e: MouseEvent) => {
        const clickedLine = (e.target as HTMLElement).closest('.log-line');
        if (!clickedLine)
            return;
        const lineIndex = parseInt(clickedLine.getAttribute('line-index') || '0', 10);
        updateSelectedLine(lineIndex);
        updateView(state);
    };

    const lineDependencyLevel = (line: ParsedLine): number => {
        if (line.idx >= state.selectedIdx)
            return -1;
        return state.dependencies.findIndex(level => level.has(line.idx));
    }

    const formatLogLine = (line: ParsedLine, idx: number): HTMLElement => {
        const div = document.createElement('div');
        let highlightClass = 'normal';
        if (idx === state.selectedIdx)
            highlightClass = 'selected';
        else if (line?.raw.includes('goto'))
            highlightClass = 'goto-line';
        else if (!line?.bpfIns && !line?.bpfStateExprs)
            highlightClass = 'ignorable';

        let depLevel = lineDependencyLevel(line);
        if (depLevel >= 0) {
            highlightClass = '';
            const k = depLevel / DEPENDENCIES_DEPTH;
            div.style.backgroundColor = `rgb(${128 + 128 * k}, 255, ${128 + 128 * k})`;
        }
        div.className = `log-line ${highlightClass}`;
        div.setAttribute('line-index', idx.toString());
        div.textContent = line.raw;
        return div;
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
        let idx = 0;
        let bpfState = initialBpfState();
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
                const parsedLine = parseLine(rawLine);
                state.lines.push(parsedLine);
                parsedLine.idx = idx;
                bpfState = nextBpfState(bpfState, parsedLine);
                state.bpfStates.push(bpfState);
                offset += rawLine.length + 1;
                idx++;
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
    };

    const loadInputText = async (state: AppState, text: string): Promise<void> => {
        let offset = 0;
        let idx = 0;
        let bpfState = initialBpfState();
        const lines = text.split('\n');
        lines.forEach(rawLine => {
            const parsedLine = parseLine(rawLine);
            state.lines.push(parsedLine);
            parsedLine.idx = idx;
            bpfState = nextBpfState(bpfState, parsedLine);
            state.bpfStates.push(bpfState);
            offset += rawLine.length + 1;
            idx++;
        });
        updateLoadStatus(100, 100);
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

    const updateLineNumbers = async (startLine: number, count: number): Promise<void> => {
        lineNumbers.innerHTML = Array.from(
            { length: count },
            (_, i) => `${startLine + i + 1}`
        ).join('\n');
    };

    const formatVisibleLines = async (state: AppState): Promise<void> => {
        contentLines.innerHTML = '';
        for (let idx = state.topLineIdx; idx < state.topLineIdx + state.visibleLines; idx++) {
            const line = state.lines[idx];
            if (line)
                contentLines.appendChild(formatLogLine(line, idx));
        }
    }

    const updateStatePanel = async (state: AppState): Promise<void> => {
        const bpfState = mostRecentBpfState(state, state.selectedIdx);
        if (!bpfState)
            return;

        const statePanel = document.getElementById('state-panel') as HTMLElement;
        const table = statePanel.querySelector('table');
        table.innerHTML = '';

        const addRow = (label: string, value: BpfValue) => {
            const row = document.createElement('tr');
            if (value?.effect === Effect.WRITE || value?.effect === Effect.UPDATE) {
                row.classList.add('effect-write');
            }
            const nameCell = document.createElement('td');
            nameCell.textContent = label;
            const valueCell = document.createElement('td');
            const valueSpan = document.createElement('span');
            valueSpan.textContent = escapeHtml(value?.value || '');
            valueCell.appendChild(valueSpan);
            row.appendChild(nameCell);
            row.appendChild(valueCell);
            table.appendChild(row);
        }

        // first add the registers
        for (let i = 0; i <= 10; i++) {
            addRow(`r${i}`, bpfState.values.get(`r${i}`));
        }

        // then the stack
        for (let i = 512; i >= 0; i--) {
            const key = `fp-${i}`;
            if (bpfState.values.has(key))
                addRow(key, bpfState.values.get(key));
        }

        // then the rest
        const sortedValues = [];
        for (const [key, value] of bpfState.values.entries()) {
            if (!key.startsWith('r') && !key.startsWith('fp-')) {
                sortedValues.push([key, value]);
            }
        }
        sortedValues.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [key, value] of sortedValues) {
            addRow(key, value);
        }
    }

    const updateVisibleLinesValue = (state: AppState): void => {
        const tmp = document.createElement('div');
        tmp.className = 'log-line';
        tmp.textContent = 'Test';
        tmp.style.visibility = 'hidden';
        contentLines.appendChild(tmp);
        const height = tmp.offsetHeight;
        contentLines.removeChild(tmp);
        state.visibleLines = Math.max(1, Math.floor(logContent.offsetHeight / height) - 1);
    };

    const updateView = async (state: AppState): Promise<void> => {
        if (state.lines.length === 0) {
            mainContent.style.display = 'none';
            inputText.style.display = 'flex';
            inputText.value = '';
        } else {
            mainContent.style.display = 'flex';
            inputText.style.display = 'none';
            updateVisibleLinesValue(state);
            updateLineNumbers(state.topLineIdx, state.visibleLines);
            formatVisibleLines(state);
            updateStatePanel(state);
        }
    };

    const handlePaste = async (e: ClipboardEvent) => {
        await loadInputText(state, e.clipboardData.getData('text'));
        updateView(state);
    };

    const updateTopLineIdx = (state: AppState, delta: number): void => {
        let newPosition = Math.min(state.lines.length - state.visibleLines, state.topLineIdx + delta);
        newPosition = Math.max(0, newPosition);
        state.topLineIdx = newPosition;
    };

    const handleScroll = async (e: WheelEvent) => {
        e.preventDefault();
        // scroll 4 lines at a time
        const linesToScroll = Math.sign(e.deltaY) * 4;
        updateTopLineIdx(state, linesToScroll);
        updateView(state);
    };

    // Handle keyboard navigation
    const handleKeyDown = async (e: KeyboardEvent) => {
        let linesToScroll = 0;
        switch (e.key) {
            case 'ArrowDown':
            case 'j':
                updateSelectedLine(state.selectedIdx + 1);
                if (state.selectedIdx >= state.topLineIdx + state.visibleLines)
                    linesToScroll = 1;
                break;
            case 'ArrowUp':
            case 'k':
                updateSelectedLine(state.selectedIdx - 1);
                if (state.selectedIdx < state.topLineIdx)
                    linesToScroll = -1;
                break;
            case 'PageDown':
                updateSelectedLine(state.selectedIdx + state.visibleLines);
                linesToScroll = state.visibleLines;
                break;
            case 'PageUp':
                updateSelectedLine(Math.max(state.selectedIdx - state.visibleLines, 0));
                linesToScroll = -state.visibleLines;
                break;
            case 'Home':
                gotoStart();
                return;
            case 'End':
                gotoEnd();
                return;
            default:
                return;
        }
        updateTopLineIdx(state, linesToScroll);
        updateView(state);
    };

    const escapeHtml = (text: string): string => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const processFile = async (file: File): Promise<void> => {
        state.topLineIdx = 0;
        state.lines = [];
        state.fileBlob = file;
        loadInputFile(state);
    };

    const handleFileInput = (e: Event): void => {
        const files = (e.target as HTMLInputElement).files;
        if (files?.[0]) processFile(files[0]);
    };

    const gotoStart = () => {
        state.topLineIdx = 0;
        updateSelectedLine(0);
        updateView(state);
    };

    const gotoEnd = () => {
        state.topLineIdx = Math.max(0, state.lines.length - state.visibleLines);
        updateSelectedLine(state.lines.length - 1);
        updateView(state);
    };

    const gotoLine = () => {
        const lineNumber = parseInt(gotoLineInput.value, 10);
        if (!isNaN(lineNumber)) {
            let idx = Math.max(0, Math.min(state.lines.length - state.visibleLines, lineNumber - 1));
            state.topLineIdx = idx;
            updateView(state);
        }
    };

    const handleResize = (): void => {
        updateView(state);
    };

    fileInput.addEventListener('change', handleFileInput);
    logContent.addEventListener('wheel', handleScroll);
    document.addEventListener('keydown', handleKeyDown);
    inputText.addEventListener('paste', handlePaste);
    window.addEventListener('resize', handleResize);

    // Navigation panel
    gotoLineInput.addEventListener('input', gotoLine);
    gotoStartButton.addEventListener('click', gotoStart);
    gotoEndButton.addEventListener('click', gotoEnd);
    contentLines.addEventListener('click', handleLineClick);

    updateView(state);

    // Return cleanup function
    return () => {
        fileInput.removeEventListener('change', handleFileInput);
        logContent.removeEventListener('wheel', handleScroll);
        document.removeEventListener('keydown', handleKeyDown);
        inputText.removeEventListener('paste', handlePaste);
        gotoStartButton.removeEventListener('click', gotoStart);
        gotoLineButton.removeEventListener('click', gotoLine);
        gotoEndButton.removeEventListener('click', gotoEnd);
        contentLines.removeEventListener('click', handleLineClick);
        window.removeEventListener('resize', handleResize);
    };
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    createApp();
});
