import { describe, expect, it } from "vitest";
import type { WebhookContext } from "../types.js";
import { TwilioProvider } from "./twilio.js";

// Create a provider with test credentials (API calls are not made in unit tests)
function createTestProvider(): TwilioProvider {
  return new TwilioProvider(
    { accountSid: "ACtest123", authToken: "test_auth_token" },
    { skipVerification: true },
  );
}

describe("TwilioProvider SMS", () => {
  describe("supportsSms", () => {
    it("returns true", () => {
      const provider = createTestProvider();
      expect(provider.supportsSms()).toBe(true);
    });
  });

  describe("parseSmsWebhookEvent", () => {
    it("parses inbound SMS webhook", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        MessageSid: "SM123abc",
        From: "+15551234567",
        To: "+15559876543",
        Body: "Hello from SMS",
        NumMedia: "0",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result).not.toBeNull();
      expect(result!.inbound).toBeDefined();
      expect(result!.inbound!.messageId).toBe("SM123abc");
      expect(result!.inbound!.from).toBe("+15551234567");
      expect(result!.inbound!.to).toBe("+15559876543");
      expect(result!.inbound!.body).toBe("Hello from SMS");
      expect(result!.inbound!.mediaUrls).toHaveLength(0);
    });

    it("parses inbound MMS with media", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        MessageSid: "SM456def",
        From: "+15551234567",
        To: "+15559876543",
        Body: "Check this out",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/img1.jpg",
        MediaUrl1: "https://api.twilio.com/media/img2.png",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result!.inbound!.mediaUrls).toHaveLength(2);
      expect(result!.inbound!.mediaUrls[0]).toContain("img1.jpg");
    });

    it("parses delivery status webhook", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        MessageSid: "SM789ghi",
        MessageStatus: "delivered",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result).not.toBeNull();
      expect(result!.delivery).toBeDefined();
      expect(result!.delivery!.messageId).toBe("SM789ghi");
      expect(result!.delivery!.status).toBe("delivered");
    });

    it("parses failed delivery status", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        MessageSid: "SMfailed",
        MessageStatus: "failed",
        ErrorCode: "30001",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result!.delivery!.status).toBe("failed");
      expect(result!.delivery!.errorCode).toBe("30001");
    });

    it("returns null for non-SMS webhook (voice call)", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        CallSid: "CA123",
        CallStatus: "ringing",
        From: "+15551234567",
        To: "+15559876543",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result).toBeNull();
    });

    it("handles SmsSid alias for MessageSid", () => {
      const provider = createTestProvider();

      const body = new URLSearchParams({
        SmsSid: "SM_legacy",
        From: "+15551234567",
        To: "+15559876543",
        Body: "Legacy format",
        NumMedia: "0",
      }).toString();

      const ctx: WebhookContext = {
        headers: {},
        rawBody: body,
        url: "https://example.com/sms/webhook",
        method: "POST",
      };

      const result = provider.parseSmsWebhookEvent(ctx);
      expect(result!.inbound!.messageId).toBe("SM_legacy");
    });
  });
});
