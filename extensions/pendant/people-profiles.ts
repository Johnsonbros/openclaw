/**
 * People profiles with location tags for pendant voice commands.
 *
 * Links voice profiles (from speaker diarization) with personal info and location preferences.
 * Allows commands like "remind me when I'm near John's house".
 */

import type { SavedLocation } from "./locations.js";
import type { PendantStorage } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A location tag for a person (can reference a saved location or be inline).
 */
export interface PersonLocation {
  tag: string; // "home", "work", "favorite_coffee", "gym"
  locationId?: string; // Reference to SavedLocation
  customLocation?: {
    // Or inline location
    latitude: number;
    longitude: number;
    address?: string;
    radiusMeters?: number;
  };
  isDefault?: boolean; // Is this their default location for this tag?
}

/**
 * A person profile.
 */
export interface PersonProfile {
  id: string; // Unique profile ID
  name: string; // "John", "Sarah", "Mom"
  voiceProfileIds: string[]; // Links to VoiceProfile IDs from speaker diarization
  locations: PersonLocation[]; // Tagged locations
  relationship?: string; // "friend", "family", "coworker", "self"
  notes?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a person profile.
 */
export interface CreatePersonParams {
  name: string;
  voiceProfileId?: string; // Initial voice profile to link
  relationship?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a person profile.
 */
export interface UpdatePersonParams {
  name?: string;
  relationship?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for adding a location to a person.
 */
export interface AddPersonLocationParams {
  personId?: string;
  personName?: string;
  tag: string; // "home", "work", etc.
  locationId?: string; // Reference to saved location
  latitude?: number; // For inline location
  longitude?: number;
  address?: string;
  radiusMeters?: number;
  isDefault?: boolean;
}

// ============================================================================
// Storage
// ============================================================================

const PEOPLE_PROFILES_KEY = "pendant:people_profiles";

/**
 * Load people profiles from storage.
 */
async function loadProfiles(storage: PendantStorage): Promise<PersonProfile[]> {
  try {
    const stored = await storage?.get(PEOPLE_PROFILES_KEY);
    if (stored) {
      return JSON.parse(stored) as PersonProfile[];
    }
  } catch (e) {
    console.error("[PeopleProfiles] Failed to load profiles:", e);
  }
  return [];
}

/**
 * Save people profiles to storage.
 */
async function saveProfiles(storage: PendantStorage, profiles: PersonProfile[]): Promise<void> {
  try {
    await storage?.set(PEOPLE_PROFILES_KEY, JSON.stringify(profiles));
  } catch (e) {
    console.error("[PeopleProfiles] Failed to save profiles:", e);
  }
}

/**
 * Generate a unique profile ID.
 */
function generateProfileId(): string {
  return `person_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// People Profile Manager
// ============================================================================

/**
 * Manager for people profiles.
 */
export class PeopleProfileManager {
  private storage: PendantStorage;
  private profiles: PersonProfile[] = [];
  private loaded = false;

  constructor(storage: PendantStorage) {
    this.storage = storage;
  }

  /**
   * Ensure data is loaded from storage.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.profiles = await loadProfiles(this.storage);
      this.loaded = true;
    }
  }

  /**
   * Save profiles to storage.
   */
  private async save(): Promise<void> {
    await saveProfiles(this.storage, this.profiles);
  }

  // ==========================================================================
  // Profile Operations
  // ==========================================================================

  /**
   * Create a new person profile.
   */
  async createProfile(params: CreatePersonParams): Promise<PersonProfile> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const profile: PersonProfile = {
      id: generateProfileId(),
      name: params.name,
      voiceProfileIds: params.voiceProfileId ? [params.voiceProfileId] : [],
      locations: [],
      relationship: params.relationship,
      notes: params.notes,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };

    this.profiles.push(profile);
    await this.save();

    return profile;
  }

  /**
   * Get a profile by ID.
   */
  async getProfile(id: string): Promise<PersonProfile | null> {
    await this.ensureLoaded();
    return this.profiles.find((p) => p.id === id) || null;
  }

  /**
   * Find a profile by name (case-insensitive).
   */
  async findProfileByName(name: string): Promise<PersonProfile | null> {
    await this.ensureLoaded();
    const normalizedName = name.toLowerCase();
    return this.profiles.find((p) => p.name.toLowerCase() === normalizedName) || null;
  }

  /**
   * Find a profile by voice profile ID.
   */
  async findProfileByVoiceId(voiceProfileId: string): Promise<PersonProfile | null> {
    await this.ensureLoaded();
    return this.profiles.find((p) => p.voiceProfileIds.includes(voiceProfileId)) || null;
  }

  /**
   * List all profiles.
   */
  async listProfiles(options?: {
    relationship?: string;
    limit?: number;
  }): Promise<PersonProfile[]> {
    await this.ensureLoaded();

    let filtered = [...this.profiles];

    if (options?.relationship) {
      filtered = filtered.filter(
        (p) => p.relationship?.toLowerCase() === options.relationship?.toLowerCase(),
      );
    }

    // Sort by name
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Update a profile.
   */
  async updateProfile(id: string, params: UpdatePersonParams): Promise<PersonProfile | null> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) {
      return null;
    }

    if (params.name !== undefined) profile.name = params.name;
    if (params.relationship !== undefined) profile.relationship = params.relationship;
    if (params.notes !== undefined) profile.notes = params.notes;
    if (params.metadata !== undefined) {
      profile.metadata = { ...profile.metadata, ...params.metadata };
    }

    profile.updatedAt = new Date().toISOString();
    await this.save();

    return profile;
  }

  /**
   * Delete a profile.
   */
  async deleteProfile(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return false;
    }

    this.profiles.splice(index, 1);
    await this.save();

    return true;
  }

  // ==========================================================================
  // Voice Profile Linking
  // ==========================================================================

  /**
   * Link a voice profile to a person profile.
   */
  async linkVoiceProfile(personId: string, voiceProfileId: string): Promise<boolean> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return false;
    }

    if (!profile.voiceProfileIds.includes(voiceProfileId)) {
      profile.voiceProfileIds.push(voiceProfileId);
      profile.updatedAt = new Date().toISOString();
      await this.save();
    }

    return true;
  }

  /**
   * Unlink a voice profile from a person profile.
   */
  async unlinkVoiceProfile(personId: string, voiceProfileId: string): Promise<boolean> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return false;
    }

    const index = profile.voiceProfileIds.indexOf(voiceProfileId);
    if (index === -1) {
      return false;
    }

    profile.voiceProfileIds.splice(index, 1);
    profile.updatedAt = new Date().toISOString();
    await this.save();

    return true;
  }

  // ==========================================================================
  // Location Tag Operations
  // ==========================================================================

  /**
   * Add a location tag to a person.
   */
  async addLocation(personId: string, location: PersonLocation): Promise<boolean> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return false;
    }

    // Check if tag already exists
    const existingIndex = profile.locations.findIndex(
      (l) => l.tag.toLowerCase() === location.tag.toLowerCase(),
    );

    if (existingIndex !== -1) {
      // Replace existing
      profile.locations[existingIndex] = location;
    } else {
      profile.locations.push(location);
    }

    profile.updatedAt = new Date().toISOString();
    await this.save();

    return true;
  }

  /**
   * Remove a location tag from a person.
   */
  async removeLocation(personId: string, tag: string): Promise<boolean> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return false;
    }

    const index = profile.locations.findIndex((l) => l.tag.toLowerCase() === tag.toLowerCase());

    if (index === -1) {
      return false;
    }

    profile.locations.splice(index, 1);
    profile.updatedAt = new Date().toISOString();
    await this.save();

    return true;
  }

  /**
   * Get a person's location by tag.
   */
  async getPersonLocation(personId: string, tag: string): Promise<PersonLocation | null> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return null;
    }

    return profile.locations.find((l) => l.tag.toLowerCase() === tag.toLowerCase()) || null;
  }

  /**
   * Get all locations for a person.
   */
  async getPersonLocations(personId: string): Promise<PersonLocation[]> {
    await this.ensureLoaded();

    const profile = this.profiles.find((p) => p.id === personId);
    if (!profile) {
      return [];
    }

    return [...profile.locations];
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get or create a profile for a person by name.
   */
  async getOrCreateByName(
    name: string,
    createParams?: Partial<CreatePersonParams>,
  ): Promise<PersonProfile> {
    const existing = await this.findProfileByName(name);
    if (existing) {
      return existing;
    }

    return this.createProfile({
      name,
      ...createParams,
    });
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Wrap a result object in the AgentToolResult format.
 */
function toolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

/**
 * Callbacks for people profile events.
 */
export interface PeopleEventCallbacks {
  onLocationAdded?: (personId: string, personName: string, location: PersonLocation) => void;
}

/**
 * Create people profile tools for the pendant plugin.
 */
export function createPeopleTools(
  peopleManager: PeopleProfileManager,
  callbacks?: PeopleEventCallbacks,
) {
  return [
    // Create profile tool
    {
      name: "person_profile_create",
      label: "Create Person Profile",
      description: "Create a profile for a person to track their locations and info",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description: "Person's name",
          },
          voiceProfileId: {
            type: "string" as const,
            description: "Voice profile ID to link (optional)",
          },
          relationship: {
            type: "string" as const,
            description: 'Relationship type (e.g., "friend", "family", "coworker")',
          },
          notes: {
            type: "string" as const,
            description: "Any notes about this person",
          },
        },
        required: ["name"],
      },
      async execute(
        _toolCallId: string,
        params: {
          name: string;
          voiceProfileId?: string;
          relationship?: string;
          notes?: string;
        },
      ) {
        const profile = await peopleManager.createProfile(params);

        return toolResult({
          success: true,
          profile: {
            id: profile.id,
            name: profile.name,
            relationship: profile.relationship,
            voiceProfileIds: profile.voiceProfileIds,
          },
          message: `Created profile for "${profile.name}"`,
        });
      },
    },

    // Update profile tool
    {
      name: "person_profile_update",
      label: "Update Person Profile",
      description: "Update a person's profile information",
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
          name: {
            type: "string" as const,
            description: "New name",
          },
          relationship: {
            type: "string" as const,
            description: "New relationship type",
          },
          notes: {
            type: "string" as const,
            description: "New notes",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          personId?: string;
          personName?: string;
          name?: string;
          relationship?: string;
          notes?: string;
        },
      ) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found",
          });
        }

        const updated = await peopleManager.updateProfile(profile.id, {
          name: params.name,
          relationship: params.relationship,
          notes: params.notes,
        });

        if (!updated) {
          return toolResult({
            success: false,
            error: "Failed to update profile",
          });
        }

        return toolResult({
          success: true,
          profile: {
            id: updated.id,
            name: updated.name,
            relationship: updated.relationship,
          },
          message: `Updated profile for "${updated.name}"`,
        });
      },
    },

    // List profiles tool
    {
      name: "person_profile_list",
      label: "List People Profiles",
      description: "List all people profiles",
      parameters: {
        type: "object" as const,
        properties: {
          relationship: {
            type: "string" as const,
            description: "Filter by relationship type",
          },
          limit: {
            type: "number" as const,
            description: "Maximum number of profiles to return",
          },
        },
        required: [],
      },
      async execute(_toolCallId: string, params: { relationship?: string; limit?: number }) {
        const profiles = await peopleManager.listProfiles(params);

        return toolResult({
          count: profiles.length,
          profiles: profiles.map((p) => ({
            id: p.id,
            name: p.name,
            relationship: p.relationship,
            locationCount: p.locations.length,
            locationTags: p.locations.map((l) => l.tag),
            hasVoiceProfile: p.voiceProfileIds.length > 0,
          })),
        });
      },
    },

    // Get profile tool
    {
      name: "person_profile_get",
      label: "Get Person Profile",
      description: "Get detailed information about a specific person",
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
        },
        required: [],
      },
      async execute(_toolCallId: string, params: { personId?: string; personName?: string }) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found",
          });
        }

        return toolResult({
          success: true,
          profile: {
            id: profile.id,
            name: profile.name,
            relationship: profile.relationship,
            notes: profile.notes,
            voiceProfileIds: profile.voiceProfileIds,
            locations: profile.locations.map((l) => ({
              tag: l.tag,
              hasLocationId: !!l.locationId,
              locationId: l.locationId,
              customLocation: l.customLocation,
              isDefault: l.isDefault,
            })),
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          },
        });
      },
    },

    // Add location tag tool
    {
      name: "person_location_add",
      label: "Add Person Location",
      description: 'Add a location tag to a person (e.g., "John\'s home is at...")',
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
          tag: {
            type: "string" as const,
            description: 'Location tag (e.g., "home", "work", "favorite_coffee")',
          },
          locationId: {
            type: "string" as const,
            description: "Reference to a saved location ID",
          },
          latitude: {
            type: "number" as const,
            description: "Latitude for custom location",
          },
          longitude: {
            type: "number" as const,
            description: "Longitude for custom location",
          },
          address: {
            type: "string" as const,
            description: "Address for custom location",
          },
          radiusMeters: {
            type: "number" as const,
            description: "Radius for custom location geofence",
          },
          isDefault: {
            type: "boolean" as const,
            description: "Is this the default location for this tag?",
          },
        },
        required: ["tag"],
      },
      async execute(
        _toolCallId: string,
        params: {
          personId?: string;
          personName?: string;
          tag: string;
          locationId?: string;
          latitude?: number;
          longitude?: number;
          address?: string;
          radiusMeters?: number;
          isDefault?: boolean;
        },
      ) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        // Auto-create profile if not found and name provided
        if (!profile && params.personName) {
          profile = await peopleManager.createProfile({ name: params.personName });
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found and no name provided to create",
          });
        }

        const location: PersonLocation = {
          tag: params.tag,
          locationId: params.locationId,
          isDefault: params.isDefault,
        };

        // Add custom location if coordinates provided
        if (params.latitude !== undefined && params.longitude !== undefined) {
          location.customLocation = {
            latitude: params.latitude,
            longitude: params.longitude,
            address: params.address,
            radiusMeters: params.radiusMeters,
          };
        }

        await peopleManager.addLocation(profile.id, location);

        // Notify via callback for potential geofence registration
        if (callbacks?.onLocationAdded) {
          callbacks.onLocationAdded(profile.id, profile.name, location);
        }

        return toolResult({
          success: true,
          message: `Set ${profile.name}'s ${params.tag}`,
          person: {
            id: profile.id,
            name: profile.name,
          },
          location: {
            tag: params.tag,
            hasLocationId: !!params.locationId,
            hasCustomLocation: !!location.customLocation,
          },
        });
      },
    },

    // Remove location tag tool
    {
      name: "person_location_remove",
      label: "Remove Person Location",
      description: "Remove a location tag from a person",
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
          tag: {
            type: "string" as const,
            description: "Location tag to remove",
          },
        },
        required: ["tag"],
      },
      async execute(
        _toolCallId: string,
        params: {
          personId?: string;
          personName?: string;
          tag: string;
        },
      ) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found",
          });
        }

        const removed = await peopleManager.removeLocation(profile.id, params.tag);

        if (!removed) {
          return toolResult({
            success: false,
            error: `Location tag "${params.tag}" not found for ${profile.name}`,
          });
        }

        return toolResult({
          success: true,
          message: `Removed ${profile.name}'s ${params.tag}`,
        });
      },
    },

    // List person's locations tool
    {
      name: "person_location_list",
      label: "List Person Locations",
      description: "List all saved locations for a person",
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
        },
        required: [],
      },
      async execute(_toolCallId: string, params: { personId?: string; personName?: string }) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found",
          });
        }

        return toolResult({
          success: true,
          person: {
            id: profile.id,
            name: profile.name,
          },
          locations: profile.locations.map((l) => ({
            tag: l.tag,
            locationId: l.locationId,
            customLocation: l.customLocation
              ? {
                  address: l.customLocation.address,
                  hasCoordinates: true,
                }
              : null,
            isDefault: l.isDefault,
          })),
        });
      },
    },

    // Link voice profile tool
    {
      name: "person_voice_link",
      label: "Link Voice Profile",
      description: "Link a voice profile to a person (for speaker identification)",
      parameters: {
        type: "object" as const,
        properties: {
          personId: {
            type: "string" as const,
            description: "Person profile ID",
          },
          personName: {
            type: "string" as const,
            description: "Person's name to find",
          },
          voiceProfileId: {
            type: "string" as const,
            description: "Voice profile ID from speaker diarization",
          },
        },
        required: ["voiceProfileId"],
      },
      async execute(
        _toolCallId: string,
        params: {
          personId?: string;
          personName?: string;
          voiceProfileId: string;
        },
      ) {
        let profile: PersonProfile | null = null;

        if (params.personId) {
          profile = await peopleManager.getProfile(params.personId);
        } else if (params.personName) {
          profile = await peopleManager.findProfileByName(params.personName);
        }

        if (!profile) {
          return toolResult({
            success: false,
            error: "Person not found",
          });
        }

        await peopleManager.linkVoiceProfile(profile.id, params.voiceProfileId);

        // Refresh profile to get updated voiceProfileIds count
        const updatedProfile = await peopleManager.getProfile(profile.id);

        return toolResult({
          success: true,
          message: `Linked voice profile to ${profile.name}`,
          person: {
            id: profile.id,
            name: profile.name,
            voiceProfileCount:
              updatedProfile?.voiceProfileIds.length ?? profile.voiceProfileIds.length,
          },
        });
      },
    },
  ];
}
