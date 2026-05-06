import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgntuxLogo } from "../src/agntux-logo.js";
import { ComponentErrorBoundary } from "../src/error-boundary.js";
import { LicenseErrorScreen } from "../src/license-error-screen.js";
import { ScrollablePanel } from "../src/scrollable-panel.js";
import { Spinner } from "../src/spinner.js";

describe("AgntuxLogo", () => {
  it("renders an svg with the AgntUX label", () => {
    render(<AgntuxLogo />);
    expect(screen.getByLabelText("AgntUX")).toBeInTheDocument();
  });

  it("scales width from height", () => {
    const { container } = render(<AgntuxLogo height={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("height")).toBe("48");
    expect(Number(svg?.getAttribute("width"))).toBeCloseTo(180, 0);
  });
});

describe("Spinner", () => {
  it("renders a status role with the loading label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
  });

  it("respects a custom label", () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByRole("status")).toHaveAccessibleName("Saving");
  });
});

describe("LicenseErrorScreen", () => {
  it("renders the message verbatim", () => {
    render(
      <LicenseErrorScreen message={"Pairing required.\nLink: https://x"} />,
    );
    expect(screen.getByText(/Pairing required/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/x/)).toBeInTheDocument();
  });
});

describe("ScrollablePanel", () => {
  it("renders title, body and footer", () => {
    render(
      <ScrollablePanel title="My Panel" footer={<button>OK</button>}>
        <p>hello body</p>
      </ScrollablePanel>,
    );
    expect(screen.getByText("My Panel")).toBeInTheDocument();
    expect(screen.getByText("hello body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("hides dismiss/help buttons when no callbacks are passed", () => {
    render(
      <ScrollablePanel title="t">
        <span>x</span>
      </ScrollablePanel>,
    );
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
  });

  it("invokes onDismiss when × is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ScrollablePanel title="t" onDismiss={onDismiss}>
        <span>x</span>
      </ScrollablePanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("invokes onHelpClick when ? is clicked", () => {
    const onHelpClick = vi.fn();
    render(
      <ScrollablePanel title="t" onHelpClick={onHelpClick}>
        <span>x</span>
      </ScrollablePanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onHelpClick).toHaveBeenCalledOnce();
  });
});

describe("ComponentErrorBoundary", () => {
  function Boom(): never {
    throw new Error("kaboom");
  }

  it("renders children when nothing throws", () => {
    render(
      <ComponentErrorBoundary>
        <span>safe</span>
      </ComponentErrorBoundary>,
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
  });

  it("catches render errors and shows the retry surface", () => {
    // Suppress React's noisy error log during the throw assertion.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ComponentErrorBoundary>
        <Boom />
      </ComponentErrorBoundary>,
    );
    expect(screen.getByTestId("component-error-boundary")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("calls onError when a render throws", () => {
    const onError = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ComponentErrorBoundary onError={onError}>
        <Boom />
      </ComponentErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
