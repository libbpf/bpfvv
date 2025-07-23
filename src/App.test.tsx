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
      '*(u8 *)(<span id="mem-slot-r7-line-0" class="mem-slot r7" data-id="r7">r7</span> +1303) = <span id="mem-slot-r1-line-0" class="mem-slot r1" data-id="r1">r1</span>',
    );

    const hintSelectedLineEl = document.getElementById("hint-selected-line");
    expect(hintSelectedLineEl?.innerHTML).toBe(
      "<span>[selected raw line] 1:</span> 314: (73) *(u8 *)(r7 +1303) = r1      ; frame1: R1_w=0 R7=map_value(off=0,ks=4,vs=2808,imm=0)",
    );

    expect(document.getElementById("state-panel")).toBeTruthy();

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
    expect(document.getElementById("state-panel")).toBeFalsy();
    expect(document.getElementById("input-text")).toBeTruthy();
    expect(document.getElementById("input-text")).toBeVisible();
  });
});
