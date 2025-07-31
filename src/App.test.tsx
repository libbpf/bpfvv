/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, createEvent, fireEvent } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("does not throw", () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    expect(inputEl).toBeTruthy();
    expect(inputEl).toBeVisible();
  });

  it("renders the correct starting elements", () => {
    render(<App />);

    const exampleLinkEl = document.getElementById("example-link");
    expect(exampleLinkEl?.innerHTML).toBe("Load an example log");

    const inputEl = document.getElementById("input-text");
    expect(inputEl?.getAttribute("placeholder")).toBe(
      "Paste a verifier log here or choose a file",
    );
    expect(inputEl?.tagName).toBe("TEXTAREA");

    const fileInputEl = document.getElementById("file-input");
    expect(fileInputEl?.tagName).toBe("INPUT");

    const gotoLineEl = document.getElementById("goto-line-input");
    expect(gotoLineEl?.tagName).toBe("INPUT");

    const gotoStartEl = document.getElementById("goto-start");
    expect(gotoStartEl?.tagName).toBe("BUTTON");

    const gotoEndEl = document.getElementById("goto-end");
    expect(gotoEndEl?.tagName).toBe("BUTTON");

    const clearEl = document.getElementById("clear");
    expect(clearEl?.tagName).toBe("BUTTON");
  });

  it("renders the log visualizer when text is pasted", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      fail();
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () =>
            "314: (73) *(u8 *)(r7 +1303) = r1      ; frame1: R1_w=0 R7=map_value(off=0,ks=4,vs=2808,imm=0)",
        },
      }),
    );

    const logContainerEl = document.getElementById("log-container");
    expect(logContainerEl).toBeTruthy();
    expect(logContainerEl).toBeVisible();

    const logLinesEl = document.getElementById("line-numbers-idx");
    expect(logLinesEl?.innerHTML).toBe(
      '<div class="line-numbers-line">1</div>',
    );

    const logLinesPcEl = document.getElementById("line-numbers-pc");
    expect(logLinesPcEl?.innerHTML).toBe(
      '<div class="line-numbers-line">314:</div>',
    );

    expect(document.getElementById("formatted-log-lines")).toBeTruthy();

    const firstLine = document.getElementById("line-0");
    expect(firstLine?.innerHTML).toBe(
      '*(u8 *)(<span id="mem-slot-r7-line-0" class="mem-slot r7" data-id="r7">r7</span> +1303)&nbsp;=&nbsp;<span id="mem-slot-r1-line-0" class="mem-slot r1" data-id="r1">r1</span>',
    );

    const hintSelectedLineEl = document.getElementById("hint-selected-line");
    expect(hintSelectedLineEl?.innerHTML).toBe(
      "<span>[selected raw line] 1:</span>&nbsp;314: (73) *(u8 *)(r7 +1303) = r1      ; frame1: R1_w=0 R7=map_value(off=0,ks=4,vs=2808,imm=0)",
    );

    expect(document.getElementById("state-panel-shown")).toBeTruthy();

    const statePanelHeader = document.getElementById("state-panel-header");
    expect(statePanelHeader?.innerHTML).toBe(
      "<div>Line: 1</div><div>PC: 314</div><div>Frame: 0</div>",
    );

    //TODO: add tests for state panel content

    // Hit the clear button and make sure we go back to the intial state
    const clearEl = document.getElementById("clear");
    if (!clearEl) {
      fail();
    }
    fireEvent(clearEl, createEvent.click(clearEl));
    expect(document.getElementById("log-container")).toBeFalsy();
    expect(document.getElementById("state-panel-shown")).toBeFalsy();
    expect(document.getElementById("input-text")).toBeTruthy();
    expect(document.getElementById("input-text")).toBeVisible();
  });

  it("jumps to the next/prev instruction on key up/down", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      fail();
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () =>
            `
          0: (18) r1 = 0x11                     ; R1_w=17
2: (b7) r2 = 0                        ; R2_w=0
3: (85) call bpf_obj_new_impl#54651   ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
4: (bf) r6 = r0                       ; R0_w=ptr_or_null_node_data(id=2,ref_obj_id=2) R6_w=ptr_or_null_node_data(id=2,ref_obj_id=2) refs=2
5: (b7) r7 = 1                        ; R7_w=1 refs=2
; if (!n) @ rbtree.c:199
6: (15) if r6 == 0x0 goto pc+104      ; R6_w=ptr_node_data(ref_obj_id=2) refs=2
7: (b7) r1 = 4                        ; R1_w=4 ref
            `,
        },
      }),
    );

    const logContainerEl = document.getElementById("log-container");
    expect(logContainerEl).toBeTruthy();
    expect(logContainerEl).toBeVisible();

    const line5 = document.getElementById("line-5");
    const line6 = document.getElementById("line-6");
    const line7 = document.getElementById("line-7");

    if (!line5 || !line6 || !line7 || !logContainerEl) {
      fail();
    }

    expect(line5.innerHTML).toBe(
      '<span id="mem-slot-r7-line-5" class="mem-slot r7" data-id="r7">r7</span>&nbsp;=&nbsp;1',
    );

    // Show that the next line is not an instruction
    expect(line6.innerHTML).toBe("; if (!n) @ rbtree.c:199");

    // Show the one after IS an instruction
    expect(line7.innerHTML).toBe(
      'if (<span id="mem-slot-r6-line-7" class="mem-slot r6" data-id="r6">r6</span>&nbsp;==&nbsp;0x0)&nbsp;goto&nbsp;pc+104',
    );

    // Click on Line 5
    fireEvent(line5, createEvent.click(line5));
    expect(line5.classList.contains("selected-line")).toBeTruthy();

    // Keyboard Down Arrow
    fireEvent.keyDown(logContainerEl, { key: "ArrowDown", code: "ArrowDown" });
    expect(line5.classList.contains("selected-line")).toBeFalsy();
    expect(line6.classList.contains("selected-line")).toBeFalsy();
    expect(line7.classList.contains("selected-line")).toBeTruthy();

    // Keyboard Up Arrow
    fireEvent.keyDown(logContainerEl, { key: "ArrowUp", code: "ArrowUp" });
    expect(line5.classList.contains("selected-line")).toBeTruthy();
    expect(line6.classList.contains("selected-line")).toBeFalsy();
    expect(line7.classList.contains("selected-line")).toBeFalsy();
  });
});
