/**
 * AudioInputProcessor — accumulates PCM audio chunks from pendant BLE,
 * sends to local Whisper server for transcription, and injects ambient
 * context into Zeke via agentCommand().
 */

import { randomUUID } from "node:crypto";
import { agentCommand } from "../commands/agent.js";
import { defaultRuntime } from "../runtime.js";
import type { NodeEventContext } from "./server-node-events-types.js";
import { formatForLog } from "./ws-log.js";

const FLUSH_INTERVAL_MS = 10_000;
const SILENCE_RMS_THRESHOLD = 200;
const MAX_TRANSCRIPT_FINGERPRINTS = 20;
const WHISPER_URL = process.env.WHISPER_URL ?? "http://localhost:8778";

type PcmAccumulator = {
  chunks: Buffer[];
  totalBytes: number;
  firstChunkAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
};

export class AudioInputProcessor {
  private accumulators = new Map<string, PcmAccumulator>();
  private recentFingerprints: string[] = [];
  private log: NodeEventContext["logGateway"] | null = null;

  ingestChunk(
    obj: Record<string, unknown>,
    ctx: NodeEventContext,
    nodeId: string,
  ): void {
    this.log = ctx.logGateway;

    const base64 = typeof obj.audio === "string" ? obj.audio : null;
    if (!base64) {
      return;
    }

    let pcm: Buffer;
    try {
      pcm = Buffer.from(base64, "base64");
    } catch {
      return;
    }
    if (pcm.length < 16) {
      return;
    }

    let acc = this.accumulators.get(nodeId);
    if (!acc) {
      acc = {
        chunks: [],
        totalBytes: 0,
        firstChunkAt: Date.now(),
        flushTimer: null,
      };
      this.accumulators.set(nodeId, acc);
    }

    acc.chunks.push(pcm);
    acc.totalBytes += pcm.length;

    // Start flush timer on first chunk
    if (!acc.flushTimer) {
      acc.flushTimer = setTimeout(() => {
        void this.flush(nodeId, ctx).catch((err) => {
          ctx.logGateway.warn(`audio flush failed node=${nodeId}: ${formatForLog(err)}`);
        });
      }, FLUSH_INTERVAL_MS);
    }
  }

  private async flush(nodeId: string, ctx: NodeEventContext): Promise<void> {
    const acc = this.accumulators.get(nodeId);
    if (!acc || acc.chunks.length === 0) {
      return;
    }

    const pcmBuffer = Buffer.concat(acc.chunks);
    // Reset accumulator
    acc.chunks = [];
    acc.totalBytes = 0;
    acc.firstChunkAt = Date.now();
    acc.flushTimer = null;

    // Energy gate: skip if silence
    if (!this.hasEnergy(pcmBuffer)) {
      return;
    }

    // Send to Whisper
    const text = await this.transcribe(pcmBuffer);
    if (!text) {
      return;
    }

    // Dedup check
    const fingerprint = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (this.recentFingerprints.includes(fingerprint)) {
      return;
    }
    this.recentFingerprints.push(fingerprint);
    if (this.recentFingerprints.length > MAX_TRANSCRIPT_FINGERPRINTS) {
      this.recentFingerprints.shift();
    }

    // Inject as ambient context
    await this.injectAmbientContext(text, nodeId, ctx);
  }

  private hasEnergy(pcm: Buffer): boolean {
    // 16-bit signed PCM — compute RMS
    const sampleCount = Math.floor(pcm.length / 2);
    if (sampleCount === 0) return false;

    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i++) {
      const sample = pcm.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    return rms > SILENCE_RMS_THRESHOLD;
  }

  private async transcribe(pcm: Buffer): Promise<string | null> {
    try {
      const resp = await fetch(`${WHISPER_URL}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
      });
      if (!resp.ok) {
        this.log?.warn(`whisper HTTP ${resp.status}`);
        return null;
      }
      const result = (await resp.json()) as { text?: string };
      const text = typeof result.text === "string" ? result.text.trim() : "";
      return text.length > 0 ? text : null;
    } catch (err) {
      this.log?.warn(`whisper request failed: ${formatForLog(err)}`);
      return null;
    }
  }

  private async injectAmbientContext(
    text: string,
    nodeId: string,
    ctx: NodeEventContext,
  ): Promise<void> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const directAddress = /\bzeke\b/i.test(text);
    const thinking = directAddress ? "mid" : "low";
    const deliver = directAddress;

    const ambientMessage = `[AMBIENT HEARING — ${timeStr}]
You overheard from your pendant microphone:
"${text}"

INSTRUCTIONS:
- If someone addresses you ("hey Zeke", "Zeke"), respond and take action.
- If actionable info (items to remember, tasks, lists), store in memory silently.
- If just background conversation, do NOT respond.
- You have full context — act with minimal questions.`;

    const sessionKey = `ambient-hearing-${nodeId}`;
    const sessionId = randomUUID();

    // Map to chat UI
    ctx.addChatRun(sessionId, {
      sessionKey,
      clientRunId: `ambient-${randomUUID()}`,
    });

    void agentCommand(
      {
        message: ambientMessage,
        sessionId,
        sessionKey,
        thinking,
        deliver,
        messageChannel: "node",
        inputProvenance: {
          kind: "external_user",
          sourceChannel: "voice",
          sourceTool: "gateway.audio.ambient",
        },
      },
      defaultRuntime,
      ctx.deps,
    ).catch((err) => {
      ctx.logGateway.warn(`ambient agent failed node=${nodeId}: ${formatForLog(err)}`);
    });
  }

  dispose(): void {
    for (const [, acc] of this.accumulators) {
      if (acc.flushTimer) {
        clearTimeout(acc.flushTimer);
      }
    }
    this.accumulators.clear();
  }
}
