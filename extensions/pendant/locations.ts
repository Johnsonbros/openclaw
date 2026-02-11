/**
 * Location management for pendant voice commands.
 *
 * Manages saved locations and location groups for geofencing.
 * Locations can be starred, organized into groups, and have configurable radii.
 */

import type { PendantStorage } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A saved location.
 */
export interface SavedLocation {
  id: string;
  name: string; // "Home", "Work", "Gym"
  latitude: number;
  longitude: number;
  radiusMeters: number; // Geofence radius, default: 100m
  address?: string; // Human-readable address
  starred: boolean; // Is this a favorite?
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * A group of locations (e.g., "Grocery Stores", "Offices", "Family").
 */
export interface LocationGroup {
  id: string;
  name: string; // "Grocery Stores", "Offices", "Family"
  locationIds: string[]; // Locations in this group
  defaultRadiusMeters: number; // Default radius for new locations in group
  createdAt: string;
  updatedAt: string;
}

/**
 * Parameters for creating a location.
 */
export interface CreateLocationParams {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  address?: string;
  starred?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a location.
 */
export interface UpdateLocationParams {
  name?: string;
  radiusMeters?: number;
  address?: string;
  starred?: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Storage Keys
// ============================================================================

const LOCATIONS_KEY = "pendant:locations";
const LOCATION_GROUPS_KEY = "pendant:location_groups";

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_RADIUS_METERS = 100;

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Load locations from storage.
 */
async function loadLocations(storage: PendantStorage): Promise<SavedLocation[]> {
  try {
    const stored = await storage.get(LOCATIONS_KEY);
    if (stored) {
      return JSON.parse(stored) as SavedLocation[];
    }
  } catch (e) {
    console.error("[Locations] Failed to load locations:", e);
  }
  return [];
}

/**
 * Save locations to storage.
 */
async function saveLocations(storage: PendantStorage, locations: SavedLocation[]): Promise<void> {
  try {
    await storage.set(LOCATIONS_KEY, JSON.stringify(locations));
  } catch (e) {
    console.error("[Locations] Failed to save locations:", e);
  }
}

/**
 * Load location groups from storage.
 */
async function loadGroups(storage: PendantStorage): Promise<LocationGroup[]> {
  try {
    const stored = await storage.get(LOCATION_GROUPS_KEY);
    if (stored) {
      return JSON.parse(stored) as LocationGroup[];
    }
  } catch (e) {
    console.error("[Locations] Failed to load location groups:", e);
  }
  return [];
}

/**
 * Save location groups to storage.
 */
async function saveGroups(storage: PendantStorage, groups: LocationGroup[]): Promise<void> {
  try {
    await storage.set(LOCATION_GROUPS_KEY, JSON.stringify(groups));
  } catch (e) {
    console.error("[Locations] Failed to save location groups:", e);
  }
}

/**
 * Generate a unique location ID.
 */
function generateLocationId(): string {
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique group ID.
 */
function generateGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Location Manager
// ============================================================================

/**
 * Manager for locations and location groups.
 */
export class LocationManager {
  private storage: PendantStorage;
  private locations: SavedLocation[] = [];
  private groups: LocationGroup[] = [];
  private loaded = false;

  constructor(storage: PendantStorage) {
    this.storage = storage;
  }

  /**
   * Ensure data is loaded from storage.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.locations = await loadLocations(this.storage);
      this.groups = await loadGroups(this.storage);
      this.loaded = true;
    }
  }

  /**
   * Save locations to storage.
   */
  private async saveLocations(): Promise<void> {
    await saveLocations(this.storage, this.locations);
  }

  /**
   * Save groups to storage.
   */
  private async saveGroups(): Promise<void> {
    await saveGroups(this.storage, this.groups);
  }

  // ==========================================================================
  // Location Operations
  // ==========================================================================

  /**
   * Create a new saved location.
   */
  async createLocation(params: CreateLocationParams): Promise<SavedLocation> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const location: SavedLocation = {
      id: generateLocationId(),
      name: params.name,
      latitude: params.latitude,
      longitude: params.longitude,
      radiusMeters: params.radiusMeters ?? DEFAULT_RADIUS_METERS,
      address: params.address,
      starred: params.starred ?? false,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };

    this.locations.push(location);
    await this.saveLocations();

    return location;
  }

  /**
   * Get a location by ID.
   */
  async getLocation(id: string): Promise<SavedLocation | null> {
    await this.ensureLoaded();
    return this.locations.find((l) => l.id === id) || null;
  }

  /**
   * Find a location by name (case-insensitive).
   */
  async findLocationByName(name: string): Promise<SavedLocation | null> {
    await this.ensureLoaded();
    const normalizedName = name.toLowerCase();
    return this.locations.find((l) => l.name.toLowerCase() === normalizedName) || null;
  }

  /**
   * List all saved locations.
   */
  async listLocations(options?: { starred?: boolean; limit?: number }): Promise<SavedLocation[]> {
    await this.ensureLoaded();

    let filtered = [...this.locations];

    if (options?.starred !== undefined) {
      filtered = filtered.filter((l) => l.starred === options.starred);
    }

    // Sort by name
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Update a location.
   */
  async updateLocation(id: string, params: UpdateLocationParams): Promise<SavedLocation | null> {
    await this.ensureLoaded();

    const location = this.locations.find((l) => l.id === id);
    if (!location) {
      return null;
    }

    if (params.name !== undefined) location.name = params.name;
    if (params.radiusMeters !== undefined) location.radiusMeters = params.radiusMeters;
    if (params.address !== undefined) location.address = params.address;
    if (params.starred !== undefined) location.starred = params.starred;
    if (params.metadata !== undefined) {
      location.metadata = { ...location.metadata, ...params.metadata };
    }

    location.updatedAt = new Date().toISOString();
    await this.saveLocations();

    return location;
  }

  /**
   * Delete a location.
   */
  async deleteLocation(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.locations.findIndex((l) => l.id === id);
    if (index === -1) {
      return false;
    }

    this.locations.splice(index, 1);

    // Also remove from any groups
    for (const group of this.groups) {
      const locIndex = group.locationIds.indexOf(id);
      if (locIndex !== -1) {
        group.locationIds.splice(locIndex, 1);
      }
    }

    await this.saveLocations();
    await this.saveGroups();

    return true;
  }

  // ==========================================================================
  // Group Operations
  // ==========================================================================

  /**
   * Create a new location group.
   */
  async createGroup(name: string, defaultRadiusMeters?: number): Promise<LocationGroup> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const group: LocationGroup = {
      id: generateGroupId(),
      name,
      locationIds: [],
      defaultRadiusMeters: defaultRadiusMeters ?? DEFAULT_RADIUS_METERS,
      createdAt: now,
      updatedAt: now,
    };

    this.groups.push(group);
    await this.saveGroups();

    return group;
  }

  /**
   * Get a group by ID.
   */
  async getGroup(id: string): Promise<LocationGroup | null> {
    await this.ensureLoaded();
    return this.groups.find((g) => g.id === id) || null;
  }

  /**
   * Find a group by name (case-insensitive).
   */
  async findGroupByName(name: string): Promise<LocationGroup | null> {
    await this.ensureLoaded();
    const normalizedName = name.toLowerCase();
    return this.groups.find((g) => g.name.toLowerCase() === normalizedName) || null;
  }

  /**
   * List all location groups.
   */
  async listGroups(): Promise<LocationGroup[]> {
    await this.ensureLoaded();
    return [...this.groups].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Add a location to a group.
   */
  async addToGroup(groupId: string, locationId: string): Promise<boolean> {
    await this.ensureLoaded();

    const group = this.groups.find((g) => g.id === groupId);
    if (!group) {
      return false;
    }

    const location = this.locations.find((l) => l.id === locationId);
    if (!location) {
      return false;
    }

    if (!group.locationIds.includes(locationId)) {
      group.locationIds.push(locationId);
      group.updatedAt = new Date().toISOString();
      await this.saveGroups();
    }

    return true;
  }

  /**
   * Remove a location from a group.
   */
  async removeFromGroup(groupId: string, locationId: string): Promise<boolean> {
    await this.ensureLoaded();

    const group = this.groups.find((g) => g.id === groupId);
    if (!group) {
      return false;
    }

    const index = group.locationIds.indexOf(locationId);
    if (index === -1) {
      return false;
    }

    group.locationIds.splice(index, 1);
    group.updatedAt = new Date().toISOString();
    await this.saveGroups();

    return true;
  }

  /**
   * Get locations in a group.
   */
  async getGroupLocations(groupId: string): Promise<SavedLocation[]> {
    await this.ensureLoaded();

    const group = this.groups.find((g) => g.id === groupId);
    if (!group) {
      return [];
    }

    return this.locations.filter((l) => group.locationIds.includes(l.id));
  }

  /**
   * Delete a group.
   */
  async deleteGroup(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.groups.findIndex((g) => g.id === id);
    if (index === -1) {
      return false;
    }

    this.groups.splice(index, 1);
    await this.saveGroups();

    return true;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Find nearby locations within a radius.
   */
  async findNearby(
    latitude: number,
    longitude: number,
    maxDistanceMeters: number = 1000,
  ): Promise<Array<{ location: SavedLocation; distanceMeters: number }>> {
    await this.ensureLoaded();

    const results: Array<{ location: SavedLocation; distanceMeters: number }> = [];

    for (const location of this.locations) {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        location.latitude,
        location.longitude,
      );

      if (distance <= maxDistanceMeters) {
        results.push({ location, distanceMeters: Math.round(distance) });
      }
    }

    // Sort by distance
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return results;
  }

  /**
   * Calculate distance between two coordinates (Haversine formula).
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
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
 * Callbacks for location events.
 */
export interface LocationEventCallbacks {
  onLocationSaved?: (location: SavedLocation) => void;
  onLocationUpdated?: (location: SavedLocation) => void;
  onLocationDeleted?: (locationId: string) => void;
}

/**
 * Create location management tools for the pendant plugin.
 */
export function createLocationTools(
  locationManager: LocationManager,
  callbacks?: LocationEventCallbacks,
) {
  return [
    // Save location tool
    {
      label: "Save Location",
      name: "location_save",
      description:
        "Save the current location with a name. Requires latitude/longitude from the device.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description: 'Name for the location (e.g., "Home", "Work", "Gym")',
          },
          latitude: {
            type: "number" as const,
            description: "Latitude coordinate",
          },
          longitude: {
            type: "number" as const,
            description: "Longitude coordinate",
          },
          radiusMeters: {
            type: "number" as const,
            description: "Geofence radius in meters (default: 100)",
          },
          address: {
            type: "string" as const,
            description: "Human-readable address (optional)",
          },
          starred: {
            type: "boolean" as const,
            description: "Mark as favorite (default: false)",
          },
        },
        required: ["name", "latitude", "longitude"],
      },
      async execute(
        _toolCallId: string,
        params: {
          name: string;
          latitude: number;
          longitude: number;
          radiusMeters?: number;
          address?: string;
          starred?: boolean;
        },
      ) {
        const location = await locationManager.createLocation(params);

        // Emit event for Android to register geofence
        console.log("[Pendant Event]", {
          location,
        });

        callbacks?.onLocationSaved?.(location);

        return toolResult({
          success: true,
          location: {
            id: location.id,
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            radiusMeters: location.radiusMeters,
            address: location.address,
            starred: location.starred,
          },
          message: `Saved location "${location.name}"`,
        });
      },
    },

    // List locations tool
    {
      label: "List Locations",
      name: "location_list",
      description: "List all saved locations",
      parameters: {
        type: "object" as const,
        properties: {
          starred: {
            type: "boolean" as const,
            description: "Filter to starred/favorite locations only",
          },
          limit: {
            type: "number" as const,
            description: "Maximum number of locations to return",
          },
        },
        required: [],
      },
      async execute(_toolCallId: string, params: { starred?: boolean; limit?: number }) {
        const locations = await locationManager.listLocations(params);

        return toolResult({
          count: locations.length,
          locations: locations.map((l) => ({
            id: l.id,
            name: l.name,
            latitude: l.latitude,
            longitude: l.longitude,
            radiusMeters: l.radiusMeters,
            address: l.address,
            starred: l.starred,
          })),
        });
      },
    },

    // Update location tool
    {
      label: "Update Location",
      name: "location_update",
      description: "Update a saved location's name, radius, or starred status",
      parameters: {
        type: "object" as const,
        properties: {
          locationId: {
            type: "string" as const,
            description: "Location ID to update",
          },
          locationName: {
            type: "string" as const,
            description: "Location name to find and update",
          },
          name: {
            type: "string" as const,
            description: "New name for the location",
          },
          radiusMeters: {
            type: "number" as const,
            description: "New geofence radius in meters",
          },
          starred: {
            type: "boolean" as const,
            description: "New starred status",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          locationId?: string;
          locationName?: string;
          name?: string;
          radiusMeters?: number;
          starred?: boolean;
        },
      ) {
        if (!params.locationId && !params.locationName) {
          return toolResult({
            success: false,
            error: "At least one identifier required: locationId or locationName",
          });
        }

        let location: SavedLocation | null = null;

        if (params.locationId) {
          location = await locationManager.getLocation(params.locationId);
        } else if (params.locationName) {
          location = await locationManager.findLocationByName(params.locationName);
        }

        if (!location) {
          return toolResult({
            success: false,
            error: "Location not found",
          });
        }

        const updated = await locationManager.updateLocation(location.id, {
          name: params.name,
          radiusMeters: params.radiusMeters,
          starred: params.starred,
        });

        if (!updated) {
          return toolResult({
            success: false,
            error: "Failed to update location",
          });
        }

        // Emit event for Android to update geofence
        console.log("[Pendant Event]", {
          location: updated,
        });

        callbacks?.onLocationUpdated?.(updated);

        return toolResult({
          success: true,
          location: {
            id: updated.id,
            name: updated.name,
            radiusMeters: updated.radiusMeters,
            starred: updated.starred,
          },
          message: `Updated location "${updated.name}"`,
        });
      },
    },

    // Delete location tool
    {
      label: "Delete Location",
      name: "location_delete",
      description: "Delete a saved location",
      parameters: {
        type: "object" as const,
        properties: {
          locationId: {
            type: "string" as const,
            description: "Location ID to delete",
          },
          locationName: {
            type: "string" as const,
            description: "Location name to find and delete",
          },
        },
        required: [],
      },
      async execute(_toolCallId: string, params: { locationId?: string; locationName?: string }) {
        if (!params.locationId && !params.locationName) {
          return toolResult({
            success: false,
            error: "At least one identifier required: locationId or locationName",
          });
        }

        let location: SavedLocation | null = null;

        if (params.locationId) {
          location = await locationManager.getLocation(params.locationId);
        } else if (params.locationName) {
          location = await locationManager.findLocationByName(params.locationName);
        }

        if (!location) {
          return toolResult({
            success: false,
            error: "Location not found",
          });
        }

        const deletedId = location.id;
        const deletedName = location.name;

        await locationManager.deleteLocation(deletedId);

        // Emit event for Android to remove geofence
        console.log("[Pendant Event]", {
          locationId: deletedId,
        });

        callbacks?.onLocationDeleted?.(deletedId);

        return toolResult({
          success: true,
          message: `Deleted location "${deletedName}"`,
        });
      },
    },

    // Create group tool
    {
      label: "Create Location Group",
      name: "location_group_create",
      description: "Create a new location group (e.g., Grocery Stores, Offices)",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description: 'Name for the group (e.g., "Grocery Stores")',
          },
          defaultRadiusMeters: {
            type: "number" as const,
            description: "Default radius for locations in this group",
          },
        },
        required: ["name"],
      },
      async execute(_toolCallId: string, params: { name: string; defaultRadiusMeters?: number }) {
        const group = await locationManager.createGroup(params.name, params.defaultRadiusMeters);

        return toolResult({
          success: true,
          group: {
            id: group.id,
            name: group.name,
            defaultRadiusMeters: group.defaultRadiusMeters,
            locationCount: 0,
          },
          message: `Created location group "${group.name}"`,
        });
      },
    },

