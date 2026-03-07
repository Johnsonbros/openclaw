#!/usr/bin/env node
/**
 * Send a chat message to ZEKE and stream back the response.
 * Usage: node scripts/send-and-wait.mjs "your message here"
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WS = require("../node_modules/.pnpm/ws@8.19.0/node_modules/ws/index.js");

const GATEWAY_URL = "ws://100.82.144.92:18789";
const TOKEN = "493fb5919a16b885fe34bcded2b5e5df4f5c3f2166c361d9";
const SESSION_KEY = "main";
const TIMEOUT_MS = 120_000; // 2 minutes max wait

const message = process.argv[2];
if (!message) {
  console.error("Usage: node scripts/send-and-wait.mjs 'message'");
  process.exit(1);
}

let reqId = 0;
function nextId() { return `sw-${++reqId}`; }

const ws = new WS(GATEWAY_URL);
let connected = false;
let runId = null;
let responseText = "";

const timeout = setTimeout(() => {
  console.log("\n--- TIMEOUT ---");
  if (responseText) console.log("Partial response:", responseText);
  ws.close();
  process.exit(0);
}, TIMEOUT_MS);

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "req",
    id: nextId(),
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "cli",
        displayName: "Send-Wait",
        platform: "windows",
        mode: "cli",
        version: "1.0.0",
      },
      auth: { token: TOKEN },
      scopes: ["operator.admin"],
      caps: ["tool-events"],
    },
  }));
});

ws.on("message", (raw) => {
  const frame = JSON.parse(raw.toString());

  // Connect response
  if (frame.type === "res" && !connected) {
    if (frame.ok) {
      connected = true;
      console.log("Connected. Sending message...");
      ws.send(JSON.stringify({
        type: "req",
        id: nextId(),
        method: "chat.send",
        params: {
          sessionKey: SESSION_KEY,
          message: message,
          idempotencyKey: `sw-${Date.now()}`,
        },
      }));
    } else {
      console.error("Connect failed:", frame.error?.message);
      ws.close();
      process.exit(1);
    }
    return;
  }

  // Chat.send response
  if (frame.type === "res" && connected && !runId) {
    if (frame.ok) {
      runId = frame.payload?.runId;
      console.log("Run started:", runId);
      console.log("Waiting for response...\n");
    } else {
      console.error("Send failed:", frame.error?.message);
      ws.close();
      process.exit(1);
    }
    return;
  }

  // Stream events from ZEKE — gateway uses type:"event", event:"chat"|"agent"
  if (frame.type === "event") {
    const evtName = frame.event || "";

    // Chat events: payload.state is "delta", "final", or "error"
    if (evtName === "chat") {
      const state = frame.payload?.state;
      const msg = frame.payload?.message;

      if (state === "delta" && msg?.content) {
        const text = msg.content.map(c => c.text || "").join("");
        if (text) {
          process.stdout.write(text);
          responseText += text;
        }
      }

      if (state === "final") {
        const text = msg?.content?.map(c => c.text || "").join("") || "";
        if (text && !responseText.endsWith(text)) {
          process.stdout.write(text);
        }
        console.log("\n\n--- COMPLETE ---");
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }

      if (state === "error") {
        console.error("\n\n--- ERROR ---", frame.payload?.errorMessage || "");
        clearTimeout(timeout);
        ws.close();
        process.exit(1);
      }
    }

    // Agent events (tool use, thinking, etc.)
    if (evtName === "agent") {
      const p = frame.payload || {};
      const stream = p.stream || "";
      const data = p.data || {};

      // Lifecycle events
      if (stream === "lifecycle") {
        const phase = data.phase || data.type || "";
        if (phase === "end" || phase === "error") {
          // Agent run finished — if no chat text came, exit
          if (!responseText) {
            console.log("\n[Agent finished — no chat output]");
          }
        }
      }

      // Assistant text stream
      if (stream === "assistant") {
        const text = data.text || data.content || "";
        if (text) {
          process.stdout.write(text);
          responseText += text;
        }
      }

      // Tool events
      if (stream === "tool") {
        const name = data.name || data.tool || "";
        const input = data.input;
        const result = data.result;
        if (name && !result) {
          console.log(`\n[Tool: ${name}]`);
          if (input && typeof input === "object" && input.command) {
            console.log(`  $ ${input.command.substring(0, 200)}`);
          }
        }
        if (result && typeof result === "string") {
          console.log(`[Result: ${result.substring(0, 500)}]`);
        }
      }
    }
  }
});

ws.on("error", (err) => {
  console.error("Error:", err.message);
});

ws.on("close", () => {
  clearTimeout(timeout);
  process.exit(0);
});
