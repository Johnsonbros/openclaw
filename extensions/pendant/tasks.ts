/**
 * Task management for pendant voice commands.
 *
 * Handles creation, listing, completion, and deletion of tasks from voice input.
 * Supports both time-based and location-based triggers.
 */

import type { PendantStorage } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Location trigger for location-based reminders.
 */
export interface LocationTrigger {
  locationId?: string; // Specific saved location
  groupId?: string; // Or any location in a group
  personLocationTag?: string; // Person + tag like "john:home"
  triggerOn: "enter" | "exit" | "both";
}

/**
 * A task or reminder.
 */
export interface Task {
  id: string;
  text: string;
  createdAt: string;
  dueAt?: string; // ISO datetime for time-based reminders
  locationTrigger?: LocationTrigger;
  speakerId?: string; // Voice profile ID of creator
  speakerName?: string; // Name of creator if known
  completed: boolean;
  completedAt?: string;
  triggered: boolean; // Has location trigger fired?
  triggeredAt?: string;
  source: "pendant" | "chat";
  metadata?: Record<string, unknown>;
}

/**
 * Task creation parameters.
 */
export interface CreateTaskParams {
  text: string;
  dueAt?: string;
  locationTrigger?: LocationTrigger;
  speakerId?: string;
  speakerName?: string;
  source?: "pendant" | "chat";
  metadata?: Record<string, unknown>;
}

/**
 * Task list filter options.
 */
export interface TaskListOptions {
  includeCompleted?: boolean;
  includeTriggered?: boolean;
  speakerId?: string;
  source?: "pendant" | "chat";
  limit?: number;
}

// ============================================================================
// Storage
// ============================================================================

const TASKS_KEY = "pendant:tasks";

/**
 * Load tasks from storage.
 */
async function loadTasks(storage: PendantStorage): Promise<Task[]> {
  try {
    const stored = await storage.get(TASKS_KEY);
    if (stored) {
      return JSON.parse(stored) as Task[];
    }
  } catch (e) {
    console.error("[Tasks] Failed to load tasks:", e);
  }
  return [];
}

/**
 * Save tasks to storage.
 */
