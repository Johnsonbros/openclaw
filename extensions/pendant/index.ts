import type { OpenClawPluginApi, PluginConfigContext } from "openclaw/plugin-sdk";
import { SpeakerDiarizer, type VoiceProfile, type SpeakerSegment } from "./speaker-diarization.js";

/**
 * Pendant audio buffer for accumulating PCM data before transcription.
 */
interface AudioBuffer {
  samples: Buffer[];
  sampleRate: number;
  startTime: number;
  totalBytes: number;
}

/**
 * Pendant channel state per session.
 */
interface PendantChannelState {
  isActive: boolean;
  currentSpeaker: string | null;
  speakerHistory: Array<{
    speakerId: string;
    personName?: string;
    timestamp: string;
    durationMs: number;
  }>;
  totalAudioMs: number;
  sessionStartTime: string;
}

/**
 * Pendant plugin configuration.
 */
interface PendantConfig {
  sttProvider: "deepgram" | "whisper" | "gateway";
  deepgramApiKey?: string;
  whisperEndpoint?: string;
  autoTranscribe: boolean;
  bufferDurationMs: number;
  enableSpeakerDiarization: boolean;
  speakerMatchThreshold: number;
  autoCreateVoiceProfiles: boolean;
}

/**
 * Pendant audio event payload from Android node.
 */
interface PendantAudioEvent {
  audio: string; // Base64-encoded PCM audio
  sampleRate: number;
  encoding: string; // "pcm16"
  channels: number;
}

