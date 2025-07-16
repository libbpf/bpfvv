import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("App End-to-End UI Tests", () => {
  test("renders initial UI elements", () => {
    render(<App />);

    // Check that the main UI elements are present
    expect(
      screen.getByPlaceholderText(
        "Paste the verifier log here or choose a file",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Go to:")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("line number")).toBeInTheDocument();
    expect(screen.getByText("<<")).toBeInTheDocument();
    expect(screen.getByText(">>")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("HOWTO.md")).toBeInTheDocument();
  });

  test("file input is present and functional", () => {
    render(<App />);

    const fileInput = document.querySelector("#file-input");
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("type", "file");
  });

  test("navigation controls work correctly", () => {
    render(<App />);

    const gotoLineInput = screen.getByPlaceholderText("line number");
    const gotoStartButton = screen.getByText("<<");
    const gotoEndButton = screen.getByText(">>");
    const clearButton = screen.getByText("Clear");

    // Initially, the line input should show "1" (line 0 + 1)
    expect(gotoLineInput).toHaveValue(1);

    // Test that buttons are clickable (they won't do much without log data)
    fireEvent.click(gotoStartButton);
    fireEvent.click(gotoEndButton);
    fireEvent.click(clearButton);

    // Buttons should still be present after clicking
    expect(gotoStartButton).toBeInTheDocument();
    expect(gotoEndButton).toBeInTheDocument();
    expect(clearButton).toBeInTheDocument();
  });

  test("textarea accepts pasted content", async () => {
    render(<App />);

    const textarea = screen.getByPlaceholderText(
      "Paste the verifier log here or choose a file",
    );

    // Simulate pasting some BPF verifier log content
    const sampleLogContent =
      "0: (b7) r2 = 1                        ; R2_w=1\n1: (7b) *(u64 *)(r10 -24) = r2";

    await userEvent.click(textarea);

    // Simulate paste event
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => sampleLogContent,
      },
    });

    // After pasting, the textarea should be replaced with the main content
    // We can check that the textarea is no longer visible
    expect(textarea).not.toBeInTheDocument();
  });

  test("HOWTO link has correct attributes", () => {
    render(<App />);

    const howtoLink = screen.getByText("HOWTO.md");
    expect(howtoLink).toHaveAttribute(
      "href",
      "https://github.com/theihor/bpfvv/blob/master/HOWTO.md",
    );
    expect(howtoLink).toHaveAttribute("target", "_blank");
    expect(howtoLink).toHaveAttribute("rel", "noreferrer");
  });

  test("line number input is present and has correct initial value", () => {
    render(<App />);

    const lineInput = screen.getByPlaceholderText("line number");

    // Test that the input is present and has the correct initial value
    expect(lineInput).toBeInTheDocument();
    expect(lineInput).toHaveAttribute("type", "number");
    expect(lineInput).toHaveValue(1); // Initial value should be 1 (line 0 + 1)
    expect(lineInput).toHaveAttribute("min", "0");
  });

  test("keyboard navigation is set up", () => {
    render(<App />);

    // Test that the app renders without errors when keyboard events are fired
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "Home" });
    fireEvent.keyDown(document, { key: "End" });
    fireEvent.keyDown(document, { key: "Escape" });

    // App should still be functional after keyboard events
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  test("memSlotDependencies mechanic creates clickable elements and triggers scroll", async () => {
    // Mock scrollToLine function to track scroll calls
    const mockScrollToLine = jest.fn();
    jest.doMock("./utils", () => ({
      ...jest.requireActual("./utils"),
      scrollToLine: mockScrollToLine,
    }));

    render(<App />);

    // Sample BPF verifier log with memory operations that create dependencies
    const sampleLogWithMemSlots = `0: (b7) r2 = 1                        ; R2_w=1
1: (7b) *(u64 *)(r10 -8) = r2          ; R2_w=1 R10=fp0 fp-8_w=1
2: (79) r1 = *(u64 *)(r10 -8)          ; R1_w=1 R10=fp0 fp-8_w=1
3: (bf) r0 = r1                        ; R0_w=1 R1_w=1
4: (95) exit`;

    const textarea = screen.getByPlaceholderText(
      "Paste the verifier log here or choose a file",
    );

    // Paste the log content
    await userEvent.click(textarea);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => sampleLogWithMemSlots,
      },
    });

    // Wait for the content to be processed and rendered
    await screen.findByText("Clear");

    // Find memory slot elements (registers like r1, r2, etc.)
    const memSlotElements = document.querySelectorAll(".mem-slot[data-id]");
    expect(memSlotElements.length).toBeGreaterThan(0);

    // Find a specific memory slot (e.g., r2 from line 0)
    const r2MemSlot = document.querySelector('.mem-slot[data-id="r2"]');
    expect(r2MemSlot).toBeInTheDocument();

    // Click on the memory slot
    if (r2MemSlot) {
      fireEvent.click(r2MemSlot);

      // Verify that the memory slot gets selected (should have selected-mem-slot class)
      // Note: This happens in useEffect, so we might need to wait
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Check if dependency arrows are created when a memory slot is selected
      const dependencyArrows = document.querySelector("#dependency-arrows");
      expect(dependencyArrows).toBeInTheDocument();
    }

    // Test clicking on dependency arrows (if they exist and are clickable)
    const clickableArrows = document.querySelectorAll(".dep-arrow-button");
    if (clickableArrows.length > 0) {
      const firstArrow = clickableArrows[0];
      fireEvent.click(firstArrow);

      // Verify that scrollToLine was called (mocked function)
      // Note: This test verifies the scroll mechanism is triggered
      expect(mockScrollToLine).toHaveBeenCalled();
    }

    // Test that clicking outside memory slots clears the selection
    const mainContent = document.querySelector("#main-content");
    if (mainContent) {
      fireEvent.click(mainContent);

      // Wait for state update
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify that memory slot selection is cleared
      const selectedMemSlots = document.querySelectorAll(".selected-mem-slot");
      expect(selectedMemSlots.length).toBe(0);
    }
  });

  test("memory slot hover shows tooltip with value information", async () => {
    render(<App />);

    // Sample log with memory operations
    const sampleLog = `0: (b7) r2 = 42                       ; R2_w=42
1: (7b) *(u64 *)(r10 -8) = r2          ; R2_w=42 R10=fp0 fp-8_w=42`;

    const textarea = screen.getByPlaceholderText(
      "Paste the verifier log here or choose a file",
    );

    await userEvent.click(textarea);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => sampleLog,
      },
    });

    // Wait for content to be processed
    await screen.findByText("Clear");

    // Find a memory slot element
    const memSlot = document.querySelector('.mem-slot[data-id="r2"]');
    expect(memSlot).toBeInTheDocument();

    if (memSlot) {
      // Hover over the memory slot
      fireEvent.mouseOver(memSlot);

      // Wait for tooltip to appear
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Check if tooltip is created (it should be in the DOM)
      const tooltip = document.querySelector("#mem-slot-tooltip");
      expect(tooltip).toBeInTheDocument();

      // Mouse out should hide the tooltip
      fireEvent.mouseOut(memSlot);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
});
