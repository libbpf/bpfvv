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
});
