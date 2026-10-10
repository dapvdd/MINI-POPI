import { describe, expect, it } from "vitest";
import { getComposerState } from "./composer";

const available = {
  connected: true,
  gatewayConnected: true,
  sending: false,
};

describe("getComposerState", () => {
  it("keeps sending disabled while SSE reconnects", () => {
    expect(
      getComposerState({ ...available, connected: false, hasPrompt: true }),
    ).toEqual({ canSend: false, hint: "Reconnecting to Hermes..." });
  });

  it("does not submit while the Gateway is offline", () => {
    expect(
      getComposerState({ ...available, gatewayConnected: false, hasPrompt: true }),
    ).toEqual({ canSend: false, hint: "Waiting for the Gateway..." });
  });

  it("allows a non-empty prompt when both links are ready", () => {
    expect(getComposerState({ ...available, hasPrompt: true })).toEqual({
      canSend: true,
      hint: "Enter to send · Shift+Enter for newline",
    });
  });

  it("prioritizes the active send state", () => {
    expect(
      getComposerState({ ...available, sending: true, hasPrompt: true }),
    ).toEqual({ canSend: false, hint: "Sending prompt..." });
  });
});
