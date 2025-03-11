type InsnArgs = {
    src: string;
    dst: string;
    src_reg: string;
    dst_reg: string;
}

type ParsedInsnLine = {
    idx: number;
    hex: string;
    insn: InsnArgs;
    comment: string;
}

enum Effect {
    NONE = 0,
    READ = 1,
    WRITE = 2,
}

type BpfValue = {
    value: string;
    effect: Effect;
}

const makeValue = (value: string, effect: Effect = Effect.NONE): BpfValue => {
    return { value, effect };
}

type BpfState = {
    values: Map<string, BpfValue>;
}

const initialBpfState = (): BpfState => {
    let values = new Map<string, BpfValue>();
    for (let i = 0; i < 10; i++) {
        values.set(`r${i}`, null);
    }
    values.set('r1', makeValue('ctx()'));
    values.set('r10', makeValue('fp0'));
    return { values: values };
}

const copyBpfState = (state: BpfState): BpfState => {
    let values = new Map<string, BpfValue>();
    for (const [key, val] of state.values.entries()) {
        // Don't copy the effect, only the value
        const bpfValue = val ? { value: val.value, effect: Effect.NONE } : null;
        values.set(key, bpfValue);
    }
    return { values: values };
}

type ParsedLine = {
    idx: number; // index of the line in the input file and state.lines array
    raw: string;
    insnLine?: ParsedInsnLine;
    bpfState?: BpfState;
}

