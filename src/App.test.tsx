/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, createEvent, fireEvent } from "@testing-library/react";
import App from "./App";
import { SAMPLE_LOG_DATA_1, SAMPLE_LOG_DATA_2 } from "./test-data";

const DOM_EL_FAIL = "DOM Element missing";

describe("App", () => {
  it("renders the correct starting elements", () => {
    const { container } = render(<App />);
    expect(container).toMatchSnapshot();
  });

  it("renders the log visualizer when text is pasted", async () => {
    const { container, rerender } = render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      throw new Error(DOM_EL_FAIL);
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

    rerender(<App />);
    expect(container).toMatchSnapshot();

    expect(document.getElementById("c-source-container")).toBeTruthy();
    expect(document.getElementById("formatted-log-lines")).toBeTruthy();
    expect(document.getElementById("state-panel")).toBeTruthy();

    // Hit the clear button and make sure we go back to the intial state
    const clearEl = document.getElementById("clear");
    if (!clearEl) {
      throw new Error(DOM_EL_FAIL);
    }
    fireEvent(clearEl, createEvent.click(clearEl));

    rerender(<App />);
    expect(container).toMatchSnapshot();

    expect(document.getElementById("c-source-container")).toBeFalsy();
    expect(document.getElementById("formatted-log-lines")).toBeFalsy();
    expect(document.getElementById("state-panel")).toBeFalsy();
  });

  it("jumps to the next/prev instruction on key up/down", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () => SAMPLE_LOG_DATA_1,
        },
      }),
    );

    // Need to show all log lines
    const checkboxEl = document.getElementById("show-full-log");
    if (!checkboxEl) {
      throw new Error(DOM_EL_FAIL);
    }
    fireEvent(checkboxEl, createEvent.click(checkboxEl));

    const logContainerEl = document.getElementById("log-container");

    const line5 = document.getElementById("line-5");
    const line6 = document.getElementById("line-6");
    const line7 = document.getElementById("line-7");

    if (!line5 || !line7 || !line6 || !logContainerEl) {
      throw new Error(DOM_EL_FAIL);
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

  it("c lines and state panel containers are collapsible", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      throw new Error("Input text is missing");
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () => SAMPLE_LOG_DATA_1,
        },
      }),
    );

    const cSourceEl = document.getElementById("c-source-container");
    const cSourceFile = cSourceEl?.querySelector(".c-source-file");

    expect(cSourceFile).toBeVisible();

    const cSourceHideShow = cSourceEl?.querySelector(".hide-show-button");

    if (!cSourceHideShow) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(cSourceHideShow, createEvent.click(cSourceHideShow));
    expect(cSourceFile).not.toBeVisible();

    const statePanelEl = document.getElementById("state-panel");
    const statePanelHeader = document.getElementById("state-panel-header");

    expect(statePanelHeader).toBeVisible();

    const statePanelHideShow = statePanelEl?.querySelector(".hide-show-button");

    if (!statePanelHideShow) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(statePanelHideShow, createEvent.click(statePanelHideShow));
    expect(statePanelHeader).not.toBeVisible();
  });

  it("highlights the associated c source or log line(s) when the other is clicked ", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () => SAMPLE_LOG_DATA_2,
        },
      }),
    );

    const line4El = document.getElementById("line-4");
    const cLineEl = document.getElementById("line-rbtree.c:198");
    if (!line4El || !cLineEl) {
      throw new Error(DOM_EL_FAIL);
    }

    expect(line4El.classList).not.toContain("selected-line");
    expect(cLineEl.classList).not.toContain("selected-line");

    // Click on the first instruction log line
    fireEvent(line4El, createEvent.click(line4El));

    expect(line4El.classList).toContain("selected-line");
    expect(cLineEl.classList).toContain("selected-line");

    // Click on another log line
    const line10El = document.getElementById("line-10");
    if (!line10El) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(line10El, createEvent.click(line10El));

    expect(line4El.classList).not.toContain("selected-line");
    expect(cLineEl.classList).not.toContain("selected-line");

    // Click on the first c source line
    fireEvent(cLineEl, createEvent.click(cLineEl));

    expect(line4El.classList).toContain("selected-line");
    expect(cLineEl.classList).toContain("selected-line");

    // The other instructions for this source line should also be selected
    const followingIns = ["line-5", "line-6", "line-7", "line-8"];
    followingIns.forEach((lineId) => {
      const el = document.getElementById(lineId);
      if (!el) {
        throw new Error(DOM_EL_FAIL);
      }
      expect(el.classList).toContain("selected-line");
    });
  });
});
