/**
 * Memory hook for auto-saving pendant transcripts to long-term memory.
 *
 * Automatically batches and saves pendant transcripts to the memory directory
 * for later retrieval and search. Creates dated markdown files that are
 * searchable by the memory system.
 *
 * @module pendant/memory-hook
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

/**
 * A single transcript entry in the buffer.
 */
export interface TranscriptEntry {
  /** ISO timestamp of when the transcript was captured */
  timestamp: string;
  /** Speaker ID from voice profile (if available) */
  speakerId?: string;
  /** Speaker name from voice profile (if known) */
  speakerName?: string;
  /** The actual transcript text */
  text: string;
  /** Confidence score of the transcription (0-1) */
  confidence?: number;
  /** Duration of the audio in milliseconds */
  durationMs?: number;
  /** Intent detected from the transcript */
  detectedIntent?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Buffer state for accumulating transcripts before flushing.
 */
export interface TranscriptBuffer {
  /** Buffered transcript entries */
  entries: TranscriptEntry[];
  /** Timestamp of last flush to memory */
  lastFlush: number;
  /** Session key this buffer belongs to */
  sessionKey: string;
  /** Total character count in buffer */
  totalChars: number;
}

/**
 * Configuration for the memory hook.
 */
export interface MemoryHookConfig {
  /** Whether auto-save is enabled */
  enabled: boolean;
  /** Directory to save memory files (relative to workspace) */
  memoryDir: string;
  /** Minimum time between flushes in milliseconds */
  flushIntervalMs: number;
  /** Minimum entries before flushing */
  flushMinEntries: number;
  /** Maximum entries before forcing flush */
  flushMaxEntries: number;
  /** Maximum characters before forcing flush */
  flushMaxChars: number;
  /** Whether to include speaker info in memory files */
  includeSpeakerInfo: boolean;
  /** Whether to include detected intents in memory files */
  includeIntents: boolean;
  /** File format for memory files */
  fileFormat: "markdown" | "json";
}

/**
 * Statistics about memory hook activity.
 */
export interface MemoryHookStats {
  /** Total entries processed */
  totalEntries: number;
  /** Total files created */
  totalFiles: number;
  /** Total characters saved */
  totalChars: number;
  /** Last flush timestamp */
  lastFlushTime: string | null;
  /** Current buffer size */
  currentBufferSize: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MemoryHookConfig = {
  enabled: true,
  memoryDir: "memory",
  flushIntervalMs: 300000, // 5 minutes
  flushMinEntries: 5,
  flushMaxEntries: 50,
  flushMaxChars: 10000,
  includeSpeakerInfo: true,
  includeIntents: true,
  fileFormat: "markdown",
};

// ============================================================================
// Memory Hook Manager
// ============================================================================

/**
 * Manager for auto-saving pendant transcripts to memory.
 *
 * @example
 * ```typescript
 * const memoryHook = new MemoryHookManager(api.runtime.storage, "/workspace");
 *
 * // Add transcript to buffer
 * memoryHook.addEntry("session_123", {
 *   timestamp: new Date().toISOString(),
 *   text: "Remember to call John tomorrow",
 *   speakerName: "Alice",
 * });
 *
 * // Buffer will auto-flush based on configuration
 * ```
 */
export class MemoryHookManager {
  private config: MemoryHookConfig;
  private buffers: Map<string, TranscriptBuffer> = new Map();
  private workspaceDir: string;
  private stats: MemoryHookStats = {
    totalEntries: 0,
    totalFiles: 0,
    totalChars: 0,
    lastFlushTime: null,
    currentBufferSize: 0,
  };
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * Create a new MemoryHookManager.
   *
   * @param workspaceDir - The workspace directory for saving memory files
   * @param config - Optional configuration overrides
   */
  constructor(workspaceDir: string, config: Partial<MemoryHookConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.workspaceDir = workspaceDir;

    // Start periodic flush timer if enabled
    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Start the periodic flush timer.
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(async () => {
      await this.flushAllBuffers();
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop the periodic flush timer.
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Update configuration.
   *
   * @param config - New configuration values
   */
  updateConfig(config: Partial<MemoryHookConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.enabled) {
      this.startFlushTimer();
    } else {
      this.stopFlushTimer();
    }
  }

  /**
   * Add a transcript entry to the buffer.
   *
   * @param sessionKey - The session key for this entry
   * @param entry - The transcript entry to add
   */
  async addEntry(sessionKey: string, entry: TranscriptEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    let buffer = this.buffers.get(sessionKey);
    if (!buffer) {
      buffer = {
        entries: [],
        lastFlush: Date.now(),
        sessionKey,
        totalChars: 0,
      };
      this.buffers.set(sessionKey, buffer);
    }

    buffer.entries.push(entry);
    buffer.totalChars += entry.text.length;
    this.stats.totalEntries++;
    this.stats.currentBufferSize = this.getTotalBufferSize();

    // Check if we should flush
    const shouldFlush =
      buffer.entries.length >= this.config.flushMaxEntries ||
      buffer.totalChars >= this.config.flushMaxChars ||
      (buffer.entries.length >= this.config.flushMinEntries &&
        Date.now() - buffer.lastFlush >= this.config.flushIntervalMs);

    if (shouldFlush) {
      await this.flushBuffer(sessionKey);
    }
  }

  /**
   * Flush a specific session's buffer to memory.
   *
   * @param sessionKey - The session key to flush
   */
  async flushBuffer(sessionKey: string): Promise<void> {
    const buffer = this.buffers.get(sessionKey);
    if (!buffer || buffer.entries.length === 0) {
      return;
    }

    try {
      await this.writeToMemory(buffer);
      this.stats.totalFiles++;
      this.stats.totalChars += buffer.totalChars;
      this.stats.lastFlushTime = new Date().toISOString();

      // Clear buffer
      buffer.entries = [];
      buffer.totalChars = 0;
      buffer.lastFlush = Date.now();
      this.stats.currentBufferSize = this.getTotalBufferSize();
    } catch (error) {
      console.error(`[MemoryHook] Failed to flush buffer for ${sessionKey}:`, error);
    }
  }

  /**
   * Flush all session buffers to memory.
   */
  async flushAllBuffers(): Promise<void> {
    for (const sessionKey of Array.from(this.buffers.keys())) {
      await this.flushBuffer(sessionKey);
    }
  }

  /**
   * Write buffer contents to a memory file.
   *
   * @param buffer - The buffer to write
   */
  private async writeToMemory(buffer: TranscriptBuffer): Promise<void> {
    const memoryPath = path.join(this.workspaceDir, this.config.memoryDir);

    // Ensure memory directory exists
    await fs.mkdir(memoryPath, { recursive: true });

    // Generate filename with timestamp
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const ext = this.config.fileFormat === "json" ? "json" : "md";
    const filename = `pendant-${dateStr}.${ext}`;
    const filepath = path.join(memoryPath, filename);

    // Generate content
    const content =
      this.config.fileFormat === "json" ? this.formatAsJson(buffer) : this.formatAsMarkdown(buffer);

    // Write file (append if exists)
    try {
      const existing = await fs.readFile(filepath, "utf-8").catch(() => "");
      const separator = existing ? "\n\n---\n\n" : "";
      await fs.writeFile(filepath, existing + separator + content, "utf-8");
    } catch (error) {
      // File doesn't exist, create new
      await fs.writeFile(filepath, content, "utf-8");
    }

    console.log(`[MemoryHook] Saved ${buffer.entries.length} entries to ${filename}`);
  }

  /**
   * Format buffer as markdown.
   *
   * @param buffer - The buffer to format
   * @returns Markdown string
   */
  private formatAsMarkdown(buffer: TranscriptBuffer): string {
    const lines: string[] = [];

    // Safety check for empty buffer
    if (buffer.entries.length === 0) {
      return "## Pendant Transcript\n\n_No entries_\n";
    }

    // Header
    const firstEntry = buffer.entries[0];
    const lastEntry = buffer.entries[buffer.entries.length - 1];
    const startTime = firstEntry ? new Date(firstEntry.timestamp).toLocaleString() : "Unknown";
    const endTime = lastEntry ? new Date(lastEntry.timestamp).toLocaleString() : "Unknown";

    lines.push(`## Pendant Transcript`);
    lines.push(`**Session:** ${buffer.sessionKey.slice(0, 8)}...`);
    lines.push(`**Period:** ${startTime} - ${endTime}`);
    lines.push(`**Entries:** ${buffer.entries.length}`);
    lines.push("");

    // Entries
    for (const entry of buffer.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();

      // Speaker label
      let speaker = "";
      if (this.config.includeSpeakerInfo) {
        if (entry.speakerName) {
          speaker = `**${entry.speakerName}**`;
        } else if (entry.speakerId) {
          speaker = `*Speaker ${entry.speakerId.slice(-6)}*`;
        }
      }

      // Build entry line
      let line = `- [${time}]`;
      if (speaker) {
        line += ` ${speaker}:`;
      }
      line += ` ${entry.text}`;

      // Add intent if configured and detected
      if (this.config.includeIntents && entry.detectedIntent) {
        line += ` _(${entry.detectedIntent})_`;
      }

      lines.push(line);
    }

    return lines.join("\n");
  }

  /**
   * Format buffer as JSON.
   *
   * @param buffer - The buffer to format
   * @returns JSON string
   */
  private formatAsJson(buffer: TranscriptBuffer): string {
    const data = {
      sessionKey: buffer.sessionKey,
      startTime: buffer.entries[0]?.timestamp,
      endTime: buffer.entries[buffer.entries.length - 1]?.timestamp,
      entryCount: buffer.entries.length,
      entries: buffer.entries.map((entry) => ({
        timestamp: entry.timestamp,
        text: entry.text,
        ...(this.config.includeSpeakerInfo && {
          speakerId: entry.speakerId,
          speakerName: entry.speakerName,
        }),
        ...(this.config.includeIntents && {
          detectedIntent: entry.detectedIntent,
        }),
        ...(entry.confidence !== undefined && {
          confidence: entry.confidence,
        }),
        ...(entry.durationMs !== undefined && {
          durationMs: entry.durationMs,
        }),
      })),
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Get total size of all buffers.
   *
   * @returns Total number of entries across all buffers
   */
  private getTotalBufferSize(): number {
    let total = 0;
    for (const buffer of Array.from(this.buffers.values())) {
      total += buffer.entries.length;
    }
    return total;
  }

  /**
   * Get statistics about the memory hook.
   *
   * @returns Current statistics
   */
  getStats(): MemoryHookStats {
    return {
      ...this.stats,
      currentBufferSize: this.getTotalBufferSize(),
    };
  }

  /**
   * Check if a buffer exists for a session.
   *
   * @param sessionKey - The session key to check
   * @returns True if buffer exists
   */
  hasBuffer(sessionKey: string): boolean {
    return this.buffers.has(sessionKey);
  }

  /**
   * Get buffer entries for a session (for debugging/inspection).
   *
   * @param sessionKey - The session key
   * @returns Buffer entries or empty array
   */
  getBufferEntries(sessionKey: string): TranscriptEntry[] {
    return this.buffers.get(sessionKey)?.entries || [];
  }

  /**
   * Clear a session's buffer without saving.
   *
   * @param sessionKey - The session key to clear
   */
  clearBuffer(sessionKey: string): void {
    this.buffers.delete(sessionKey);
    this.stats.currentBufferSize = this.getTotalBufferSize();
  }

  /**
   * Release resources and flush all buffers.
   */
  async release(): Promise<void> {
    this.stopFlushTimer();
    await this.flushAllBuffers();
    this.buffers.clear();
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create memory hook tools for the pendant plugin.
 *
 * @param memoryHook - The MemoryHookManager instance
 * @returns Array of tool definitions
 */
export function createMemoryTools(memoryHook: MemoryHookManager) {
  return [
    {
      name: "pendant_memory_status",
      label: "Memory Status",
      description: "Get status and statistics of the pendant memory auto-save system",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        const stats = memoryHook.getStats();

        return {
          enabled: true,
          stats: {
            totalEntriesProcessed: stats.totalEntries,
            totalFilesSaved: stats.totalFiles,
            totalCharactersSaved: stats.totalChars,
            lastFlushTime: stats.lastFlushTime,
            currentBufferSize: stats.currentBufferSize,
          },
        };
      },
    },

    {
      name: "pendant_memory_flush",
      label: "Flush Memory",
      description: "Manually flush all pending transcripts to memory files",
      parameters: {
        type: "object" as const,
        properties: {
          sessionKey: {
            type: "string" as const,
            description: "Flush only this session (optional, flushes all if not provided)",
          },
        },
        required: [],
      },
      async execute(params: { sessionKey?: string }) {
        if (params.sessionKey) {
          await memoryHook.flushBuffer(params.sessionKey);
        } else {
          await memoryHook.flushAllBuffers();
        }

        return {
          success: true,
          message: params.sessionKey
            ? `Flushed buffer for session ${params.sessionKey}`
            : "Flushed all buffers",
        };
      },
    },
  ];
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Create a transcript handler that integrates with the memory hook.
 *
 * @param memoryHook - The MemoryHookManager instance
 * @returns Handler function for transcript events
 */
export function createTranscriptHandler(memoryHook: MemoryHookManager) {
  return async (event: {
    sessionKey: string;
    transcript: string;
    formattedTranscript: string;
    speaker?: {
      id: string;
      name: string | null;
      confidence: number;
    };
    durationMs?: number;
    timestamp: string;
    detectedIntent?: string;
  }) => {
    await memoryHook.addEntry(event.sessionKey, {
      timestamp: event.timestamp,
      speakerId: event.speaker?.id,
      speakerName: event.speaker?.name || undefined,
      text: event.transcript,
      confidence: event.speaker?.confidence,
      durationMs: event.durationMs,
      detectedIntent: event.detectedIntent,
    });
  };
}