const pendantPlugin = {
  id: "pendant",
  name: "BLE Pendant",
  description: "Audio streaming and transcription from BLE pendant devices",
  kind: "integration",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      sttProvider: {
        type: "string" as const,
        description: "Speech-to-text provider for pendant audio",
        enum: ["deepgram", "whisper", "gateway"],
        default: "gateway",
      },
      deepgramApiKey: {
        type: "string" as const,
        description: "Deepgram API key (if using Deepgram STT)",
      },
      whisperEndpoint: {
        type: "string" as const,
        description: "Whisper API endpoint (if using Whisper STT)",
      },
      autoTranscribe: {
        type: "boolean" as const,
        description: "Automatically transcribe incoming pendant audio",
        default: true,
      },
      bufferDurationMs: {
        type: "number" as const,
        description: "Audio buffer duration before sending for transcription",
        default: 1000,
      },
      enableSpeakerDiarization: {
        type: "boolean" as const,
        description: "Enable speaker diarization and voice fingerprinting",
        default: true,
      },
      speakerMatchThreshold: {
        type: "number" as const,
        description: "Confidence threshold for matching voices to known profiles (0-1)",
        default: 0.75,
      },
      autoCreateVoiceProfiles: {
        type: "boolean" as const,
        description: "Automatically create voice profiles for unrecognized speakers",
        default: true,
      },
    },
  },

  register(api: OpenClawPluginApi) {
    // Store audio buffers per session
    const audioBuffers = new Map<string, AudioBuffer>();

    // Speaker diarization engine
    const diarizer = new SpeakerDiarizer({
      matchThreshold: 0.75,
      autoCreateProfiles: true,
    });

    // Pendant channel state per session
    const channelStates = new Map<string, PendantChannelState>();

    // Voice profiles storage key
    const VOICE_PROFILES_KEY = "pendant:voice_profiles";

    // Load voice profiles on startup
    (async () => {
      try {
        const stored = await api.runtime.storage?.get(VOICE_PROFILES_KEY);
        if (stored) {
          const profiles = JSON.parse(stored) as VoiceProfile[];
          await diarizer.loadProfiles(profiles);
          console.log(`[Pendant] Loaded ${profiles.length} voice profiles`);
        }
      } catch (e) {
        console.error("[Pendant] Failed to load voice profiles:", e);
      }
    })();

    // Save voice profiles periodically
    const saveProfiles = async () => {
      try {
        const profiles = diarizer.exportProfiles();
        await api.runtime.storage?.set(VOICE_PROFILES_KEY, JSON.stringify(profiles));
      } catch (e) {
        console.error("[Pendant] Failed to save voice profiles:", e);
      }
    };

    // Register pendant as a dedicated channel
    api.registerChannel?.({
      id: "pendant",
      name: "BLE Pendant",
      description: "Audio input from connected BLE pendant device",
      icon: "microphone",
      capabilities: ["audio-input", "speaker-diarization", "voice-fingerprint"],
    });

    // Register event handler for pendant audio
    api.registerEvent(
      "pendant.audio",
      async (event, ctx: PluginConfigContext) => {
        const config = ctx.config as PendantConfig;

        if (!config.autoTranscribe) {
          return;
        }

        try {
          const payload = event.payload as PendantAudioEvent;

          if (!payload.audio || !payload.sampleRate) {
            return;
          }

          // Decode base64 audio
          const pcmData = Buffer.from(payload.audio, "base64");

          // Get or create buffer for this session
          let buffer = audioBuffers.get(ctx.sessionKey);
          if (!buffer) {
            buffer = {
              samples: [],
              sampleRate: payload.sampleRate,
              startTime: Date.now(),
              totalBytes: 0,
            };
            audioBuffers.set(ctx.sessionKey, buffer);
          }

          // Add to buffer
          buffer.samples.push(pcmData);
          buffer.totalBytes += pcmData.length;

          // Calculate buffer duration
          // PCM16 = 2 bytes per sample, mono = 1 channel
          const bytesPerSecond = buffer.sampleRate * 2;
          const bufferDurationMs = (buffer.totalBytes / bytesPerSecond) * 1000;

          // Check if buffer is ready for transcription
          if (bufferDurationMs >= config.bufferDurationMs) {
            // Combine all samples
            const combinedPcm = Buffer.concat(buffer.samples);

            // Clear buffer
            audioBuffers.delete(ctx.sessionKey);

            // Transcribe
            const transcript = await transcribeAudio(
              combinedPcm,
              buffer.sampleRate,
              config
            );

            if (transcript && transcript.trim()) {
              let speakerInfo: SpeakerSegment | null = null;
              let speakerName: string | null = null;

              // Run speaker diarization if enabled
              if (config.enableSpeakerDiarization) {
                const segments = await diarizer.processAudio(
                  combinedPcm,
                  buffer.sampleRate,
                  {
                    sessionKey: ctx.sessionKey,
                    conversationContext: transcript,
                  }
                );

                if (segments.length > 0) {
                  speakerInfo = segments[0];
                  const profiles = diarizer.getProfiles();
                  const matchedProfile = profiles.find(
                    (p) => p.id === speakerInfo?.speakerId
                  );
                  speakerName = matchedProfile?.personName || null;

                  // Update channel state
                  let state = channelStates.get(ctx.sessionKey);
                  if (!state) {
                    state = {
                      isActive: true,
                      currentSpeaker: null,
                      speakerHistory: [],
                      totalAudioMs: 0,
                      sessionStartTime: new Date().toISOString(),
                    };
                    channelStates.set(ctx.sessionKey, state);
                  }

                  state.currentSpeaker = speakerInfo.speakerId;
                  state.totalAudioMs += bufferDurationMs;
                  state.speakerHistory.push({
                    speakerId: speakerInfo.speakerId,
                    personName: speakerName || undefined,
                    timestamp: new Date().toISOString(),
                    durationMs: bufferDurationMs,
                  });

                  // Save profiles periodically
                  if (state.speakerHistory.length % 10 === 0) {
                    await saveProfiles();
                  }
                }
              }

              // Format transcript with speaker info
              const formattedTranscript = speakerName
                ? `[${speakerName}]: ${transcript.trim()}`
                : speakerInfo
                ? `[Speaker ${speakerInfo.speakerId.slice(-6)}]: ${transcript.trim()}`
                : transcript.trim();

              // Send transcript via pendant channel
              api.runtime.events.emit("pendant.transcript", {
                channel: "pendant",
                sessionKey: ctx.sessionKey,
                transcript: transcript.trim(),
                formattedTranscript,
                speaker: speakerInfo
                  ? {
                      id: speakerInfo.speakerId,
                      name: speakerName,
                      confidence: speakerInfo.confidence,
                      isNew: speakerInfo.speakerId.startsWith("voice_"),
                    }
                  : null,
                durationMs: bufferDurationMs,
                timestamp: new Date().toISOString(),
              });

              // Emit event for AI to process
              // This creates a distinct input channel separate from direct messages
              api.runtime.events.emit("channel.message", {
                channel: "pendant",
                type: "audio_transcript",
                sessionKey: ctx.sessionKey,
                content: formattedTranscript,
                metadata: {
                  source: "pendant",
                  speakerId: speakerInfo?.speakerId,
                  speakerName,
                  audioMs: bufferDurationMs,
                },
              });
            }
          }
        } catch (error) {
          console.error("[Pendant] Audio processing error:", error);
        }
      }
    );

    // Register CLI commands for pendant management
    api.registerCli(
      ({ program }) => {
        const pendantCmd = program
          .command("pendant")
          .description("Manage BLE pendant devices");

        pendantCmd
          .command("status")
          .description("Show pendant connection status")
          .action(async () => {
            // This would query the connected Android node for pendant status
            console.log("Pendant status: (query node for status)");
          });

        pendantCmd
          .command("transcribe <file>")
          .description("Transcribe an audio file")
          .option("-p, --provider <provider>", "STT provider", "gateway")
          .action(async (file: string, options: { provider: string }) => {
            console.log(`Would transcribe ${file} using ${options.provider}`);
          });
      },
      { commands: ["pendant"] }
    );

    // Register tool for voice profile management
    api.registerTool(
      () => ({
        name: "voice_profile_list",
        description: "List all known voice profiles (people whose voices have been fingerprinted)",
        parameters: {
          type: "object" as const,
          properties: {},
          required: [],
        },
        async execute() {
          const profiles = diarizer.getProfiles();
          return {
            count: profiles.length,
            profiles: profiles.map((p) => ({
              id: p.id,
              personId: p.personId,
              personName: p.personName,
              autoCreated: p.metadata.autoCreated,
              sampleCount: p.metadata.sampleCount,
              lastSeenAt: p.metadata.lastSeenAt,
              createdAt: p.createdAt,
            })),
          };
        },
      }),
      { names: ["voice_profile_list"] }
    );

    api.registerTool(
      () => ({
        name: "voice_profile_identify",
        description: "Assign a name/identity to a voice profile (link a voice to a person)",
        parameters: {
          type: "object" as const,
          properties: {
            voiceProfileId: {
              type: "string" as const,
              description: "The voice profile ID to update",
            },
            personName: {
              type: "string" as const,
              description: "The person's name",
            },
            personId: {
              type: "string" as const,
              description: "Optional ID to link to a contacts/people profile",
            },
          },
          required: ["voiceProfileId", "personName"],
        },
        async execute(params: {
          voiceProfileId: string;
          personName: string;
          personId?: string;
        }) {
          await diarizer.linkToPerson(
            params.voiceProfileId,
            params.personId || params.voiceProfileId,
            params.personName
          );
          await saveProfiles();

          return {
            success: true,
            message: `Voice profile ${params.voiceProfileId} linked to "${params.personName}"`,
          };
        },
      }),
      { names: ["voice_profile_identify"] }
    );

    api.registerTool(
      () => ({
        name: "pendant_channel_status",
        description: "Get status of the pendant audio channel including speaker history",
        parameters: {
          type: "object" as const,
          properties: {
            sessionKey: {
              type: "string" as const,
              description: "Session key to get status for (optional, uses current session)",
            },
          },
          required: [],
        },
        async execute(params: { sessionKey?: string }, ctx) {
          const key = params.sessionKey || ctx.sessionKey;
          const state = channelStates.get(key);

          if (!state) {
            return {
              active: false,
              message: "No pendant channel active for this session",
            };
          }

          // Get unique speakers from history
          const uniqueSpeakers = new Map<
            string,
            { name?: string; totalMs: number; lastSeen: string }
          >();
          for (const entry of state.speakerHistory) {
            const existing = uniqueSpeakers.get(entry.speakerId);
            if (existing) {
              existing.totalMs += entry.durationMs;
              existing.lastSeen = entry.timestamp;
            } else {
              uniqueSpeakers.set(entry.speakerId, {
                name: entry.personName,
                totalMs: entry.durationMs,
                lastSeen: entry.timestamp,
              });
            }
          }

          return {
            active: state.isActive,
            currentSpeaker: state.currentSpeaker,
            sessionStartTime: state.sessionStartTime,
            totalAudioMs: state.totalAudioMs,
            uniqueSpeakers: Array.from(uniqueSpeakers.entries()).map(
              ([id, data]) => ({
                id,
                name: data.name,
                totalSpeakingMs: data.totalMs,
                lastSeen: data.lastSeen,
              })
            ),
          };
        },
      }),
      { names: ["pendant_channel_status"] }
    );

    // Register tool for AI to control pendant
    api.registerTool(
      () => ({
        name: "pendant_control",
        description: "Control BLE pendant device connected to Android node",
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string" as const,
              enum: ["scan", "connect", "disconnect", "status"],
              description: "Action to perform on pendant",
            },
            address: {
              type: "string" as const,
              description: "Pendant BLE address (for connect action)",
            },
          },
          required: ["action"],
        },
        async execute(params: { action: string; address?: string }, ctx) {
          // This would invoke the pendant command on the Android node
          const command = `pendant.${params.action}`;
          const paramsJson = params.address
            ? JSON.stringify({ address: params.address })
            : "{}";

          try {
            // Invoke on connected Android node
            const result = await api.runtime.nodes.invoke(
              ctx.sessionKey,
              command,
              paramsJson
            );
            return result;
          } catch (error) {
            return {
              error: `Failed to execute pendant.${params.action}: ${error}`,
            };
          }
        },
      }),
      { names: ["pendant_control"] }
    );
  },
};