async function saveTasks(storage: PendantStorage, tasks: Task[]): Promise<void> {
  try {
    await storage.set(TASKS_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error("[Tasks] Failed to save tasks:", e);
  }
}

/**
 * Generate a unique task ID.
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Task Operations
// ============================================================================

/**
 * Task manager class.
 */
export class TaskManager {
  private storage: PendantStorage;
  private tasks: Task[] = [];
  private loaded = false;

  constructor(storage: PendantStorage) {
    this.storage = storage;
  }

  /**
   * Ensure tasks are loaded from storage.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.tasks = await loadTasks(this.storage);
      this.loaded = true;
    }
  }

  /**
   * Save current tasks to storage.
   */
  private async save(): Promise<void> {
    await saveTasks(this.storage, this.tasks);
  }

  /**
   * Create a new task.
   */
  async createTask(params: CreateTaskParams): Promise<Task> {
    await this.ensureLoaded();

    const task: Task = {
      id: generateTaskId(),
      text: params.text,
      createdAt: new Date().toISOString(),
      dueAt: params.dueAt,
      locationTrigger: params.locationTrigger,
      speakerId: params.speakerId,
      speakerName: params.speakerName,
      completed: false,
      triggered: false,
      source: params.source || "pendant",
      metadata: params.metadata,
    };

    this.tasks.push(task);
    await this.save();

    return task;
  }

  /**
   * List tasks with optional filtering.
   */
  async listTasks(options: TaskListOptions = {}): Promise<Task[]> {
    await this.ensureLoaded();

    let filtered = this.tasks.filter((task) => {
      // Filter by completion status
      if (!options.includeCompleted && task.completed) {
        return false;
      }

      // Filter by trigger status (for location-based tasks)
      if (!options.includeTriggered && task.triggered && task.locationTrigger) {
        return false;
      }

      // Filter by speaker
      if (options.speakerId && task.speakerId !== options.speakerId) {
        return false;
      }

      // Filter by source
      if (options.source && task.source !== options.source) {
        return false;
      }

      return true;
    });

    // Sort by creation date (newest first)
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply limit
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Get a task by ID.
   */
  async getTask(id: string): Promise<Task | null> {
    await this.ensureLoaded();
    return this.tasks.find((t) => t.id === id) || null;
  }

  /**
   * Get a task by position (1-indexed, -1 for last).
   */
  async getTaskByPosition(position: number): Promise<Task | null> {
    await this.ensureLoaded();

    const pending = this.tasks
      .filter((t) => !t.completed)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (position === -1) {
      return pending[pending.length - 1] || null;
    }

    const index = position - 1;
    if (index >= 0 && index < pending.length) {
      return pending[index];
    }

    return null;
  }

  /**
   * Find a task by text match.
   */
  async findTaskByText(searchText: string): Promise<Task | null> {
    await this.ensureLoaded();

    const normalizedSearch = searchText.toLowerCase();

    // First try exact match
    const exact = this.tasks.find((t) => !t.completed && t.text.toLowerCase() === normalizedSearch);
    if (exact) return exact;

    // Then try includes
    const partial = this.tasks.find(
      (t) => !t.completed && t.text.toLowerCase().includes(normalizedSearch),
    );
    if (partial) return partial;

    // Finally try word match
    const words = normalizedSearch.split(/\s+/);
    const wordMatch = this.tasks.find(
      (t) => !t.completed && words.some((word) => t.text.toLowerCase().includes(word)),
    );

    return wordMatch || null;
  }

  /**
   * Complete a task.
   */
  async completeTask(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const task = this.tasks.find((t) => t.id === id);
    if (!task) {
      return false;
    }

    task.completed = true;
    task.completedAt = new Date().toISOString();
    await this.save();

    return true;
  }

  /**
   * Mark a task as triggered (for location-based tasks).
   */
  async markTriggered(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const task = this.tasks.find((t) => t.id === id);
    if (!task) {
      return false;
    }

    task.triggered = true;
    task.triggeredAt = new Date().toISOString();
    await this.save();

    return true;
  }

  /**
   * Delete a task.
   */
  async deleteTask(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      return false;
    }

    this.tasks.splice(index, 1);
    await this.save();

    return true;
  }

  /**
   * Get tasks for a specific location trigger.
   *
   * @param locationId - Specific location ID that triggered
   * @param groupId - Location group ID that triggered
   * @param triggerType - Whether this is an enter or exit trigger
   * @param personLocationTag - Person location tag (e.g., "person_123:home")
   * @returns Tasks matching the location trigger
   */
  async getTasksForLocation(
    locationId?: string,
    groupId?: string,
    triggerType?: "enter" | "exit",
    personLocationTag?: string,
  ): Promise<Task[]> {
    await this.ensureLoaded();

    return this.tasks.filter((task) => {
      if (task.completed || task.triggered || !task.locationTrigger) {
        return false;
      }

      const trigger = task.locationTrigger;

      // Check if trigger type matches
      const triggerMatches =
        !triggerType || trigger.triggerOn === triggerType || trigger.triggerOn === "both";

      if (!triggerMatches) {
        return false;
      }

      // Match by location ID
      if (locationId && trigger.locationId === locationId) {
        return true;
      }

      // Match by group ID
      if (groupId && trigger.groupId === groupId) {
        return true;
      }

      // Match by person location tag (e.g., "person_123:home")
      if (personLocationTag && trigger.personLocationTag === personLocationTag) {
        return true;
      }

      return false;
    });
  }

  /**
   * Get tasks due within a time range.
   */
  async getTasksDueInRange(startTime: Date, endTime: Date): Promise<Task[]> {
    await this.ensureLoaded();

    return this.tasks.filter((task) => {
      if (task.completed || !task.dueAt) {
        return false;
      }

      const dueTime = new Date(task.dueAt);
      return dueTime >= startTime && dueTime <= endTime;
    });
  }

  /**
   * Get count of pending tasks.
   */
  async getPendingCount(): Promise<number> {
    await this.ensureLoaded();
    return this.tasks.filter((t) => !t.completed).length;
  }

  /**
   * Clear all completed tasks.
   */
  async clearCompleted(): Promise<number> {
    await this.ensureLoaded();

    const initialCount = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !t.completed);
    const removedCount = initialCount - this.tasks.length;

    if (removedCount > 0) {
      await this.save();
    }

    return removedCount;
  }
}

