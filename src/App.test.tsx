/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, createEvent, fireEvent } from "@testing-library/react";
import ldb from "localdata";
import App from "./App";
import {
  SAMPLE_LOG_DATA_1,
  SAMPLE_LOG_DATA_2,
  SAMPLE_LOG_DATA_ERORR,
} from "./test-data";

// Mock the localdata module
jest.mock("localdata", () => ({
  __esModule: true,
  default: {
    get: jest.fn((_, callback) => {
      callback("");
    }),
    set: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    getAll: jest.fn(),
    clear: jest.fn(),
  },
}));

// use screen.debug(); to log the whole DOM

const DOM_EL_FAIL = "DOM Element missing";

// Mock Date to return a consistent timestamp for snapshot tests
const MOCK_DATE = new Date("2025-01-15T12:00:00.000Z");

describe("App", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Reset default mock implementation for ldb.get to return null (no stored logs)
    (ldb.get as jest.Mock).mockImplementation((_, callback) => {
      callback(null);
    });

    // Mock Date to return consistent timestamp
    jest.spyOn(global, "Date").mockImplementation(() => {
      const mockDate = MOCK_DATE;
      mockDate.toLocaleTimeString = jest.fn().mockReturnValue("12:00:00 PM");
      return mockDate;
    });

    const mockObserverInstance = {
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    };
    global.ResizeObserver = jest.fn(() => mockObserverInstance);
  });

  afterEach(() => {
    // Restore Date mock
    jest.restoreAllMocks();
  });

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
    expect(document.getElementById("log-content")).toBeTruthy();
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
    expect(document.getElementById("log-content")).toBeFalsy();
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
    const checkboxEl = document.getElementById("csource-toggle");
    if (!checkboxEl) {
      throw new Error(DOM_EL_FAIL);
    }
    fireEvent(checkboxEl, createEvent.click(checkboxEl));

    const logContainerEl = document.getElementById("log-container");

    const line1 = document.getElementById("line-1");
    const line2 = document.getElementById("line-2");
    const line3 = document.getElementById("line-3");

    if (!line1 || !line3 || !line2 || !logContainerEl) {
      throw new Error(DOM_EL_FAIL);
    }

    expect(line1.innerHTML).toBe(
      '<div class="pc-number">0</div><div class="dep-arrow" line-id="1" id="dep-arrow-line-1"></div><div class="log-line-content"><span id="mem-slot-r1-line-1" class="mem-slot" data-id="r1">r1</span>&nbsp;=&nbsp;0x11</div>',
    );

    // Show that the next line is not an instruction
    expect(line2.innerHTML).toBe(
      '<div class="pc-number">\n</div><div class="dep-arrow" line-id="2" id="dep-arrow-line-2"></div><div class="log-line-content">; if (!n) @ rbtree.c:199</div>',
    );

    // Show the one after IS an instruction
    expect(line3.innerHTML).toBe(
      '<div class="pc-number">2</div><div class="dep-arrow" line-id="3" id="dep-arrow-line-3"></div><div class="log-line-content"><span id="mem-slot-r2-line-3" class="mem-slot" data-id="r2">r2</span>&nbsp;=&nbsp;0</div>',
    );

    // Click on Line 1
    fireEvent(line1, createEvent.click(line1));
    expect(line1.classList.contains("selected-line")).toBeTruthy();

    // Keyboard Down Arrow
    fireEvent.keyDown(logContainerEl, { key: "ArrowDown", code: "ArrowDown" });
    expect(line1.classList.contains("selected-line")).toBeFalsy();
    expect(line2.classList.contains("selected-line")).toBeFalsy();
    expect(line3.classList.contains("selected-line")).toBeTruthy();

    // Keyboard Up Arrow
    fireEvent.keyDown(logContainerEl, { key: "ArrowUp", code: "ArrowUp" });
    expect(line1.classList.contains("selected-line")).toBeTruthy();
    expect(line2.classList.contains("selected-line")).toBeFalsy();
    expect(line3.classList.contains("selected-line")).toBeFalsy();
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
    const cSourceContent = document.getElementById("c-source-content");

    expect(cSourceContent).toBeVisible();

    const cSourceHideShow = cSourceEl?.querySelector(".hide-show-button");

    if (!cSourceHideShow) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(cSourceHideShow, createEvent.click(cSourceHideShow));
    expect(cSourceContent).not.toBeVisible();

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
    // Note: I haven't figured out how to get react-window to scroll in jest dom tests
    // so just make the list height static so it renders the lines we care about
    render(<App testListHeight={1000} />);

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

  it("labels the final error message", async () => {
    render(<App />);

    const inputEl = document.getElementById("input-text");
    if (!inputEl) {
      throw new Error(DOM_EL_FAIL);
    }

    fireEvent(
      inputEl,
      createEvent.paste(inputEl, {
        clipboardData: {
          getData: () => SAMPLE_LOG_DATA_ERORR,
        },
      }),
    );

    const line1El = document.getElementById("line-1");
    if (!line1El) {
      throw new Error(DOM_EL_FAIL);
    }

    expect(line1El.classList).toContain("error-message");
    expect(line1El.innerHTML).toBe(
      '<div class="pc-number">\n</div><div class="dep-arrow" line-id="1" id="dep-arrow-line-1"></div><div class="log-line-content">R6 invalid mem access \'scalar\'</div>',
    );
  });
});