    // Add to group tool
    {
      label: "Add Location to Group",
      name: "location_group_add",
      description: "Add a location to a group",
      parameters: {
        type: "object" as const,
        properties: {
          groupId: {
            type: "string" as const,
            description: "Group ID",
          },
          groupName: {
            type: "string" as const,
            description: "Group name to find",
          },
          locationId: {
            type: "string" as const,
            description: "Location ID to add",
          },
          locationName: {
            type: "string" as const,
            description: "Location name to find and add",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          groupId?: string;
          groupName?: string;
          locationId?: string;
          locationName?: string;
        },
      ) {
        let group: LocationGroup | null = null;
        let location: SavedLocation | null = null;

        if (params.groupId) {
          group = await locationManager.getGroup(params.groupId);
        } else if (params.groupName) {
          group = await locationManager.findGroupByName(params.groupName);
        }

        if (!group) {
          return toolResult({
            success: false,
            error: "Group not found",
          });
        }

        if (params.locationId) {
          location = await locationManager.getLocation(params.locationId);
        } else if (params.locationName) {
          location = await locationManager.findLocationByName(params.locationName);
        }

        if (!location) {
          return toolResult({
            success: false,
            error: "Location not found",
          });
        }

        await locationManager.addToGroup(group.id, location.id);

        return toolResult({
          success: true,
          message: `Added "${location.name}" to group "${group.name}"`,
        });
      },
    },

    // Remove from group tool
    {
      label: "Remove Location from Group",
      name: "location_group_remove",
      description: "Remove a location from a group",
      parameters: {
        type: "object" as const,
        properties: {
          groupId: {
            type: "string" as const,
            description: "Group ID",
          },
          groupName: {
            type: "string" as const,
            description: "Group name to find",
          },
          locationId: {
            type: "string" as const,
            description: "Location ID to remove",
          },
          locationName: {
            type: "string" as const,
            description: "Location name to find and remove",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          groupId?: string;
          groupName?: string;
          locationId?: string;
          locationName?: string;
        },
      ) {
        let group: LocationGroup | null = null;
        let location: SavedLocation | null = null;

        if (params.groupId) {
          group = await locationManager.getGroup(params.groupId);
        } else if (params.groupName) {
          group = await locationManager.findGroupByName(params.groupName);
        }

        if (!group) {
          return toolResult({
            success: false,
            error: "Group not found",
          });
        }

        if (params.locationId) {
          location = await locationManager.getLocation(params.locationId);
        } else if (params.locationName) {
          location = await locationManager.findLocationByName(params.locationName);
        }

        if (!location) {
          return toolResult({
            success: false,
            error: "Location not found",
          });
        }

        await locationManager.removeFromGroup(group.id, location.id);

        return toolResult({
          success: true,
          message: `Removed "${location.name}" from group "${group.name}"`,
        });
      },
    },

    // List groups tool
    {
      label: "List Location Groups",
      name: "location_group_list",
      description: "List all location groups with their locations",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute(_toolCallId: string) {
        const groups = await locationManager.listGroups();
        const groupsWithLocations = await Promise.all(
          groups.map(async (g) => {
            const locations = await locationManager.getGroupLocations(g.id);
            return {
              id: g.id,
              name: g.name,
              defaultRadiusMeters: g.defaultRadiusMeters,
              locationCount: locations.length,
              locations: locations.map((l) => ({
                id: l.id,
                name: l.name,
              })),
            };
          }),
        );

        return toolResult({
          count: groups.length,
          groups: groupsWithLocations,
        });
      },
    },
  ];
}
