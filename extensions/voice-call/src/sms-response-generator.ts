/**
 * SMS response generator — routes inbound SMS through the embedded Pi agent,
 * using the same agent infrastructure as voice and messaging channels.
 *
 * Injects the caller's contact profile into the system prompt so the agent
 * recognises returning contacts across channels.
 */

import crypto from "node:crypto";
import type { SmsConfig, VoiceCallConfig } from "./config.js";
import type { ContactProfile, ContactProfileStore } from "./contact-profile.js";
import { loadCoreAgentDeps, type CoreConfig } from "./core-bridge.js";

export type SmsResponseParams = {
  /** Full voice-call config (for fallback model/prompt) */
  voiceConfig: VoiceCallConfig;
  /** SMS-specific config override */
  smsConfig: SmsConfig;
  /** Core OpenClaw config */
  coreConfig: CoreConfig;
  /** Sender phone number (E.164) */
  from: string;
  /** Inbound message text */
  message: string;
  /** Contact profile (if known) */
  profile?: ContactProfile | null;
  /** Profile store — for the agent tool to update dossier */
  profileStore?: ContactProfileStore;
  /** Conversation history (last N messages for context) */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
};

export type SmsResponseResult = {
  text: string | null;
  error?: string;
};

type SessionEntry = {
  sessionId: string;
  updatedAt: number;
};

/**
 * Generate an SMS reply using the embedded Pi agent with full tool support.
 */
export async function generateSmsResponse(
  params: SmsResponseParams,
): Promise<SmsResponseResult> {
  const { voiceConfig, smsConfig, coreConfig, from, message, profile, history } = params;

  if (!coreConfig) {
    return { text: null, error: "Core config unavailable for SMS response" };
  }

  let deps: Awaited<ReturnType<typeof loadCoreAgentDeps>>;
  try {
    deps = await loadCoreAgentDeps();
  } catch (err) {
    return {
      text: null,
      error: err instanceof Error ? err.message : "Unable to load core agent dependencies",
    };
  }

  const cfg = coreConfig;

  // Session key based on phone number — collapses SMS from same person
  const normalizedPhone = from.replace(/\D/g, "");
  const sessionKey = `sms:${normalizedPhone}`;
  const agentId = "main";

  // Resolve paths
  const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
  const agentDir = deps.resolveAgentDir(cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);

  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  // Load or create session
  const sessionStore = deps.loadSessionStore(storePath);
  const now = Date.now();
  let sessionEntry = sessionStore[sessionKey] as SessionEntry | undefined;

  if (!sessionEntry) {
    sessionEntry = {
      sessionId: crypto.randomUUID(),
      updatedAt: now,
    };
    sessionStore[sessionKey] = sessionEntry;
    await deps.saveSessionStore(storePath, sessionStore);
  }

  const sessionId = sessionEntry.sessionId;
  const sessionFile = deps.resolveSessionFilePath(sessionId, sessionEntry, {
    agentId,
  });

  // Resolve model — SMS config overrides voice config
  const modelRef =
    smsConfig.responseModel ||
    voiceConfig.responseModel ||
    `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
  const slashIndex = modelRef.indexOf("/");
  const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
  const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

  const thinkLevel = deps.resolveThinkingDefault({ cfg, provider, model });

  // Resolve agent identity
  const identity = deps.resolveAgentIdentity(cfg, agentId);
  const agentName = identity?.name?.trim() || "assistant";

  // Build system prompt with contact profile context
  const basePrompt =
    smsConfig.responseSystemPrompt ??
    voiceConfig.responseSystemPrompt ??
    `You are ${agentName}, a helpful SMS assistant. Keep responses concise and clear — SMS messages should be brief (under 320 characters when possible). Be direct and professional.`;

  let extraSystemPrompt = basePrompt;

  // Inject contact profile if available
  if (profile) {
    const isAdmin = profile.role === "admin";
    const profileBlock = [
      "",
      "## Caller Profile",
      `Name: ${profile.name}`,
      `Role: ${profile.role}${isAdmin ? " (ELEVATED — full admin access)" : ""}`,
      profile.tags.length > 0 ? `Tags: ${profile.tags.join(", ")}` : null,
      profile.identifiers.length > 1
        ? `Also known on: ${profile.identifiers.map((i) => `${i.channel}:${i.label || i.id}`).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Include recent notes for persistent memory
    const recentNotes = profile.notes.slice(-3);
    const notesBlock =
      recentNotes.length > 0
        ? "\n\nRecent observations about this contact:\n" +
          recentNotes.map((n) => `- [${n.source}] ${n.text}`).join("\n")
        : "";

    extraSystemPrompt = `${basePrompt}${profileBlock}${notesBlock}`;
  } else {
    extraSystemPrompt = `${basePrompt}\n\nThis is an SMS from ${from}. No prior profile on record.`;
  }

  // Include recent conversation history
  if (history && history.length > 0) {
    const historyBlock = history
      .map((h) => `${h.role === "user" ? "Them" : "You"}: ${h.text}`)
      .join("\n");
    extraSystemPrompt += `\n\nRecent messages:\n${historyBlock}`;
  }

  const timeoutMs =
    smsConfig.responseTimeoutMs ?? voiceConfig.responseTimeoutMs ?? deps.resolveAgentTimeoutMs({ cfg });
  const runId = `sms:${normalizedPhone}:${Date.now()}`;

  try {
    const result = await deps.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      messageProvider: "sms",
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: message,
      provider,
      model,
      thinkLevel,
      verboseLevel: "off",
      timeoutMs,
      runId,
      lane: "sms",
      extraSystemPrompt,
      agentDir,
    });

    const texts = (result.payloads ?? [])
      .filter((p) => p.text && !p.isError)
      .map((p) => p.text?.trim())
      .filter(Boolean);

    const text = texts.join(" ") || null;

    if (!text && result.meta?.aborted) {
      return { text: null, error: "SMS response generation was aborted" };
    }

    return { text };
  } catch (err) {
    console.error("[voice-call/sms] Response generation failed:", err);
    return { text: null, error: String(err) };
  }
}
