/**
 * File-based storage for pendant plugin data.
 *
 * Since the plugin SDK doesn't provide a storage API, we use the file system
 * to persist plugin state (tasks, locations, profiles, etc.).
 *
 * @module pendant/storage
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Storage interface for pendant plugin data.
 */
export interface PendantStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * File-based storage implementation.
 *
 * Stores data as JSON files in the state directory.
 */
export class FileStorage implements PendantStorage {
  private stateDir: string;
  private ready: Promise<void>;

  constructor(stateDir: string) {
    this.stateDir = path.join(stateDir, "plugins", "pendant");
    this.ready = this.ensureDir();
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent path traversal
    const safeKey = key.replace(/[^a-zA-Z0-9_:-]/g, "_");
    return path.join(this.stateDir, `${safeKey}.json`);
  }

  async get(key: string): Promise<string | null> {
    await this.ready;
    try {
      const filePath = this.getFilePath(key);
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, value, "utf-8");
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

/**
 * In-memory storage implementation for testing.
 */
export class MemoryStorage implements PendantStorage {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/**
 * Create storage instance based on available state directory.
 */
export function createStorage(stateDir?: string): PendantStorage {
  if (stateDir) {
    return new FileStorage(stateDir);
  }
  // Fallback to memory storage if no state dir available
  console.warn("[Pendant] No state directory available, using in-memory storage");
  return new MemoryStorage();
}