/**
 * Transcribe PCM audio using configured STT provider.
 */
async function transcribeAudio(
  pcmData: Buffer,
  sampleRate: number,
  config: PendantConfig
): Promise<string | null> {
  switch (config.sttProvider) {
    case "deepgram":
      return transcribeWithDeepgram(pcmData, sampleRate, config.deepgramApiKey);

    case "whisper":
      return transcribeWithWhisper(
        pcmData,
        sampleRate,
        config.whisperEndpoint
      );

    case "gateway":
    default:
      // Use gateway's built-in STT (if available)
      // This would integrate with the gateway's existing voice infrastructure
      return transcribeWithGateway(pcmData, sampleRate);
  }
}

/**
 * Transcribe using Deepgram streaming API.
 */
async function transcribeWithDeepgram(
  pcmData: Buffer,
  sampleRate: number,
  apiKey?: string
): Promise<string | null> {
  if (!apiKey) {
    console.error("[Pendant] Deepgram API key not configured");
    return null;
  }

  try {
    // Convert PCM to WAV for Deepgram
    const wavData = pcmToWav(pcmData, sampleRate);

    const response = await fetch(
      `https://api.deepgram.com/v1/listen?model=nova-2&language=en`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/wav",
        },
        body: wavData,
      }
    );

    if (!response.ok) {
      console.error("[Pendant] Deepgram error:", response.status);
      return null;
    }

    const result = await response.json();
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript || null;
  } catch (error) {
    console.error("[Pendant] Deepgram transcription error:", error);
    return null;
  }
}

