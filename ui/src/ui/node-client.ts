/**
 * Browser-side WebSocket node client.
 *
 * Opens a second WS connection to the gateway with `role: "node"` so the
 * browser can serve camera commands (camera.list / camera.snap / camera.clip).
 * Mirrors the pattern used by native companion apps (macOS, iOS, Android).
 */

import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_IDS,
} from "../../../src/gateway/protocol/client-info.js";
import { handleCameraCommand } from "./camera-service.ts";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "./device-identity.ts";
import { generateUUID } from "./uuid.ts";

const NODE_COMMANDS = ["camera.list", "camera.snap", "camera.clip"] as const;

type NodeInvokeRequest = {
  id: string;
  nodeId: string;
  command: string;
  paramsJSON: string | null;
  timeoutMs?: number;
  idempotencyKey?: string;
};

type NodeEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

type NodeResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

type NodeHelloOk = {
  type: "hello-ok";
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type BrowserNodeClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientVersion?: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

export class BrowserNodeClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private nodeId: string | null = null;

  constructor(private opts: BrowserNodeClientOptions) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error("node client stopped"));
  }

  private connect() {
    if (this.closed) {
      return;
    }
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener("open", () => this.queueConnect());
    this.ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    this.ws.addEventListener("close", () => {
      this.ws = null;
      this.flushPending(new Error("node ws closed"));
      this.opts.onDisconnected?.();
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      // close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    window.setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;

    const role = "node";
    const scopes: string[] = [];
    let deviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null = null;
    let canFallbackToShared = false;
    let authToken = this.opts.token;

    if (isSecureContext) {
      deviceIdentity = await loadOrCreateDeviceIdentity();
      const storedToken = loadDeviceAuthToken({
        deviceId: deviceIdentity.deviceId,
        role,
      })?.token;
      authToken = storedToken ?? this.opts.token;
      canFallbackToShared = Boolean(storedToken && this.opts.token);
    }

    const auth =
      authToken || this.opts.password
        ? { token: authToken, password: this.opts.password }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string | undefined;
        }
      | undefined;

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? undefined;
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: GATEWAY_CLIENT_IDS.WEBCHAT_NODE,
        clientMode: GATEWAY_CLIENT_MODES.NODE,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: GATEWAY_CLIENT_IDS.WEBCHAT_NODE,
        displayName: "WebChat Camera",
        version: this.opts.clientVersion ?? "dev",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.NODE,
      },
      role,
      scopes,
      device,
      caps: [],
      commands: [...NODE_COMMANDS],
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    void this.request<NodeHelloOk>("connect", params)
      .then((hello) => {
        if (hello?.auth?.deviceToken && deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: deviceIdentity.deviceId,
            role: hello.auth.role ?? role,
            token: hello.auth.deviceToken,
            scopes: hello.auth.scopes ?? [],
          });
        }
        // Store the nodeId for invoke result responses
        this.nodeId = deviceIdentity?.deviceId ?? GATEWAY_CLIENT_IDS.WEBCHAT_NODE;
        this.backoffMs = 800;
        this.opts.onConnected?.();
      })
      .catch(() => {
        if (canFallbackToShared && deviceIdentity) {
          clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role });
        }
        this.ws?.close(4008, "connect failed");
      });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };

    if (frame.type === "event") {
      const evt = parsed as NodeEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          void this.sendConnect();
        }
        return;
      }
      if (evt.event === "node.invoke.request") {
        void this.handleInvokeRequest(evt.payload as NodeInvokeRequest);
        return;
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as NodeResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(new Error(res.error?.message ?? "request failed"));
      }
    }
  }

  private async handleInvokeRequest(req: NodeInvokeRequest) {
    if (!req?.id || !req?.command) {
      return;
    }

    const result = await handleCameraCommand(req.command, req.paramsJSON);
    const nodeId = this.nodeId ?? req.nodeId;

    if (result.ok) {
      this.sendFrame("node.invoke.result", {
        id: req.id,
        nodeId,
        ok: true,
        payloadJSON: result.payloadJSON,
      });
    } else {
      this.sendFrame("node.invoke.result", {
        id: req.id,
        nodeId,
        ok: false,
        error: result.error,
      });
    }
  }

  /** Fire-and-forget: send a frame without tracking a response. */
  private sendFrame(method: string, params: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const id = generateUUID();
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
  }

  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("node ws not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }
}
