export type ComposerAvailability = {
  connected: boolean;
  gatewayConnected: boolean;
  sending: boolean;
  hasPrompt: boolean;
  runtime?: "hermes" | "opencode";
  opencodeOnline?: boolean;
};

export function getComposerState({
  connected,
  gatewayConnected,
  sending,
  hasPrompt,
  runtime = "hermes",
  opencodeOnline = true,
}: ComposerAvailability) {
  if (sending) {
    return {
      canSend: false,
      hint: runtime === "opencode" ? "Sending prompt to OpenCode..." : "Sending prompt...",
    };
  }

  if (runtime === "opencode") {
    if (!opencodeOnline) {
      return { canSend: false, hint: "OpenCode service is offline" };
    }
    return {
      canSend: hasPrompt,
      hint: hasPrompt
        ? "Enter to send to OpenCode · Shift+Enter for newline"
        : "Type a prompt for OpenCode",
    };
  }

  if (!connected) {
    return { canSend: false, hint: "Reconnecting to Hermes..." };
  }

  if (!gatewayConnected) {
    return { canSend: false, hint: "Waiting for the Gateway..." };
  }

  return {
    canSend: hasPrompt,
    hint: hasPrompt ? "Enter to send · Shift+Enter for newline" : "Type a prompt to begin",
  };
}
