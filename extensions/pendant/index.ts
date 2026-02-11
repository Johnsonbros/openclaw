import type { OpenClawPluginApi, PluginConfigContext } from "openclaw/plugin-sdk";

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
 * Pendant plugin configuration.
 */
interface PendantConfig {
  sttProvider: "deepgram" | "whisper" | "gateway";
  deepgramApiKey?: string;
  whisperEndpoint?: string;
  autoTranscribe: boolean;
  bufferDurationMs: number;
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
    },
  },

  register(api: OpenClawPluginApi) {
    // Store audio buffers per session
    const audioBuffers = new Map<string, AudioBuffer>();

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
              // Send transcript as a message event
              api.runtime.events.emit("pendant.transcript", {
                sessionKey: ctx.sessionKey,
                transcript: transcript.trim(),
                durationMs: bufferDurationMs,
                timestamp: new Date().toISOString(),
              });

              // Optionally inject as user message
              // This would trigger the AI to respond
              // api.runtime.session.injectUserMessage(ctx.sessionKey, transcript);
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
