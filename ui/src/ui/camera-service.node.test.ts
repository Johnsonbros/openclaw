import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cameraList, cameraSnap, cameraClip, handleCameraCommand } from "./camera-service.ts";

describe("camera-service", () => {
  const originalMediaDevices = globalThis.navigator?.mediaDevices;

  beforeEach(() => {
    // Reset module-level queue between tests
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: originalMediaDevices,
        configurable: true,
      });
    }
  });

  describe("cameraList", () => {
    it("returns device list from enumerateDevices", async () => {
      const mockDevices = [
        { kind: "videoinput", deviceId: "cam1", label: "Front Camera" },
        { kind: "audioinput", deviceId: "mic1", label: "Mic" },
        { kind: "videoinput", deviceId: "cam2", label: "" },
      ];
      Object.defineProperty(navigator, "mediaDevices", {
        value: { enumerateDevices: vi.fn().mockResolvedValue(mockDevices) },
        configurable: true,
      });

      const result = await cameraList();
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.result.devices).toHaveLength(2);
      expect(result.result.devices[0]).toEqual({
        id: "cam1",
        name: "Front Camera",
        position: "front",
        deviceType: "webcam",
      });
      // Unlabeled device gets a fallback name
      expect(result.result.devices[1].name).toMatch(/Camera cam2/);
    });

    it("returns UNAVAILABLE when mediaDevices is missing", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: undefined,
        configurable: true,
      });
      const result = await cameraList();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("UNAVAILABLE");
    });
  });

  describe("cameraSnap", () => {
    it("returns UNAVAILABLE when getUserMedia is missing", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { enumerateDevices: vi.fn() },
        configurable: true,
      });
      const result = await cameraSnap();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("UNAVAILABLE");
    });

    it("returns PERMISSION_DENIED on NotAllowedError", async () => {
      const err = new DOMException("not allowed", "NotAllowedError");
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
        configurable: true,
      });
      const result = await cameraSnap();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("PERMISSION_DENIED");
    });

    it("returns UNAVAILABLE on NotFoundError", async () => {
      const err = new DOMException("not found", "NotFoundError");
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
        configurable: true,
      });
      const result = await cameraSnap();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("UNAVAILABLE");
    });
  });

  describe("cameraClip", () => {
    it("returns UNAVAILABLE when getUserMedia is missing", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { enumerateDevices: vi.fn() },
        configurable: true,
      });
      const result = await cameraClip();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("UNAVAILABLE");
    });

    it("returns PERMISSION_DENIED on NotAllowedError", async () => {
      const err = new DOMException("denied", "NotAllowedError");
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
        configurable: true,
      });
      const result = await cameraClip();
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("handleCameraCommand", () => {
    it("dispatches camera.list", async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { enumerateDevices: vi.fn().mockResolvedValue([]) },
        configurable: true,
      });
      const result = await handleCameraCommand("camera.list", null);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const parsed = JSON.parse(result.payloadJSON);
      expect(parsed.devices).toEqual([]);
    });

    it("returns error for unknown command", async () => {
      const result = await handleCameraCommand("screen.record", null);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("UNKNOWN_COMMAND");
    });

    it("parses params JSON for camera.snap", async () => {
      const err = new DOMException("denied", "NotAllowedError");
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
        configurable: true,
      });
      const result = await handleCameraCommand("camera.snap", '{"maxWidth":800}');
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("PERMISSION_DENIED");
    });

    it("parses params JSON for camera.clip", async () => {
      const err = new DOMException("denied", "NotAllowedError");
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn().mockRejectedValue(err) },
        configurable: true,
      });
      const result = await handleCameraCommand("camera.clip", '{"durationMs":2000}');
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe("PERMISSION_DENIED");
    });
  });
});
