export type ComposerAvailability = {
  connected: boolean;
  gatewayConnected: boolean;
  sending: boolean;
  hasPrompt: boolean;
};

export function getComposerState({
  connected,
  gatewayConnected,
  sending,
  hasPrompt,
}: ComposerAvailability) {
  if (sending) {
    return { canSend: false, hint: "Sending prompt..." };
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