type AppState = {
    fileBlob: Blob;
    lines: ParsedLine[];

    visibleLines: number;
    totalHeight: number;
    lineHeight: number;

    topLineIdx: number; // index of the first line in the visible area
    selectedLine: number;
    focusReg: string | null;
    maxParsedLineIdx: number;
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

        visibleLines: 50,
        totalHeight: 0,
        lineHeight: 16,
        selectedLine: 13,
        focusReg: null,
        maxParsedLineIdx: 0,
        topLineIdx: 0,
    };

    const parseInsn = (rawLine: string): ParsedInsnLine => {

        const regex = /([0-9]+): \(([0-9a-f]+)\) (.*)\s+; (.*)/;
        const match = rawLine.match(regex);
        if (!match)
            return null;

        const insn_str = match[3].trim();
        if (insn_str.startsWith('call ')) {
            return {
                idx: parseInt(match[1], 10),
                hex: match[2],
                insn: {
                    src: insn_str,
                    dst: insn_str,
                    src_reg: null,
                    dst_reg: 'r0',
                },
                comment: match[4].trim(),
            };
        }

        const insn_match = insn_str.split(' = ');

        let dst = null;
        let src = null;
        let dst_reg = null;
        let src_reg = null;
        if (insn_match) {
            dst = insn_match[0];
            const dst_match = dst?.match(/\br[0-9]\b/);
            dst_reg = dst_match ? dst_match[0] : null;
            if (insn_match.length > 1) {
                src = insn_match[1];
                const src_match = src?.match(/\br[0-9]\b/);
                src_reg = src_match ? src_match[0] : null;
            }
        }

        return {
            idx: parseInt(match[1], 10),
            hex: match[2],
            insn: {
                src: insn_match[1],
                dst: insn_match[0],
                src_reg: src_reg,
                dst_reg: dst_reg,
            },
            comment: match[4].trim(),
        };
    }

    const mostRecentBpfState = (state: AppState, idx: number): BpfState => {
        let bpfState = null;
        for (let i = idx; i >= 0; i--) {
            bpfState = state.lines[i]?.bpfState;
            if (bpfState)
                return bpfState;
        }
        return initialBpfState();
    }

    const parseBpfState = (state: AppState, idx: number, rawLine: string): BpfState => {
        const regex = /[0-9]+:\s+.*\s+; (.*)/;
        const match = rawLine.match(regex);
        if (!match)
            return null;
        const prevBpfState = mostRecentBpfState(state, idx-1);
        let bpfState = copyBpfState(prevBpfState);
        const str = match[0];
        const exprs = str.split(' ');
        for (const expr of exprs) {
            const equalsIndex = expr.indexOf('=');
            if (equalsIndex === -1)
                continue;
            const kv = [expr.substring(0, equalsIndex), expr.substring(equalsIndex + 1)];
            let key = kv[0].trim().toLowerCase();
            let effect = Effect.NONE;
            if (!key)
                continue;
            if (key.endsWith('_w')) {
                key = key.substring(0, key.length - 2);
                effect = Effect.WRITE;
            }
            const value = makeValue(kv[1], effect);
            bpfState.values.set(key, value);
        };
        return bpfState;
    }


    const updateSelectedLine = (idx: number): void => {
        state.selectedLine = Math.max(0, Math.min(state.lines.length - 1, idx));
        state.focusReg = state.lines[state.selectedLine]?.insnLine?.insn.src_reg;
    }

    const handleLineClick = async (e: MouseEvent) => {
        const clickedLine = (e.target as HTMLElement).closest('.log-line');
        if (!clickedLine)
            return;
        const lineIndex = parseInt(clickedLine.getAttribute('line-index') || '0', 10);
        updateSelectedLine(lineIndex);
        updateView(state);
    };

    const isFocusLine = (line: ParsedLine): boolean => {
        if (!state.focusReg)
            return false;
        const dst_reg = line?.insnLine?.insn?.dst_reg;
        if (!dst_reg || !dst_reg.startsWith('r'))
            return false;
        if (dst_reg === state.focusReg && line?.idx < state.selectedLine)
            return true;
        return false;
    }

    const formatLogLine = (line: ParsedLine, idx: number): string => {
        let highlightClass = 'normal';
        if (idx === state.selectedLine)
            highlightClass = 'selected';
        else if (line?.raw.includes('goto'))
            highlightClass = 'goto-line';
        else if (isFocusLine(line))
            highlightClass = 'dependency';
        else if (!line?.insnLine && !line?.bpfState)
            highlightClass = 'ignorable';
        return `<div class="log-line ${highlightClass}" line-index="${idx}">${escapeHtml(line.raw)}</div>`
    }

    // Load and parse the file into memory from the beggining to the end
    const loadInputFile = async (state: AppState): Promise<void> => {
        const chunkSize = 65536; // bytes
        let firstChunk = true;
        let remainder = '';
        let eof = false;
        let offset = 0;
        let idx = 0;
        while (!eof) {
            const t1 = performance.now();
            eof = (offset + chunkSize >= state.fileBlob.size);
            const end = Math.min(offset + chunkSize, state.fileBlob.size);
            const chunk = state.fileBlob.slice(offset, end);
            const text = await chunk.text();
            const lines = text.split('\n');
            lines[0] = remainder + lines[0];
            if (lines.length > 1) {
                remainder = lines.pop();
            } else {
                remainder = '';
            }
            lines.forEach(rawLine => {
                const parsedLine: ParsedLine = {
                    idx: idx,
                    raw: rawLine,
                    insnLine: parseInsn(rawLine),
                    bpfState: parseBpfState(state, idx, rawLine),
                };
                state.lines.push(parsedLine);
                offset += rawLine.length + 1;
                idx++;
            });
            updateLoadStatus(offset + remainder.length, state.fileBlob.size);
            if (firstChunk) {
                firstChunk = false;
                updateView(state);
            }
            const t2 = performance.now();
            console.log(`${lines.length} lines read in ${(t2 - t1).toFixed(3)}ms`);
        }
    };

    const loadInputText = async (state: AppState, text: string): Promise<void> => {
        let offset = 0;
        let idx = 0;
        const lines = text.split('\n');
        lines.forEach(rawLine => {
            const parsedLine: ParsedLine = {
                idx: idx,
                raw: rawLine,
                insnLine: parseInsn(rawLine),
                bpfState: parseBpfState(state, idx, rawLine),
            };
            state.lines.push(parsedLine);
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
        const lines = [];
        for (let idx = state.topLineIdx; idx < state.topLineIdx + state.visibleLines; idx++) {
            const line = state.lines[idx];
            if (line)
                lines.push(formatLogLine(line, idx));
        }
        contentLines.innerHTML = lines.join('');
    }

    const updateStatePanel = async (state: AppState): Promise<void> => {
        const bpfState = mostRecentBpfState(state, state.selectedLine);
        if (!bpfState)
            return;

        const statePanel = document.getElementById('state-panel') as HTMLElement;
        const table = statePanel.querySelector('table');
        table.innerHTML = '';

        const addRow = (label: string, value: BpfValue) => {
            const row = document.createElement('tr');
            if (value?.effect === Effect.WRITE) {
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
                updateSelectedLine(state.selectedLine + 1);
                if (state.selectedLine >= state.topLineIdx + state.visibleLines)
                    linesToScroll = 1;
                break;
            case 'ArrowUp':
            case 'k':
                updateSelectedLine(state.selectedLine - 1);
                if (state.selectedLine < state.topLineIdx)
                    linesToScroll = -1;
                break;
            case 'PageDown':
                updateSelectedLine(state.selectedLine + state.visibleLines);
                linesToScroll = state.visibleLines;
                break;
            case 'PageUp':
                updateSelectedLine(Math.max(state.selectedLine - state.visibleLines, 0));
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
