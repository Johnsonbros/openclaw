import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/gateway/device-auth.js", () => ({
  buildDeviceAuthPayload: vi.fn(() => "mock-payload"),
}));

vi.mock("./device-auth.ts", () => ({
  loadDeviceAuthToken: vi.fn(() => null),
  storeDeviceAuthToken: vi.fn(),
  clearDeviceAuthToken: vi.fn(),
}));

vi.mock("./device-identity.ts", () => ({
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: "test-device-id",
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  })),
  signDevicePayload: vi.fn(async () => "mock-signature"),
}));

vi.mock("./uuid.ts", () => {
  let seq = 0;
  return { generateUUID: () => `uuid-${++seq}` };
});

vi.mock("./camera-service.ts", () => ({
  handleCameraCommand: vi.fn(async (command: string) => {
    if (command === "camera.list") {
      return { ok: true, payloadJSON: '{"devices":[]}' };
    }
    return { ok: false, error: { code: "UNKNOWN_COMMAND", message: `Unknown: ${command}` } };
  }),
}));

type WsListener = (ev: { data?: string }) => void;
type WsOpenListener = () => void;
type WsCloseListener = (ev: { code: number; reason: string }) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = MockWebSocket.OPEN;
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  sent: string[] = [];

  addEventListener(type: string, fn: (...args: unknown[]) => void) {
    (this.listeners[type] ??= []).push(fn);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  // Test helpers
  triggerOpen() {
    for (const fn of this.listeners["open"] ?? []) {
      (fn as WsOpenListener)();
    }
  }

  triggerMessage(data: string) {
    for (const fn of this.listeners["message"] ?? []) {
      (fn as WsListener)({ data });
    }
  }

  triggerClose(code = 1000, reason = "") {
    for (const fn of this.listeners["close"] ?? []) {
      (fn as WsCloseListener)({ code, reason });
    }
  }
}

const wsInstances: MockWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

function latestWs(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}

describe("BrowserNodeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances.length = 0;
    // Subclass to capture instances without this-aliasing
    class CapturingWebSocket extends MockWebSocket {
      constructor() {
        super();
        wsInstances.push(this as unknown as MockWebSocket);
      }
    }
    (globalThis as Record<string, unknown>).WebSocket = CapturingWebSocket;
    // crypto.subtle must exist for device identity path
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, "crypto", {
        value: { subtle: {}, getRandomValues: (arr: Uint8Array) => arr },
        configurable: true,
      });
    }
    // window must exist for window.setTimeout/clearTimeout in browser code
    if (typeof globalThis.window === "undefined") {
      (globalThis as Record<string, unknown>).window = globalThis;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.WebSocket = originalWebSocket;
  });

  async function importAndCreate() {
    // Dynamic import so mocks are in place
    const { BrowserNodeClient } = await import("./node-client.ts");
    return new BrowserNodeClient({
      url: "ws://localhost:18789",
      token: "test-token",
      password: "",
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
    });
  }

  it("sends connect frame with role node and camera commands", async () => {
    const client = await importAndCreate();
    client.start();
    expect(wsInstances.length).toBeGreaterThan(0);

    // Trigger open → queueConnect schedules sendConnect after 750ms
    latestWs().triggerOpen();
    await vi.advanceTimersByTimeAsync(800);

    // Should have sent a connect request
    expect(latestWs().sent.length).toBeGreaterThanOrEqual(1);
    const frame = JSON.parse(latestWs().sent[0]);
    expect(frame.type).toBe("req");
    expect(frame.method).toBe("connect");
    expect(frame.params.role).toBe("node");
    expect(frame.params.client.id).toBe("webchat-node");
    expect(frame.params.client.platform).toBe("web");
    expect(frame.params.client.mode).toBe("node");
    expect(frame.params.client.displayName).toBe("WebChat Camera");
    expect(frame.params.commands).toEqual(["camera.list", "camera.snap", "camera.clip"]);

    // Resolve the pending connect before stopping to avoid unhandled rejection
    latestWs().triggerMessage(
      JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { type: "hello-ok", auth: {} },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    client.stop();
  });

  it("dispatches node.invoke.request to camera handler", async () => {
    const { handleCameraCommand } = await import("./camera-service.ts");
    const client = await importAndCreate();
    client.start();
    latestWs().triggerOpen();
    await vi.advanceTimersByTimeAsync(800);

    // Respond to the connect request with hello-ok
    const connectFrame = JSON.parse(latestWs().sent[0]);
    latestWs().triggerMessage(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: { type: "hello-ok", auth: {} },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    // Reset sent to track invoke result
    latestWs().sent.length = 0;

    // Send a node.invoke.request event
    latestWs().triggerMessage(
      JSON.stringify({
        type: "event",
        event: "node.invoke.request",
        payload: {
          id: "invoke-1",
          nodeId: "test-device-id",
          command: "camera.list",
          paramsJSON: null,
        },
      }),
    );

    // Let the async camera handler resolve
    await vi.advanceTimersByTimeAsync(100);

    expect(handleCameraCommand).toHaveBeenCalledWith("camera.list", null);

    // Should have sent a node.invoke.result
    expect(latestWs().sent.length).toBeGreaterThanOrEqual(1);
    const resultFrame = JSON.parse(latestWs().sent[0]);
    expect(resultFrame.method).toBe("node.invoke.result");
    expect(resultFrame.params.id).toBe("invoke-1");
    expect(resultFrame.params.ok).toBe(true);
    expect(resultFrame.params.payloadJSON).toBe('{"devices":[]}');

    client.stop();
  });

  it("sends error result for unknown commands", async () => {
    const client = await importAndCreate();
    client.start();
    latestWs().triggerOpen();
    await vi.advanceTimersByTimeAsync(800);

    const connectFrame = JSON.parse(latestWs().sent[0]);
    latestWs().triggerMessage(
      JSON.stringify({
        type: "res",
        id: connectFrame.id,
        ok: true,
        payload: { type: "hello-ok", auth: {} },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    latestWs().sent.length = 0;

    latestWs().triggerMessage(
      JSON.stringify({
        type: "event",
        event: "node.invoke.request",
        payload: {
          id: "invoke-2",
          nodeId: "test-device-id",
          command: "screen.record",
          paramsJSON: null,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(latestWs().sent.length).toBeGreaterThanOrEqual(1);
    const resultFrame = JSON.parse(latestWs().sent[0]);
    expect(resultFrame.params.ok).toBe(false);
    expect(resultFrame.params.error.code).toBe("UNKNOWN_COMMAND");

    client.stop();
  });

  it("handles connect challenge nonce", async () => {
    const client = await importAndCreate();
    client.start();
    latestWs().triggerOpen();

    // Send challenge before the 750ms timer
    latestWs().triggerMessage(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test-nonce" },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    // Should have sent connect immediately after challenge
    expect(latestWs().sent.length).toBeGreaterThanOrEqual(1);
    const frame = JSON.parse(latestWs().sent[0]);
    expect(frame.method).toBe("connect");

    // Resolve the pending connect before stopping to avoid unhandled rejection
    latestWs().triggerMessage(
      JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { type: "hello-ok", auth: {} },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    client.stop();
  });
});