// ============================================================================
// Tool Result Helper
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

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create task management tools for the pendant plugin.
 *
 * @param taskManager - The task manager instance
 * @param onTaskCreated - Optional callback when a task with location trigger is created
 */
export function createTaskTools(taskManager: TaskManager, onTaskCreated?: (task: Task) => void) {
  return [
    // Create task tool
    {
      label: "Create Task",
      name: "pendant_task_create",
      description:
        "Create a task or reminder from pendant voice input. Supports time-based and location-based triggers.",
      parameters: {
        type: "object" as const,
        properties: {
          text: {
            type: "string" as const,
            description: "The task description (what to remind about)",
          },
          dueAt: {
            type: "string" as const,
            description: "ISO datetime for time-based reminder (optional)",
          },
          locationId: {
            type: "string" as const,
            description: "Saved location ID for location-based trigger (optional)",
          },
          groupId: {
            type: "string" as const,
            description: "Location group ID for location-based trigger (optional)",
          },
          personLocationTag: {
            type: "string" as const,
            description:
              'Person location tag like "john:home" for person-based location triggers (optional)',
          },
          triggerOn: {
            type: "string" as const,
            enum: ["enter", "exit", "both"],
            description: "When to trigger: on entering, exiting, or both",
          },
          speakerId: {
            type: "string" as const,
            description: "Voice profile ID of the creator (optional)",
          },
          speakerName: {
            type: "string" as const,
            description: "Name of the creator (optional)",
          },
        },
        required: ["text"],
      },
      async execute(
        _toolCallId: string,
        params: {
          text: string;
          dueAt?: string;
          locationId?: string;
          groupId?: string;
          personLocationTag?: string;
          triggerOn?: "enter" | "exit" | "both";
          speakerId?: string;
          speakerName?: string;
        },
      ) {
        let locationTrigger: LocationTrigger | undefined;

        if (params.locationId || params.groupId || params.personLocationTag) {
          locationTrigger = {
            locationId: params.locationId,
            groupId: params.groupId,
            personLocationTag: params.personLocationTag,
            triggerOn: params.triggerOn || "enter",
          };
        }

        const task = await taskManager.createTask({
          text: params.text,
          dueAt: params.dueAt,
          locationTrigger,
          speakerId: params.speakerId,
          speakerName: params.speakerName,
          source: "pendant",
        });

        // Notify callback for task creation (for Android to register geofence)
        if (locationTrigger && onTaskCreated) {
          onTaskCreated(task);
        }

        return toolResult({
          success: true,
          task: {
            id: task.id,
            text: task.text,
            createdAt: task.createdAt,
            dueAt: task.dueAt,
            hasLocationTrigger: !!task.locationTrigger,
            locationTrigger: task.locationTrigger,
          },
          message: locationTrigger
            ? `Task created with location trigger: "${params.text}"`
            : params.dueAt
              ? `Reminder set for ${params.dueAt}: "${params.text}"`
              : `Task added: "${params.text}"`,
        });
      },
    },

    // List tasks tool
    {
      label: "List Tasks",
      name: "pendant_task_list",
      description: "List pending tasks and reminders",
      parameters: {
        type: "object" as const,
        properties: {
          includeCompleted: {
            type: "boolean" as const,
            description: "Include completed tasks",
          },
          speakerId: {
            type: "string" as const,
            description: "Filter by creator's voice profile ID",
          },
          limit: {
            type: "number" as const,
            description: "Maximum number of tasks to return",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          includeCompleted?: boolean;
          speakerId?: string;
          limit?: number;
        },
      ) {
        const tasks = await taskManager.listTasks({
          includeCompleted: params.includeCompleted,
          speakerId: params.speakerId,
          limit: params.limit,
        });

        const pendingCount = await taskManager.getPendingCount();

        return toolResult({
          count: tasks.length,
          pendingCount,
          tasks: tasks.map((t, index) => ({
            position: index + 1,
            id: t.id,
            text: t.text,
            createdAt: t.createdAt,
            dueAt: t.dueAt,
            hasLocationTrigger: !!t.locationTrigger,
            locationTrigger: t.locationTrigger,
            completed: t.completed,
            completedAt: t.completedAt,
            createdBy: t.speakerName || t.speakerId,
          })),
        });
      },
    },

    // Complete task tool
    {
      label: "Complete Task",
      name: "pendant_task_complete",
      description:
        "Mark a task as completed. Can identify task by ID, position (1st, 2nd, last), or text match.",
      parameters: {
        type: "object" as const,
        properties: {
          taskId: {
            type: "string" as const,
            description: "Task ID to complete",
          },
          position: {
            type: "number" as const,
            description: "Position in list (1 for first, -1 for last)",
          },
          searchText: {
            type: "string" as const,
            description: "Text to search for in task description",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          taskId?: string;
          position?: number;
          searchText?: string;
        },
      ) {
        if (!params.taskId && params.position === undefined && !params.searchText) {
          return toolResult({
            success: false,
            error: "At least one identifier required: taskId, position, or searchText",
          });
        }

        let task: Task | null = null;

        if (params.taskId) {
          task = await taskManager.getTask(params.taskId);
        } else if (params.position !== undefined) {
          task = await taskManager.getTaskByPosition(params.position);
        } else if (params.searchText) {
          task = await taskManager.findTaskByText(params.searchText);
        }

        if (!task) {
          return toolResult({
            success: false,
            error: "Task not found",
          });
        }

        if (task.completed) {
          return toolResult({
            success: false,
            error: "Task is already completed",
            task: {
              id: task.id,
              text: task.text,
              completedAt: task.completedAt,
            },
          });
        }

        await taskManager.completeTask(task.id);

        return toolResult({
          success: true,
          message: `Completed: "${task.text}"`,
          task: {
            id: task.id,
            text: task.text,
            completedAt: new Date().toISOString(),
          },
        });
      },
    },

    // Delete task tool
    {
      label: "Delete Task",
      name: "pendant_task_delete",
      description: "Delete a task. Can identify by ID, position, or text match.",
      parameters: {
        type: "object" as const,
        properties: {
          taskId: {
            type: "string" as const,
            description: "Task ID to delete",
          },
          position: {
            type: "number" as const,
            description: "Position in list (1 for first, -1 for last)",
          },
          searchText: {
            type: "string" as const,
            description: "Text to search for in task description",
          },
        },
        required: [],
      },
      async execute(
        _toolCallId: string,
        params: {
          taskId?: string;
          position?: number;
          searchText?: string;
        },
      ) {
        if (!params.taskId && params.position === undefined && !params.searchText) {
          return toolResult({
            success: false,
            error: "At least one identifier required: taskId, position, or searchText",
          });
        }

        let task: Task | null = null;

        if (params.taskId) {
          task = await taskManager.getTask(params.taskId);
        } else if (params.position !== undefined) {
          task = await taskManager.getTaskByPosition(params.position);
        } else if (params.searchText) {
          task = await taskManager.findTaskByText(params.searchText);
        }

        if (!task) {
          return toolResult({
            success: false,
            error: "Task not found",
          });
        }

        await taskManager.deleteTask(task.id);

        return toolResult({
          success: true,
          message: `Deleted: "${task.text}"`,
          deletedTask: {
            id: task.id,
            text: task.text,
          },
        });
      },
    },

    // Clear completed tasks
    {
      label: "Clear Completed Tasks",
      name: "pendant_task_clear_completed",
      description: "Remove all completed tasks from the list",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute(_toolCallId: string) {
        const removedCount = await taskManager.clearCompleted();

        return toolResult({
          success: true,
          removedCount,
          message:
            removedCount > 0
              ? `Cleared ${removedCount} completed task${removedCount === 1 ? "" : "s"}`
              : "No completed tasks to clear",
        });
      },
    },
  ];
}

/**
 * Format tasks as a readable list.
 */
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "No tasks on your list.";
  }

  const lines = tasks.map((task, index) => {
    const prefix = task.completed ? "✓" : `${index + 1}.`;
    let line = `${prefix} ${task.text}`;

    if (task.dueAt) {
      const due = new Date(task.dueAt);
      line += ` (due ${due.toLocaleString()})`;
    }

    if (task.locationTrigger) {
      const trigger = task.locationTrigger.triggerOn === "exit" ? "leaving" : "arriving";
      line += ` (when ${trigger})`;
    }

    if (task.speakerName) {
      line += ` - by ${task.speakerName}`;
    }

    return line;
  });

  return lines.join("\n");
}
