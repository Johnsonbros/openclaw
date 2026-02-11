import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContactProfileStore } from "./contact-profile.js";

describe("ContactProfileStore", () => {
  let tmpDir: string;
  let store: ContactProfileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "contact-profile-test-"));
    store = new ContactProfileStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("upsertByIdentifier", () => {
    it("creates a new profile for a new phone number", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Alice",
        role: "customer",
      });

      expect(profile.name).toBe("Alice");
      expect(profile.role).toBe("customer");
      expect(profile.identifiers).toHaveLength(1);
      expect(profile.identifiers[0].channel).toBe("sms");
      expect(profile.identifiers[0].id).toBe("+15551234567");
      expect(profile.id).toBeTruthy();
    });

    it("returns existing profile for same identifier", () => {
      const first = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Alice",
        role: "customer",
      });
      const second = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Alice Updated",
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Alice Updated");
    });

    it("defaults to unknown role when not specified", () => {
      const profile = store.upsertByIdentifier({
        channel: "voice",
        id: "+15559999999",
      });
      expect(profile.role).toBe("unknown");
      expect(profile.name).toBe("+15559999999");
    });
  });

  describe("findByIdentifier", () => {
    it("finds profile by exact channel:id match", () => {
      store.upsertByIdentifier({
        channel: "telegram",
        id: "123456789",
        name: "Bob",
      });

      const found = store.findByIdentifier("telegram", "123456789");
      expect(found).toBeDefined();
      expect(found!.name).toBe("Bob");
    });

    it("returns undefined for unknown identifier", () => {
      const found = store.findByIdentifier("slack", "nobody");
      expect(found).toBeUndefined();
    });
  });

  describe("findByPhone", () => {
    it("finds profile by phone number across SMS and voice", () => {
      store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Charlie",
      });

      const bySms = store.findByPhone("+15551234567");
      expect(bySms).toBeDefined();
      expect(bySms!.name).toBe("Charlie");
    });

    it("matches normalized phone numbers", () => {
      store.upsertByIdentifier({
        channel: "voice",
        id: "+15551234567",
        name: "Charlie",
      });

      const found = store.findByPhone("5551234567");
      expect(found).toBeDefined();
      expect(found!.name).toBe("Charlie");
    });
  });

  describe("addIdentifier", () => {
    it("links additional channel to existing profile", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Dave",
      });

      store.addIdentifier(profile.id, {
        channel: "telegram",
        id: "987654321",
        label: "@dave",
      });

      const updated = store.getById(profile.id)!;
      expect(updated.identifiers).toHaveLength(2);
      expect(updated.identifiers[1].channel).toBe("telegram");
      expect(updated.identifiers[1].label).toBe("@dave");
    });

    it("does not duplicate existing identifier", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
      });

      store.addIdentifier(profile.id, { channel: "sms", id: "+15551234567" });
      const updated = store.getById(profile.id)!;
      expect(updated.identifiers).toHaveLength(1);
    });
  });

  describe("addNote", () => {
    it("appends notes to profile dossier", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Eve",
      });

      store.addNote(profile.id, "sms", "Asked about pricing");
      store.addNote(profile.id, "voice", "Called to follow up on order");

      const updated = store.getById(profile.id)!;
      expect(updated.notes).toHaveLength(2);
      expect(updated.notes[0].source).toBe("sms");
      expect(updated.notes[0].text).toBe("Asked about pricing");
      expect(updated.notes[1].source).toBe("voice");
    });
  });

  describe("ensureContactForPhone", () => {
    it("creates new contact if none exists", () => {
      const profile = store.ensureContactForPhone("+15559876543", "sms");
      expect(profile).toBeDefined();
      expect(profile.identifiers[0].channel).toBe("sms");
    });

    it("returns existing contact and links new channel", () => {
      store.upsertByIdentifier({
        channel: "sms",
        id: "+15559876543",
        name: "Frank",
      });

      const profile = store.ensureContactForPhone("+15559876543", "voice");
      expect(profile.name).toBe("Frank");
      expect(profile.identifiers).toHaveLength(2);
    });
  });

  describe("isOwner", () => {
    it("recognizes owner phone number", () => {
      expect(store.isOwner("+15551234567", "+15551234567")).toBe(true);
    });

    it("handles normalized matching", () => {
      expect(store.isOwner("+15551234567", "+15551234567")).toBe(true);
    });

    it("returns false when no owner configured", () => {
      expect(store.isOwner("+15551234567", undefined)).toBe(false);
    });

    it("returns false for non-owner", () => {
      expect(store.isOwner("+15559999999", "+15551234567")).toBe(false);
    });
  });

  describe("buildProfileSummary", () => {
    it("produces readable summary for agent context", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Grace",
        role: "customer",
        tags: ["vip", "early-adopter"],
      });
      store.addNote(profile.id, "sms", "Interested in premium plan");

      const summary = store.buildProfileSummary(store.getById(profile.id)!);
      expect(summary).toContain("Grace");
      expect(summary).toContain("customer");
      expect(summary).toContain("vip");
      expect(summary).toContain("Interested in premium plan");
    });
  });

  describe("search", () => {
    it("searches by name", () => {
      store.upsertByIdentifier({ channel: "sms", id: "+1", name: "Alice" });
      store.upsertByIdentifier({ channel: "sms", id: "+2", name: "Bob" });

      const results = store.search("alice");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });

    it("searches by tag", () => {
      store.upsertByIdentifier({
        channel: "sms",
        id: "+1",
        name: "Alice",
        tags: ["vip"],
      });
      store.upsertByIdentifier({ channel: "sms", id: "+2", name: "Bob" });

      const results = store.search("vip");
      expect(results).toHaveLength(1);
    });
  });

  describe("persistence", () => {
    it("loads profiles from disk on new store instance", async () => {
      store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Persistent Pete",
        role: "friend",
      });

      // Wait for async write
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new store from same directory
      const store2 = new ContactProfileStore(tmpDir);
      const loaded = store2.findByPhone("+15551234567");
      expect(loaded).toBeDefined();
      expect(loaded!.name).toBe("Persistent Pete");
      expect(loaded!.role).toBe("friend");
    });
  });

  describe("delete", () => {
    it("removes a profile", () => {
      const profile = store.upsertByIdentifier({
        channel: "sms",
        id: "+15551234567",
        name: "Temp",
      });

      expect(store.delete(profile.id)).toBe(true);
      expect(store.findByPhone("+15551234567")).toBeUndefined();
    });

    it("returns false for non-existent profile", () => {
      expect(store.delete("nonexistent-id")).toBe(false);
    });
  });
});