/**
 * Transcribe using Whisper API.
 */
async function transcribeWithWhisper(
  pcmData: Buffer,
  sampleRate: number,
  endpoint?: string
): Promise<string | null> {
  if (!endpoint) {
    console.error("[Pendant] Whisper endpoint not configured");
    return null;
  }

  try {
    const wavData = pcmToWav(pcmData, sampleRate);

    const formData = new FormData();
    formData.append("file", new Blob([wavData], { type: "audio/wav" }), "audio.wav");
    formData.append("model", "whisper-1");

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      console.error("[Pendant] Whisper error:", response.status);
      return null;
    }

    const result = await response.json();
    return result.text || null;
  } catch (error) {
    console.error("[Pendant] Whisper transcription error:", error);
    return null;
  }
}

/**
 * Transcribe using gateway's built-in STT.
 */
async function transcribeWithGateway(
  pcmData: Buffer,
  sampleRate: number
): Promise<string | null> {
  // Placeholder - would integrate with gateway's existing voice/STT infrastructure
  // This could use the same STT pipeline as voice calls
  console.log(
    `[Pendant] Gateway STT: would transcribe ${pcmData.length} bytes at ${sampleRate}Hz`
  );
  return null;
}

/**
 * Convert PCM data to WAV format.
 */
function pcmToWav(pcmData: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);

  // fmt subchunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1 size
  header.writeUInt16LE(1, 20); // Audio format (PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

export default pendantPlugin;
