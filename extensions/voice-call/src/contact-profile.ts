/**
 * Contact Profile / Dossier System
 *
 * Persistent cross-channel identity store that tracks people the agent interacts
 * with across SMS, voice, Telegram, Slack, and other channels. Each contact
 * has a single profile (dossier) that accumulates information over time.
 *
 * Key concepts:
 * - A "contact" is a person identified by one or more channel handles (phone,
 *   Telegram ID, Slack ID, etc.).
 * - The "role" classifies the relationship: admin, customer, friend, family.
 * - "identifiers" link a person across channels (e.g. same phone on SMS + voice).
 * - "notes" are free-form observations the agent appends over interactions.
 * - "recognition" holds biometric/signal hints (voice fingerprint hash, face
 *   embedding reference) — the actual ML is external; we store references.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ContactRole = "admin" | "customer" | "friend" | "family" | "unknown";

/** A single channel-specific identifier for a person. */
export type ContactIdentifier = {
  /** Channel name: "sms", "voice", "telegram", "discord", "slack", etc. */
  channel: string;
  /** The ID within that channel (phone number, user ID, etc.) */
  id: string;
  /** Optional display label (e.g. "@username") */
  label?: string;
};

/** A timestamped note appended to the dossier. */
export type ContactNote = {
  /** ISO timestamp */
  timestamp: string;
  /** Which channel/interaction produced this note */
  source: string;
  /** The note content */
  text: string;
};

/** Recognition signal references (stored, not computed here). */
export type ContactRecognition = {
  /** Voice fingerprint hash (populated by external voice analysis) */
  voiceprintHash?: string;
  /** Face embedding reference ID (populated by external facial recognition) */
  faceEmbeddingRef?: string;
};

/** The full contact profile / dossier. */
export type ContactProfile = {
  /** Stable internal ID (UUID) */
  id: string;
  /** Display name (may be updated as agent learns more) */
  name: string;
  /** Relationship role */
  role: ContactRole;
  /** All known channel identifiers for this person */
  identifiers: ContactIdentifier[];
  /** Free-form notes/observations accumulated over time */
  notes: ContactNote[];
  /** Recognition signal references */
  recognition: ContactRecognition;
  /** When this profile was first created */
  createdAt: string;
  /** When this profile was last updated */
  updatedAt: string;
  /** Optional tags for flexible categorization */
  tags: string[];
  /** Arbitrary metadata the agent may store */
  metadata: Record<string, unknown>;
};

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".openclaw", "contacts");

/**
 * Persistent contact profile store backed by a JSON file.
 *
 * Operations are synchronous reads / async writes to keep the API simple for
 * the plugin's single-process model. Writes serialize to avoid races.
 */
export class ContactProfileStore {
  private storePath: string;
  private profiles: Map<string, ContactProfile> = new Map();
  /** Index: channel:id → profile.id for fast lookup */
  private identifierIndex: Map<string, string> = new Map();
  private dirty = false;
  private writePromise: Promise<void> | null = null;

  constructor(storeDir?: string) {
    const dir = storeDir ?? DEFAULT_STORE_DIR;
    fs.mkdirSync(dir, { recursive: true });
    this.storePath = path.join(dir, "profiles.json");
    this.load();
  }

  // ---- Reads ---------------------------------------------------------------

  /** Get a profile by internal ID. */
  getById(id: string): ContactProfile | undefined {
    return this.profiles.get(id);
  }

  /** Find a profile by any channel identifier (e.g. "sms:+15551234567"). */
  findByIdentifier(channel: string, id: string): ContactProfile | undefined {
    const key = `${channel}:${id}`;
    const profileId = this.identifierIndex.get(key);
    return profileId ? this.profiles.get(profileId) : undefined;
  }

  /** Find a profile by phone number across SMS and voice channels. */
  findByPhone(phone: string): ContactProfile | undefined {
    const normalized = phone.replace(/\D/g, "");
    for (const [key, profileId] of this.identifierIndex) {
      if ((key.startsWith("sms:") || key.startsWith("voice:")) &&
          key.replace(/\D/g, "").endsWith(normalized)) {
        return this.profiles.get(profileId);
      }
    }
    return undefined;
  }

