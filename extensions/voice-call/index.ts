import { Type } from "@sinclair/typebox";
import type { CoreConfig } from "./src/core-bridge.js";
import { registerVoiceCallCli } from "./src/cli.js";
import {
  VoiceCallConfigSchema,
  resolveVoiceCallConfig,
  validateProviderConfig,
  type VoiceCallConfig,
} from "./src/config.js";
import { createVoiceCallRuntime, type VoiceCallRuntime } from "./src/runtime.js";

const voiceCallConfigSchema = {
  parse(value: unknown): VoiceCallConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const twilio = raw.twilio as Record<string, unknown> | undefined;
    const legacyFrom = typeof twilio?.from === "string" ? twilio.from : undefined;

    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
    const providerRaw = raw.provider === "log" ? "mock" : raw.provider;
    const provider = providerRaw ?? (enabled ? "mock" : undefined);

    return VoiceCallConfigSchema.parse({
      ...raw,
      enabled,
      provider,
      fromNumber: raw.fromNumber ?? legacyFrom,
    });
  },
  uiHints: {
    provider: {
      label: "Provider",
      help: "Use twilio, telnyx, or mock for dev/no-network.",
    },
    fromNumber: { label: "From Number", placeholder: "+15550001234" },
    toNumber: { label: "Default To Number", placeholder: "+15550001234" },
    inboundPolicy: { label: "Inbound Policy" },
    allowFrom: { label: "Inbound Allowlist" },
    inboundGreeting: { label: "Inbound Greeting", advanced: true },
    "telnyx.apiKey": { label: "Telnyx API Key", sensitive: true },
    "telnyx.connectionId": { label: "Telnyx Connection ID" },
    "telnyx.publicKey": { label: "Telnyx Public Key", sensitive: true },
    "twilio.accountSid": { label: "Twilio Account SID" },
    "twilio.authToken": { label: "Twilio Auth Token", sensitive: true },
    "outbound.defaultMode": { label: "Default Call Mode" },
    "outbound.notifyHangupDelaySec": {
      label: "Notify Hangup Delay (sec)",
      advanced: true,
    },
    "serve.port": { label: "Webhook Port" },
    "serve.bind": { label: "Webhook Bind" },
    "serve.path": { label: "Webhook Path" },
    "tailscale.mode": { label: "Tailscale Mode", advanced: true },
    "tailscale.path": { label: "Tailscale Path", advanced: true },
    "tunnel.provider": { label: "Tunnel Provider", advanced: true },
    "tunnel.ngrokAuthToken": {
      label: "ngrok Auth Token",
      sensitive: true,
      advanced: true,
    },
    "tunnel.ngrokDomain": { label: "ngrok Domain", advanced: true },
    "tunnel.allowNgrokFreeTierLoopbackBypass": {
      label: "Allow ngrok Free Tier (Loopback Bypass)",
      advanced: true,
    },
    "streaming.enabled": { label: "Enable Streaming", advanced: true },
    "streaming.openaiApiKey": {
      label: "OpenAI Realtime API Key",
      sensitive: true,
      advanced: true,
    },
    "streaming.sttModel": { label: "Realtime STT Model", advanced: true },
    "streaming.streamPath": { label: "Media Stream Path", advanced: true },
    "tts.provider": {
      label: "TTS Provider Override",
      help: "Deep-merges with messages.tts (Edge is ignored for calls).",
      advanced: true,
    },
    "tts.openai.model": { label: "OpenAI TTS Model", advanced: true },
    "tts.openai.voice": { label: "OpenAI TTS Voice", advanced: true },
    "tts.openai.apiKey": {
      label: "OpenAI API Key",
      sensitive: true,
      advanced: true,
    },
    "tts.elevenlabs.modelId": { label: "ElevenLabs Model ID", advanced: true },
    "tts.elevenlabs.voiceId": { label: "ElevenLabs Voice ID", advanced: true },
    "tts.elevenlabs.apiKey": {
      label: "ElevenLabs API Key",
      sensitive: true,
      advanced: true,
    },
    "tts.elevenlabs.baseUrl": { label: "ElevenLabs Base URL", advanced: true },
    publicUrl: { label: "Public Webhook URL", advanced: true },
    skipSignatureVerification: {
      label: "Skip Signature Verification",
      advanced: true,
    },
    store: { label: "Call Log Store Path", advanced: true },
    responseModel: { label: "Response Model", advanced: true },
    responseSystemPrompt: { label: "Response System Prompt", advanced: true },
    responseTimeoutMs: { label: "Response Timeout (ms)", advanced: true },
    // SMS Configuration
    "sms.enabled": { label: "Enable SMS" },
    "sms.inboundPolicy": { label: "SMS Inbound Policy" },
    "sms.allowFrom": { label: "SMS Inbound Allowlist" },
    "sms.ownerNumber": {
      label: "Owner Phone Number",
      help: "Your phone number for admin-level access (E.164)",
      placeholder: "+15550001234",
    },
    "sms.inboundGreeting": { label: "SMS Inbound Greeting", advanced: true },
    "sms.webhookPath": { label: "SMS Webhook Path", advanced: true },
    "sms.responseModel": { label: "SMS Response Model", advanced: true },
    "sms.responseSystemPrompt": { label: "SMS Response Prompt", advanced: true },
    "sms.responseTimeoutMs": { label: "SMS Response Timeout (ms)", advanced: true },
  },
};

const VoiceCallToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("initiate_call"),
    to: Type.Optional(Type.String({ description: "Call target" })),
    message: Type.String({ description: "Intro message" }),
    mode: Type.Optional(Type.Union([Type.Literal("notify"), Type.Literal("conversation")])),
  }),
  Type.Object({
    action: Type.Literal("continue_call"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Follow-up message" }),
  }),
  Type.Object({
    action: Type.Literal("speak_to_user"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Message to speak" }),
  }),
  Type.Object({
    action: Type.Literal("end_call"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    action: Type.Literal("get_status"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    mode: Type.Optional(Type.Union([Type.Literal("call"), Type.Literal("status")])),
    to: Type.Optional(Type.String({ description: "Call target" })),
    sid: Type.Optional(Type.String({ description: "Call SID" })),
    message: Type.Optional(Type.String({ description: "Optional intro message" })),
  }),
]);

const voiceCallPlugin = {
  id: "voice-call",
  name: "Voice Call & SMS",
  description: "Voice call and SMS messaging plugin with Telnyx/Twilio/Plivo providers and cross-channel contact profiles",
  configSchema: voiceCallConfigSchema,
  register(api) {
    const config = resolveVoiceCallConfig(voiceCallConfigSchema.parse(api.pluginConfig));
    const validation = validateProviderConfig(config);

    if (api.pluginConfig && typeof api.pluginConfig === "object") {
      const raw = api.pluginConfig as Record<string, unknown>;
      const twilio = raw.twilio as Record<string, unknown> | undefined;
      if (raw.provider === "log") {
        api.logger.warn('[voice-call] provider "log" is deprecated; use "mock" instead');
      }
      if (typeof twilio?.from === "string") {
        api.logger.warn("[voice-call] twilio.from is deprecated; use fromNumber instead");
      }
    }

    let runtimePromise: Promise<VoiceCallRuntime> | null = null;
    let runtime: VoiceCallRuntime | null = null;

    const ensureRuntime = async () => {
      if (!config.enabled) {
        throw new Error("Voice call disabled in plugin config");
      }
      if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
      }
      if (runtime) {
        return runtime;
      }
      if (!runtimePromise) {
        runtimePromise = createVoiceCallRuntime({
          config,
          coreConfig: api.config as CoreConfig,
          ttsRuntime: api.runtime.tts,
          logger: api.logger,
        });
      }
      runtime = await runtimePromise;
      return runtime;
    };

    const sendError = (respond: (ok: boolean, payload?: unknown) => void, err: unknown) => {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    };

    api.registerGatewayMethod("voicecall.initiate", async ({ params, respond }) => {
      try {
        const message = typeof params?.message === "string" ? params.message.trim() : "";
        if (!message) {
          respond(false, { error: "message required" });
          return;
        }
        const rt = await ensureRuntime();
        const to =
          typeof params?.to === "string" && params.to.trim()
            ? params.to.trim()
            : rt.config.toNumber;
        if (!to) {
          respond(false, { error: "to required" });
          return;
        }
        const mode =
          params?.mode === "notify" || params?.mode === "conversation" ? params.mode : undefined;
        const result = await rt.manager.initiateCall(to, undefined, {
          message,
          mode,
        });
        if (!result.success) {
          respond(false, { error: result.error || "initiate failed" });
          return;
        }
        respond(true, { callId: result.callId, initiated: true });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("voicecall.continue", async ({ params, respond }) => {
      try {
        const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
        const message = typeof params?.message === "string" ? params.message.trim() : "";
        if (!callId || !message) {
          respond(false, { error: "callId and message required" });
          return;
        }
        const rt = await ensureRuntime();
        const result = await rt.manager.continueCall(callId, message);
        if (!result.success) {
          respond(false, { error: result.error || "continue failed" });
          return;
        }
        respond(true, { success: true, transcript: result.transcript });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("voicecall.speak", async ({ params, respond }) => {
      try {
        const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
        const message = typeof params?.message === "string" ? params.message.trim() : "";
        if (!callId || !message) {
          respond(false, { error: "callId and message required" });
          return;
        }
        const rt = await ensureRuntime();
        const result = await rt.manager.speak(callId, message);
        if (!result.success) {
          respond(false, { error: result.error || "speak failed" });
          return;
        }
        respond(true, { success: true });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("voicecall.end", async ({ params, respond }) => {
      try {
        const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
        if (!callId) {
          respond(false, { error: "callId required" });
          return;
        }
        const rt = await ensureRuntime();
        const result = await rt.manager.endCall(callId);
        if (!result.success) {
          respond(false, { error: result.error || "end failed" });
          return;
        }
        respond(true, { success: true });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("voicecall.status", async ({ params, respond }) => {
      try {
        const raw =
          typeof params?.callId === "string"
            ? params.callId.trim()
            : typeof params?.sid === "string"
              ? params.sid.trim()
              : "";
        if (!raw) {
          respond(false, { error: "callId required" });
          return;
        }
        const rt = await ensureRuntime();
        const call = rt.manager.getCall(raw) || rt.manager.getCallByProviderCallId(raw);
        if (!call) {
          respond(true, { found: false });
          return;
        }
        respond(true, { found: true, call });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("voicecall.start", async ({ params, respond }) => {
      try {
        const to = typeof params?.to === "string" ? params.to.trim() : "";
        const message = typeof params?.message === "string" ? params.message.trim() : "";
        if (!to) {
          respond(false, { error: "to required" });
          return;
        }
        const rt = await ensureRuntime();
        const result = await rt.manager.initiateCall(to, undefined, {
          message: message || undefined,
        });
        if (!result.success) {
          respond(false, { error: result.error || "initiate failed" });
          return;
        }
        respond(true, { callId: result.callId, initiated: true });
      } catch (err) {
        sendError(respond, err);
      }
    });

    // -------------------------------------------------------------------------
    // SMS Gateway Methods
    // -------------------------------------------------------------------------

    api.registerGatewayMethod("sms.send", async ({ params, respond }) => {
      try {
        const to = typeof params?.to === "string" ? params.to.trim() : "";
        const body = typeof params?.body === "string" ? params.body.trim() : "";
        if (!to || !body) {
          respond(false, { error: "to and body required" });
          return;
        }
        const rt = await ensureRuntime();
        if (!rt.provider.supportsSms?.() || !rt.provider.sendSms) {
          respond(false, { error: "SMS not supported by provider" });
          return;
        }
        const fromNumber = rt.config.fromNumber;
        if (!fromNumber) {
          respond(false, { error: "fromNumber not configured" });
          return;
        }
        const result = await rt.provider.sendSms({ from: fromNumber, to, body });
        respond(true, { messageId: result.messageId, status: result.status });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("contact.get", async ({ params, respond }) => {
      try {
        const rt = await ensureRuntime();
        const phone = typeof params?.phone === "string" ? params.phone.trim() : "";
        const id = typeof params?.id === "string" ? params.id.trim() : "";
        if (phone) {
          const profile = rt.contactStore.findByPhone(phone);
          respond(true, profile ? { found: true, profile } : { found: false });
        } else if (id) {
          const profile = rt.contactStore.getById(id);
          respond(true, profile ? { found: true, profile } : { found: false });
        } else {
          respond(false, { error: "phone or id required" });
        }
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("contact.list", async ({ params, respond }) => {
      try {
        const rt = await ensureRuntime();
        const query = typeof params?.query === "string" ? params.query.trim() : "";
        const profiles = query
          ? rt.contactStore.search(query)
          : rt.contactStore.listAll();
        respond(true, { profiles, count: profiles.length });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("contact.update", async ({ params, respond }) => {
      try {
        const rt = await ensureRuntime();
        const phone = typeof params?.phone === "string" ? params.phone.trim() : "";
        const channel = typeof params?.channel === "string" ? params.channel.trim() : "sms";
        const name = typeof params?.name === "string" ? params.name.trim() : undefined;
        const role = typeof params?.role === "string" ? params.role.trim() : undefined;
        const tags =
          Array.isArray(params?.tags) ? params.tags.filter((t: unknown) => typeof t === "string") : undefined;

        if (!phone) {
          respond(false, { error: "phone required" });
          return;
        }
        const profile = rt.contactStore.upsertByIdentifier({
          channel,
          id: phone,
          name,
          role: role as any,
          tags,
        });
        respond(true, { profile });
      } catch (err) {
        sendError(respond, err);
      }
    });

    api.registerGatewayMethod("contact.addNote", async ({ params, respond }) => {
      try {
        const rt = await ensureRuntime();
        const phone = typeof params?.phone === "string" ? params.phone.trim() : "";
        const note = typeof params?.note === "string" ? params.note.trim() : "";
        const source = typeof params?.source === "string" ? params.source.trim() : "manual";
        if (!phone || !note) {
          respond(false, { error: "phone and note required" });
          return;
        }
        const existing = rt.contactStore.findByPhone(phone);
        if (!existing) {
          respond(false, { error: "Contact not found" });
          return;
        }
        const profile = rt.contactStore.addNote(existing.id, source, note);
        respond(true, { profile });
      } catch (err) {
        sendError(respond, err);
      }
    });

    // -------------------------------------------------------------------------
    // SMS Tool (agent-accessible)
    // -------------------------------------------------------------------------

    api.registerTool({
      name: "sms",
      label: "SMS",
      description:
        "Send SMS text messages to phone numbers. Use this to communicate with people via text message.",
      parameters: Type.Object({
        action: Type.String({ description: "Action: send" }),
        to: Type.String({ description: "Recipient phone number (E.164, e.g. +15550001234)" }),
        body: Type.String({ description: "Message text" }),
      }),
      async execute(_toolCallId, params) {
        const json = (payload: unknown) => ({
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });
        try {
          const rt = await ensureRuntime();
          if (!rt.provider.supportsSms?.() || !rt.provider.sendSms) {
            throw new Error("SMS not supported by provider");
          }
          const fromNumber = rt.config.fromNumber;
          if (!fromNumber) {
            throw new Error("fromNumber not configured");
          }
          const to = String(params.to || "").trim();
          const body = String(params.body || "").trim();
          if (!to || !body) {
            throw new Error("to and body required");
          }
          const result = await rt.provider.sendSms({ from: fromNumber, to, body });

          // Log interaction in contact profile
          const profile = rt.contactStore.ensureContactForPhone(to, "sms");
          rt.contactStore.addNote(profile.id, "sms-outbound", `Sent: "${body.slice(0, 100)}${body.length > 100 ? "…" : ""}"`);

          return json({ messageId: result.messageId, status: result.status, contact: profile.name });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // -------------------------------------------------------------------------
    // Contact Profile Tool (agent-accessible)
    // -------------------------------------------------------------------------

    api.registerTool({
      name: "contact_profile",
      label: "Contact Profile",
      description:
        "Manage contact profiles/dossiers. Look up, create, update, and add notes to contact profiles. " +
        "Contacts persist across channels (SMS, voice, Telegram, etc.) and track interaction history.",
      parameters: Type.Object({
        action: Type.String({
          description:
            "Action: lookup, update, add_note, list, link_channel",
        }),
        phone: Type.Optional(Type.String({ description: "Phone number to look up or create" })),
        name: Type.Optional(Type.String({ description: "Display name" })),
        role: Type.Optional(
          Type.String({ description: "Role: admin, customer, friend, family, unknown" }),
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to add" })),
        note: Type.Optional(Type.String({ description: "Note text to add to dossier" })),
        source: Type.Optional(Type.String({ description: "Source of the note" })),
        channel: Type.Optional(Type.String({ description: "Channel name for link_channel" })),
        channelId: Type.Optional(Type.String({ description: "Channel-specific ID for link_channel" })),
        query: Type.Optional(Type.String({ description: "Search query for list action" })),
      }),
      async execute(_toolCallId, params) {
        const json = (payload: unknown) => ({
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });
        try {
          const rt = await ensureRuntime();
          const action = String(params.action || "").trim();

          switch (action) {
            case "lookup": {
              const phone = String(params.phone || "").trim();
              if (!phone) throw new Error("phone required for lookup");
              const profile = rt.contactStore.findByPhone(phone);
              if (!profile) return json({ found: false, phone });
              return json({
                found: true,
                profile,
                summary: rt.contactStore.buildProfileSummary(profile),
              });
            }
            case "update": {
              const phone = String(params.phone || "").trim();
              if (!phone) throw new Error("phone required for update");
              const profile = rt.contactStore.upsertByIdentifier({
                channel: "sms",
                id: phone,
                name: typeof params.name === "string" ? params.name : undefined,
                role: typeof params.role === "string" ? (params.role as any) : undefined,
                tags: Array.isArray(params.tags) ? params.tags : undefined,
              });
              return json({ updated: true, profile });
            }
            case "add_note": {
              const phone = String(params.phone || "").trim();
              const note = String(params.note || "").trim();
              if (!phone || !note) throw new Error("phone and note required");
              const existing = rt.contactStore.findByPhone(phone);
              if (!existing) throw new Error("Contact not found — create it first with update");
              const source = typeof params.source === "string" ? params.source : "agent";
              const profile = rt.contactStore.addNote(existing.id, source, note);
              return json({ noted: true, profile });
            }
            case "list": {
              const query = typeof params.query === "string" ? params.query.trim() : "";
              const profiles = query
                ? rt.contactStore.search(query)
                : rt.contactStore.listAll();
              return json({
                count: profiles.length,
                profiles: profiles.map((p) => ({
                  id: p.id,
                  name: p.name,
                  role: p.role,
                  identifiers: p.identifiers,
                  tags: p.tags,
                  noteCount: p.notes.length,
                })),
              });
            }
            case "link_channel": {
              const phone = String(params.phone || "").trim();
              const channel = String(params.channel || "").trim();
              const channelId = String(params.channelId || "").trim();
              if (!phone || !channel || !channelId) {
                throw new Error("phone, channel, and channelId required");
              }
              const existing = rt.contactStore.findByPhone(phone);
              if (!existing) throw new Error("Contact not found");
              const profile = rt.contactStore.addIdentifier(existing.id, {
                channel,
                id: channelId,
              });
              return json({ linked: true, profile });
            }
            default:
              throw new Error(`Unknown action: ${action}. Use: lookup, update, add_note, list, link_channel`);
          }
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    // -------------------------------------------------------------------------
    // Voice Call Tool
    // -------------------------------------------------------------------------

    api.registerTool({
      name: "voice_call",
      label: "Voice Call",
      description: "Make phone calls and have voice conversations via the voice-call plugin.",
      parameters: VoiceCallToolSchema,
      async execute(_toolCallId, params) {
        const json = (payload: unknown) => ({
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });

        try {
          const rt = await ensureRuntime();

          if (typeof params?.action === "string") {
            switch (params.action) {
              case "initiate_call": {
                const message = String(params.message || "").trim();
                if (!message) {
                  throw new Error("message required");
                }
                const to =
                  typeof params.to === "string" && params.to.trim()
                    ? params.to.trim()
                    : rt.config.toNumber;
                if (!to) {
                  throw new Error("to required");
                }
                const result = await rt.manager.initiateCall(to, undefined, {
                  message,
                  mode:
                    params.mode === "notify" || params.mode === "conversation"
                      ? params.mode
                      : undefined,
                });
                if (!result.success) {
                  throw new Error(result.error || "initiate failed");
                }
                return json({ callId: result.callId, initiated: true });
              }
              case "continue_call": {
                const callId = String(params.callId || "").trim();
                const message = String(params.message || "").trim();
                if (!callId || !message) {
                  throw new Error("callId and message required");
                }
                const result = await rt.manager.continueCall(callId, message);
                if (!result.success) {
                  throw new Error(result.error || "continue failed");
                }
                return json({ success: true, transcript: result.transcript });
              }
              case "speak_to_user": {
                const callId = String(params.callId || "").trim();
                const message = String(params.message || "").trim();
                if (!callId || !message) {
                  throw new Error("callId and message required");
                }
                const result = await rt.manager.speak(callId, message);
                if (!result.success) {
                  throw new Error(result.error || "speak failed");
                }
                return json({ success: true });
              }
              case "end_call": {
                const callId = String(params.callId || "").trim();
                if (!callId) {
                  throw new Error("callId required");
                }
                const result = await rt.manager.endCall(callId);
                if (!result.success) {
                  throw new Error(result.error || "end failed");
                }
                return json({ success: true });
              }
              case "get_status": {
                const callId = String(params.callId || "").trim();
                if (!callId) {
                  throw new Error("callId required");
                }
                const call =
                  rt.manager.getCall(callId) || rt.manager.getCallByProviderCallId(callId);
                return json(call ? { found: true, call } : { found: false });
              }
            }
          }

          const mode = params?.mode ?? "call";
          if (mode === "status") {
            const sid = typeof params.sid === "string" ? params.sid.trim() : "";
            if (!sid) {
              throw new Error("sid required for status");
            }
            const call = rt.manager.getCall(sid) || rt.manager.getCallByProviderCallId(sid);
            return json(call ? { found: true, call } : { found: false });
          }

          const to =
            typeof params.to === "string" && params.to.trim()
              ? params.to.trim()
              : rt.config.toNumber;
          if (!to) {
            throw new Error("to required for call");
          }
          const result = await rt.manager.initiateCall(to, undefined, {
            message:
              typeof params.message === "string" && params.message.trim()
                ? params.message.trim()
                : undefined,
          });
          if (!result.success) {
            throw new Error(result.error || "initiate failed");
          }
          return json({ callId: result.callId, initiated: true });
        } catch (err) {
          return json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });

    api.registerCli(
      ({ program }) =>
        registerVoiceCallCli({
          program,
          config,
          ensureRuntime,
          logger: api.logger,
        }),
      { commands: ["voicecall"] },
    );

    api.registerService({
      id: "voicecall",
      start: async () => {
        if (!config.enabled) {
          return;
        }
        try {
          await ensureRuntime();
        } catch (err) {
          api.logger.error(
            `[voice-call] Failed to start runtime: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
      stop: async () => {
        if (!runtimePromise) {
          return;
        }
        try {
          const rt = await runtimePromise;
          await rt.stop();
        } finally {
          runtimePromise = null;
          runtime = null;
        }
      },
    });
  },
};

export default voiceCallPlugin;
