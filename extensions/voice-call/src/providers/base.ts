import type {
  HangupCallInput,
  InboundSmsEvent,
  InitiateCallInput,
  InitiateCallResult,
  PlayTtsInput,
  ProviderName,
  ProviderWebhookParseResult,
  SendSmsInput,
  SendSmsResult,
  SmsDeliveryEvent,
  StartListeningInput,
  StopListeningInput,
  WebhookContext,
  WebhookVerificationResult,
} from "../types.js";

/**
 * Abstract base interface for voice call providers.
 *
 * Each provider (Telnyx, Twilio, etc.) implements this interface to provide
 * a consistent API for the call manager.
 *
 * Responsibilities:
 * - Webhook verification and event parsing
 * - Outbound call initiation and hangup
 * - Media control (TTS playback, STT listening)
 */
export interface VoiceCallProvider {
  /** Provider identifier */
  readonly name: ProviderName;

  /**
   * Verify webhook signature/HMAC before processing.
   * Must be called before parseWebhookEvent.
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult;

  /**
   * Parse provider-specific webhook payload into normalized events.
   * Returns events and optional response to send back to provider.
   */
  parseWebhookEvent(ctx: WebhookContext): ProviderWebhookParseResult;

  /**
   * Initiate an outbound call.
   * @returns Provider call ID and status
   */
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;

  /**
   * Hang up an active call.
   */
  hangupCall(input: HangupCallInput): Promise<void>;

  /**
   * Play TTS audio to the caller.
   * The provider should handle streaming if supported.
   */
  playTts(input: PlayTtsInput): Promise<void>;

  /**
   * Start listening for user speech (activate STT).
   */
  startListening(input: StartListeningInput): Promise<void>;

  /**
   * Stop listening for user speech (deactivate STT).
   */
  stopListening(input: StopListeningInput): Promise<void>;

  // ---------------------------------------------------------------------------
  // SMS (optional — providers opt in by implementing these methods)
  // ---------------------------------------------------------------------------

  /** Whether this provider supports SMS send/receive. */
  supportsSms?(): boolean;

  /** Send an SMS message via the provider API. */
  sendSms?(input: SendSmsInput): Promise<SendSmsResult>;

  /**
   * Parse an inbound SMS webhook into a structured event.
   * Returns null if the webhook is not an SMS event.
   */
  parseSmsWebhookEvent?(ctx: WebhookContext): {
    inbound?: InboundSmsEvent;
    delivery?: SmsDeliveryEvent;
  } | null;
}
