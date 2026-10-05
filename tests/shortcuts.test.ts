// The keyboard shortcut guard (web/src/ui/shortcuts.ts): shortcuts must
// never fire while a field has focus, or a key a menu or a dialog already
// claimed (defaultPrevented). Pure and DOM-free: setupShortcuts is driven
// against a fake document-like object instead of jsdom.

import { describe, expect, it, vi } from "vitest";
import { type FocusLike, type ShortcutHandlers, isTypingIn, setupShortcuts } from "../web/src/ui/shortcuts";

/** A document-like object just big enough for setupShortcuts: records the one keydown listener it attaches, and lets a test fire a fake event straight into it. */
function fakeRoot(activeElement: FocusLike | null = null) {
  let handler: ((e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; defaultPrevented?: boolean }) => void) | null = null;
  return {
    activeElement,
    addEventListener: (_type: string, fn: typeof handler) => {
      handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
    fire: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; defaultPrevented?: boolean }) => handler?.(e),
  };
}

function noopHandlers(): ShortcutHandlers {
  return { another: vi.fn(), tryLook: vi.fn(), original: vi.fn(), step: vi.fn(), download: vi.fn(), help: vi.fn() };
}

describe("isTypingIn", () => {
  it("is false for nothing focused, or a plain element like a button or the body", () => {
    expect(isTypingIn(null)).toBe(false);
    expect(isTypingIn({ tagName: "BODY" })).toBe(false);
    expect(isTypingIn({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingIn({ tagName: "A" })).toBe(false);
  });

  it("is true for a textarea, a select, and a contenteditable element", () => {
    expect(isTypingIn({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingIn({ tagName: "SELECT" })).toBe(true);
    expect(isTypingIn({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is true for a text-entry input, false for a checkbox, radio, range or button input", () => {
    expect(isTypingIn({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingIn({ tagName: "INPUT" })).toBe(true); // the default input type is text
    expect(isTypingIn({ tagName: "INPUT", type: "email" })).toBe(true);
    expect(isTypingIn({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingIn({ tagName: "INPUT", type: "radio" })).toBe(false);
    expect(isTypingIn({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTypingIn({ tagName: "INPUT", type: "button" })).toBe(false);
  });

  it("is case-insensitive on the tag name and the input type", () => {
    expect(isTypingIn({ tagName: "textarea" })).toBe(true);
    expect(isTypingIn({ tagName: "input", type: "CHECKBOX" })).toBe(false);
  });
});

describe("setupShortcuts", () => {
  it("calls the matching handler for a plain key", () => {
    const root = fakeRoot();
    const handlers = noopHandlers();
    setupShortcuts(handlers, root);
    root.fire({ key: "o" });
    expect(handlers.another).toHaveBeenCalledOnce();
    root.fire({ key: "s" });
    expect(handlers.download).toHaveBeenCalledOnce();
    root.fire({ key: "1" });
    expect(handlers.tryLook).toHaveBeenCalledWith(0);
    root.fire({ key: "[" });
    expect(handlers.step).toHaveBeenCalledWith(-1);
  });

  it("skips a key a menu or a dialog already claimed (defaultPrevented): Esc does one thing", () => {
    const root = fakeRoot();
    const handlers = noopHandlers();
    setupShortcuts(handlers, root);
    root.fire({ key: "Escape", defaultPrevented: true });
    expect(handlers.original).not.toHaveBeenCalled();
    root.fire({ key: "Escape" });
    expect(handlers.original).toHaveBeenCalledOnce();
  });

  it("skips while typing in a field", () => {
    const root = fakeRoot({ tagName: "INPUT", type: "text" });
    const handlers = noopHandlers();
    setupShortcuts(handlers, root);
    root.fire({ key: "o" });
    expect(handlers.another).not.toHaveBeenCalled();
  });

  it("skips a modified key (Cmd/Ctrl/Alt), leaving browser and OS shortcuts alone", () => {
    const root = fakeRoot();
    const handlers = noopHandlers();
    setupShortcuts(handlers, root);
    root.fire({ key: "o", metaKey: true });
    root.fire({ key: "o", ctrlKey: true });
    root.fire({ key: "o", altKey: true });
    expect(handlers.another).not.toHaveBeenCalled();
  });

  it("the cleanup function stops the listener", () => {
    const root = fakeRoot();
    const handlers = noopHandlers();
    const stop = setupShortcuts(handlers, root);
    stop();
    root.fire({ key: "o" });
    expect(handlers.another).not.toHaveBeenCalled();
  });
});