  /** List all profiles. */
  listAll(): ContactProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Search profiles by name (case-insensitive substring match). */
  search(query: string): ContactProfile[] {
    const q = query.toLowerCase();
    return this.listAll().filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.identifiers.some(
          (i) => i.id.includes(q) || i.label?.toLowerCase().includes(q),
        ),
    );
  }

  // ---- Writes --------------------------------------------------------------

  /**
   * Create or update a contact profile for a given channel identifier.
   * If a profile already exists for this identifier, merges the new info.
   * If no profile exists, creates one.
   */
  upsertByIdentifier(params: {
    channel: string;
    id: string;
    name?: string;
    role?: ContactRole;
    label?: string;
    tags?: string[];
  }): ContactProfile {
    const existing = this.findByIdentifier(params.channel, params.id);
    if (existing) {
      return this.updateProfile(existing.id, {
        name: params.name,
        role: params.role,
        tags: params.tags,
      });
    }

    const profile: ContactProfile = {
      id: crypto.randomUUID(),
      name: params.name ?? params.id,
      role: params.role ?? "unknown",
      identifiers: [
        { channel: params.channel, id: params.id, label: params.label },
      ],
      notes: [],
      recognition: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: params.tags ?? [],
      metadata: {},
    };

    this.profiles.set(profile.id, profile);
    this.rebuildIndex();
    this.scheduleSave();
    return profile;
  }

  /** Update fields on an existing profile. */
  updateProfile(
    id: string,
    updates: {
      name?: string;
      role?: ContactRole;
      tags?: string[];
      recognition?: Partial<ContactRecognition>;
      metadata?: Record<string, unknown>;
    },
  ): ContactProfile {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Contact profile ${id} not found`);
    }
    if (updates.name) profile.name = updates.name;
    if (updates.role) profile.role = updates.role;
    if (updates.tags) {
      profile.tags = [...new Set([...profile.tags, ...updates.tags])];
    }
    if (updates.recognition) {
      Object.assign(profile.recognition, updates.recognition);
    }
    if (updates.metadata) {
      Object.assign(profile.metadata, updates.metadata);
    }
    profile.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return profile;
  }

  /** Link an additional channel identifier to an existing profile. */
  addIdentifier(profileId: string, identifier: ContactIdentifier): ContactProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Contact profile ${profileId} not found`);
    }
    const exists = profile.identifiers.some(
      (i) => i.channel === identifier.channel && i.id === identifier.id,
    );
    if (!exists) {
      profile.identifiers.push(identifier);
      profile.updatedAt = new Date().toISOString();
      this.rebuildIndex();
      this.scheduleSave();
    }
    return profile;
  }

  /** Append a note to a contact's dossier. */
  addNote(profileId: string, source: string, text: string): ContactProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Contact profile ${profileId} not found`);
    }
    profile.notes.push({
      timestamp: new Date().toISOString(),
      source,
      text,
    });
    profile.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return profile;
  }

  /** Delete a profile. */
  delete(id: string): boolean {
    const deleted = this.profiles.delete(id);
    if (deleted) {
      this.rebuildIndex();
      this.scheduleSave();
    }
    return deleted;
  }

  // ---- Convenience: ensure-or-get for inbound interactions -----------------

  /**
   * Get or create a contact for an inbound phone interaction (SMS or voice).
   * If the phone matches a known profile, returns it.
   * If not, creates a new profile with role "unknown".
   */
  ensureContactForPhone(phone: string, channel: "sms" | "voice"): ContactProfile {
    const existing = this.findByPhone(phone);
    if (existing) {
      // Make sure this channel:id is linked
      const hasChannel = existing.identifiers.some(
        (i) => i.channel === channel && i.id === phone,
      );
      if (!hasChannel) {
        this.addIdentifier(existing.id, { channel, id: phone });
      }
      return existing;
    }
    return this.upsertByIdentifier({ channel, id: phone });
  }

  /**
   * Check if a phone number belongs to the admin/owner.
   */
  isOwner(phone: string, ownerNumber?: string): boolean {
    if (!ownerNumber) return false;
    const normalizedPhone = phone.replace(/\D/g, "");
    const normalizedOwner = ownerNumber.replace(/\D/g, "");
    return normalizedPhone === normalizedOwner || normalizedPhone.endsWith(normalizedOwner);
  }

  /**
   * Build a summary of a contact for agent context injection.
   * This is what gets included in the agent's system prompt so it knows who
   * it's talking to.
   */
  buildProfileSummary(profile: ContactProfile): string {
    const lines: string[] = [];
    lines.push(`Contact: ${profile.name}`);
    lines.push(`Role: ${profile.role}`);
    if (profile.tags.length > 0) {
      lines.push(`Tags: ${profile.tags.join(", ")}`);
    }
    if (profile.identifiers.length > 0) {
      const ids = profile.identifiers
        .map((i) => `${i.channel}:${i.label || i.id}`)
        .join(", ");
      lines.push(`Known on: ${ids}`);
    }
    // Include last few notes for context
    const recentNotes = profile.notes.slice(-5);
    if (recentNotes.length > 0) {
      lines.push("Recent notes:");
      for (const note of recentNotes) {
        lines.push(`  [${note.source}] ${note.text}`);
      }
    }
    return lines.join("\n");
  }

  // ---- Persistence ---------------------------------------------------------

  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = fs.readFileSync(this.storePath, "utf-8");
      const data = JSON.parse(raw) as { profiles?: ContactProfile[] };
      if (Array.isArray(data.profiles)) {
        for (const p of data.profiles) {
          this.profiles.set(p.id, p);
        }
      }
    } catch {
      // Start fresh on corrupt data
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.identifierIndex.clear();
    for (const profile of this.profiles.values()) {
      for (const identifier of profile.identifiers) {
        this.identifierIndex.set(
          `${identifier.channel}:${identifier.id}`,
          profile.id,
        );
      }
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.writePromise) return;
    this.writePromise = this.flush().finally(() => {
      this.writePromise = null;
      // If dirtied again during write, schedule another flush
      if (this.dirty) this.scheduleSave();
    });
  }

  private async flush(): Promise<void> {
    this.dirty = false;
    const data = {
      version: 1,
      profiles: Array.from(this.profiles.values()),
    };
    try {
      // Ensure the parent directory still exists (may be removed in tests)
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) return;
      await fsp.writeFile(this.storePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Swallow write errors (e.g. directory removed during test teardown)
    }
  }
}
