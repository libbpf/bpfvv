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

type ParsedLine = {
    idx: number; // index of the line in the input file
    offset: number; // byte offset in the input file pointing to the start of the line
    raw: string;
    insnLine?: ParsedInsnLine;
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

        console.log(match[3].trim());

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

    const handleLineClick = async (e: MouseEvent) => {
        const clickedLine = (e.target as HTMLElement).closest('.log-line');
        if (!clickedLine) return;

        const lineIndex = parseInt(clickedLine.getAttribute('line-index') || '0', 10);
        state.selectedLine = lineIndex;

        const line = state.lines[lineIndex];
        state.focusReg = line?.insnLine?.insn.src_reg;

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
        else if (isFocusLine(line))
            highlightClass = 'focus';
        else if (!line?.insnLine)
            highlightClass = 'ignorable';
        return `<div class="log-line ${highlightClass}" line-index="${idx}">${escapeHtml(line.raw)}</div>`
    }

    // Load and parse the file into memory from the beggining to the end
    const loadInputFile = async (state: AppState): Promise<void> => {
        const chunkSize = 4096; // bytes
        let eof = false;
        let offset = 0;
        let idx = 0;
        while (!eof) {
            eof = (offset + chunkSize >= state.fileBlob.size);
            const end = Math.min(offset + chunkSize, state.fileBlob.size);
            const chunk = state.fileBlob.slice(offset, end);
            const text = await chunk.text();
            const lines = text.split('\n');
            // remove last line as it is likely truncated
            if (lines.length > 1 && !eof)
                lines.pop();
            lines.forEach(rawLine => {
                const parsedLine: ParsedLine = {
                    idx: idx,
                    offset: offset,
                    raw: rawLine,
                    insnLine: parseInsn(rawLine),
                };
                state.lines.push(parsedLine);
                offset += rawLine.length + 1;
                idx++;
            });
            updateLoadStatus(state);
        }
    };

    const updateLoadStatus = async (state: AppState): Promise<void> => {
        if (state.lines.length === 0)
            return;
        const lastLine = state.lines[state.lines.length - 1];
        const percentage = lastLine.offset / state.fileBlob.size * 100;
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

    const updateView = async (state: AppState): Promise<void> => {
        updateLineNumbers(state.topLineIdx, state.visibleLines);
        formatVisibleLines(state);
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
                linesToScroll = 1;
                break;
            case 'ArrowUp':
                linesToScroll = -1;
                break;
            case 'PageDown':
                linesToScroll = state.visibleLines;
                break;
            case 'PageUp':
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
        // delay a bit to give loadInputFile time to load the first chunk
        setTimeout(() => updateView(state), 20);
    };

    const handleFileInput = (e: Event): void => {
        const files = (e.target as HTMLInputElement).files;
        if (files?.[0]) processFile(files[0]);
    };

    const gotoStart = () => {
        state.topLineIdx = 0;
        updateView(state);
    };

    const gotoEnd = () => {
        state.topLineIdx = Math.max(0, state.lines.length - state.visibleLines);
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

    fileInput.addEventListener('change', handleFileInput);
    logContent.addEventListener('wheel', handleScroll);
    document.addEventListener('keydown', handleKeyDown);

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

        // Cleanup for new event listeners
        gotoStartButton.removeEventListener('click', gotoStart);
        gotoLineButton.removeEventListener('click', gotoLine);
        gotoEndButton.removeEventListener('click', gotoEnd);
        contentLines.removeEventListener('click', handleLineClick);
    };
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    createApp();
});
