const WebSocket = require("ws");

const HERMES_TOKEN = process.env.HERMES_TOKEN;

if (!HERMES_TOKEN) {
  throw new Error("HERMES_TOKEN belum tersedia");
}

const hermesUrl =
  `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(HERMES_TOKEN)}`;

const hermes = new WebSocket(hermesUrl);

const officeServer = new WebSocket.Server({
  port: 3001,
});

const clients = new Set();

let requestId = 1;
let activeSessionId = null;

/* =========================================================
   BROADCAST
========================================================= */

function broadcast(message) {
  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/* =========================================================
   HERMES RPC
========================================================= */

function sendRpc(method, params) {
  if (hermes.readyState !== WebSocket.OPEN) {
    console.log(
      "⚠️ Hermes Gateway belum connected"
    );

    return;
  }

  const id = requestId++;

  const message = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  console.log("📤 RPC:", method);

  hermes.send(JSON.stringify(message));
}

/* =========================================================
   OFFICE CLIENT
========================================================= */

officeServer.on("connection", (client) => {
  console.log("🏢 Office client connected");

  clients.add(client);

  /*
   * Buat session Hermes baru ketika Office pertama kali connect.
   */
  if (!activeSessionId) {
    console.log(
      "🚀 Starting Hermes session for Office..."
    );

    sendRpc("session.create", {});
  } else {
    console.log(
      "♻️ Using existing Hermes session:",
      activeSessionId
    );
  }

  /*
   * Terima command dari browser.
   */
  client.on("message", (raw) => {
    try {
      const message =
        JSON.parse(raw.toString());

      console.log(
        "📥 OFFICE MESSAGE:",
        message.type
      );

      if (message.type === "prompt") {
        const text =
          String(message.text ?? "").trim();

        if (!text) {
          console.log(
            "⚠️ Empty prompt ignored"
          );

          return;
        }

        if (!activeSessionId) {
          console.log(
            "⚠️ No active Hermes session"
          );

          /*
           * Beri tahu browser bahwa session
           * belum siap.
           */
          client.send(
            JSON.stringify({
              type: "office.error",
              payload: {
                message:
                  "Hermes session belum siap.",
              },
            })
          );

          return;
        }

        console.log(
          "💬 Office prompt:",
          text
        );

        sendRpc("prompt.submit", {
          session_id:
            activeSessionId,
          text,
        });
      }
    } catch (error) {
      console.error(
        "❌ Invalid Office message:",
        error
      );
    }
  });

  client.on("close", () => {
    clients.delete(client);

    console.log(
      "🏢 Office client disconnected"
    );
  });
});

/* =========================================================
   HERMES CONNECTION
========================================================= */

hermes.on("open", () => {
  console.log(
    "🤖 Connected to Hermes Gateway"
  );
});

hermes.on("message", (data) => {
  let message;

  try {
    message =
      JSON.parse(data.toString());
  } catch {
    return;
  }

  /* =======================================================
     RPC RESPONSE
  ======================================================= */

  if (message.id !== undefined) {
    console.log(
      "📥 RPC RESPONSE:",
      JSON.stringify(message)
    );

    /*
     * session.create berhasil.
     */
    if (
      message.result?.session_id &&
      !activeSessionId
    ) {
      activeSessionId =
        message.result.session_id;

      console.log(
        "🎯 Active Hermes session:",
        activeSessionId
      );

      /*
       * Beri tahu browser bahwa session
       * sudah siap.
       */
      broadcast({
        type: "office.session.ready",
        session_id:
          activeSessionId,
        payload: {},
      });
    }

    return;
  }

  /* =======================================================
     HERMES EVENT
  ======================================================= */

  if (
    message.method === "event" &&
    message.params
  ) {
    const event = {
      type: message.params.type,
      session_id:
        message.params.session_id,
      payload:
        message.params.payload ?? {},
    };

    console.log(
      "📡 HERMES EVENT:",
      event.type,
      event.session_id || ""
    );

    broadcast(event);
  }
});

/* =========================================================
   HERMES DISCONNECT
========================================================= */

hermes.on("close", () => {
  console.log(
    "❌ Hermes Gateway disconnected"
  );

  activeSessionId = null;

  broadcast({
    type: "gateway.disconnected",
    payload: {},
  });
});

hermes.on("error", (error) => {
  console.error(
    "❌ Hermes error:",
    error.message
  );
});

/* =========================================================
   START
========================================================= */

console.log(
  "🏢 Hermes Office Bridge"
);

console.log(
  "   WebSocket: ws://127.0.0.1:3001"
);