/**
 * Intent classifier for pendant voice commands.
 *
 * Supports both regex-based fast-path classification for simple commands and
 * LLM-based classification for complex/compound intents with conversational
 * context awareness.
 *
 * Architecture:
 * - classifyIntent()       — Regex fast-path for single transcript lines (legacy)
 * - classifyWithLLM()      — LLM-based extraction from transcript windows
 * - classifyTranscript()   — Smart router: regex fast-path -> LLM fallback
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Types
// ============================================================================

/**
 * Recognized intent types.
 */
export type IntentType =
  | "task_create" // "remind me", "add to my list"
  | "task_create_location" // "remind me when I get to work"
  | "task_list" // "what's on my list", "show my tasks"
  | "task_complete" // "mark X as done", "complete X"
  | "location_save" // "save this location as home"
  | "location_group" // "add this to my grocery stores"
  | "person_location_set" // "John's home is at..."
  | "person_location_query" // "where does John live?"
  | "person_location_add" // Add a location tag to a person's profile
  | "person_profile_update" // Update metadata on a person's profile
  | "memory_save" // "remember this", "note that"
  | "default"; // Regular conversation

/**
 * Location trigger specification for location-based tasks.
 */
export interface LocationTrigger {
  locationName?: string; // "work", "home", "gym"
  groupName?: string; // "grocery stores"
  personName?: string; // For "near John's house"
  triggerOn: "enter" | "exit" | "both";
}

/**
 * Person location specification.
 */
export interface PersonLocationSpec {
  personName: string;
  locationType: string; // "home", "work", "favorite_coffee"
  locationValue?: string; // Address or description
}

/**
 * Result of intent classification (single intent).
 */
export interface ClassifiedIntent {
  type: IntentType;
  confidence: number; // 0-1 confidence score
  extractedText?: string; // The actual task/note content
  dueTime?: string; // Parsed time for reminders
  locationTrigger?: LocationTrigger;
  personLocation?: PersonLocationSpec;
  taskIdentifier?: string; // For task_complete: which task to complete
  rawTranscript: string; // Original transcript
  params?: Record<string, unknown>; // Arbitrary structured params from LLM
}

/**
 * Compound intent result -- multiple intents extracted from a transcript window.
 */
export interface CompoundIntent {
  intents: ClassifiedIntent[];
  contextNotes?: string;
  conversationSummary?: string;
}

/**
 * A single transcript entry in the sliding window.
 */
export interface TranscriptEntry {
  text: string;
  speakerId?: string;
  speakerName?: string;
  timestamp: string;
}

/**
 * Sliding window of recent transcript entries with optional location context.
 */
export interface TranscriptWindow {
  entries: TranscriptEntry[];
  currentLocation?: { latitude: number; longitude: number };
}

/**
 * Configuration for the classification pipeline.
 */
export interface ClassifyConfig {
  /** Minimum confidence to include an intent (default: 0.5) */
  confidenceThreshold?: number;
  /** Always use LLM even for simple commands (default: false) */
  useLLMAlways?: boolean;
  /** Model to use for LLM classification (default: auto-resolved) */
  model?: string;
}

/**
 * Pattern definition with extraction groups (for regex fast-path).
 */
interface IntentPattern {
  regex: RegExp;
  type: IntentType;
  baseConfidence: number;
  extractContent?: (match: RegExpMatchArray, transcript: string) => Partial<ClassifiedIntent>;
}

// ============================================================================
// Intent Type Registry (shared between regex and LLM paths)
// ============================================================================

/**
 * Schema description of each intent type, provided to the LLM so it knows
 * what structured output to produce.
 */
const INTENT_TYPE_SCHEMA: Record<string, { description: string; params: string }> = {
  task_create: {
    description: "Create a new task or reminder",
    params: '{ "text": "string -- the task description", "dueTime?": "string -- time expression" }',
  },
  task_create_location: {
    description: "Create a task triggered by arriving/leaving a location",
    params:
      '{ "text": "string", "locationName?": "string", "groupName?": "string", "personName?": "string", "triggerOn": "enter | exit" }',
  },
  task_list: {
    description: "List current tasks/reminders",
    params: "{}",
  },
  task_complete: {
    description: "Mark a task as done",
    params: '{ "taskIdentifier": "string -- ordinal like #1 or description" }',
  },
  location_save: {
    description: "Save the current GPS location with a name/label",
    params: '{ "name": "string -- label for the location", "useCurrentLocation": "boolean" }',
  },
  location_group: {
    description: "Add current location to a named group",
    params: '{ "groupName": "string" }',
  },
  person_location_set: {
    description: "Set a known address/location for a person",
    params:
      '{ "personName": "string", "locationType": "home | work | string", "locationValue?": "string -- address or description" }',
  },
  person_location_query: {
    description: "Ask where a person lives/works",
    params: '{ "personName": "string", "locationType": "home | work | string" }',
  },
  person_location_add: {
    description: "Tag a location to a person profile (e.g. mark current location as John\'s home)",
    params:
      '{ "personName": "string", "tag": "string -- home, work, etc.", "useCurrentLocation?": "boolean", "locationValue?": "string" }',
  },
  person_profile_update: {
    description: "Update metadata on a person\'s profile from conversational context",
    params:
      '{ "personName": "string", "speakerId?": "string", "metadata": "object -- key/value pairs extracted from conversation" }',
  },
  memory_save: {
    description: "Save a note or memory",
    params: '{ "text": "string -- what to remember" }',
  },
};

// ============================================================================
// Regex Fast-Path Patterns
// ============================================================================

const TASK_CREATE_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:remind me|reminder)\s+(?:to\s+)?(.+?)(?:\s+(?:at|on|by|tomorrow|tonight|later|today).*)?$/i,
    type: "task_create",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:don't forget|do not forget)\s+(?:to\s+)?(.+)$/i,
    type: "task_create",
    baseConfidence: 0.85,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?(?:list|tasks?|todo|to-do)/i,
    type: "task_create",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:create|make)\s+(?:a\s+)?(?:task|reminder)\s+(?:to\s+)?(.+)$/i,
    type: "task_create",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:note to self|mental note)\s*[:\-]?\s*(.+)$/i,
    type: "task_create",
    baseConfidence: 0.8,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex:
      /\b(?:i need to|i should|i have to|i must|i gotta)\s+(.+?)(?:\s+(?:tomorrow|today|later|soon|tonight).*)?$/i,
    type: "task_create",
    baseConfidence: 0.7,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
];

const LOCATION_TASK_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:remind me|alert me)\s+(?:to\s+)?(.+?)\s+(?:when|once)\s+(?:i|we)\s+(?:get to|arrive at|reach|am at|'m at)\s+(.+)/i,
    type: "task_create_location",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
      locationTrigger: {
        locationName: match[2]?.trim().toLowerCase(),
        triggerOn: "enter" as const,
      },
    }),
  },
  {
    regex:
      /\b(?:remind me|alert me)\s+(?:to\s+)?(.+?)\s+(?:when|once)\s+(?:i|we)\s+(?:leave|exit|depart from)\s+(.+)/i,
    type: "task_create_location",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
      locationTrigger: { locationName: match[2]?.trim().toLowerCase(), triggerOn: "exit" as const },
    }),
  },
  {
    regex:
      /\b(?:when|once)\s+(?:i|we)\s+(?:get to|arrive at|reach|am at|'m at)\s+(.+?)\s*[,]?\s*(?:remind me|alert me)\s+(?:to\s+)?(.+)/i,
    type: "task_create_location",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[2]?.trim(),
      locationTrigger: {
        locationName: match[1]?.trim().toLowerCase(),
        triggerOn: "enter" as const,
      },
    }),
  },
  {
    regex:
      /\b(?:when|once)\s+(?:i|we)\s+(?:leave|exit)\s+(.+?)\s*[,]?\s*(?:remind me|alert me)\s+(?:to\s+)?(.+)/i,
    type: "task_create_location",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[2]?.trim(),
      locationTrigger: { locationName: match[1]?.trim().toLowerCase(), triggerOn: "exit" as const },
    }),
  },
  {
    regex:
      /\b(?:remind me|alert me)\s+(?:to\s+)?(.+?)\s+(?:when|once)\s+(?:i'm|i am|we're|we are)\s+(?:near|close to|at)\s+(.+?)(?:'s|s)?\s+(?:house|home|place|work|office)/i,
    type: "task_create_location",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
      locationTrigger: { personName: match[2]?.trim(), triggerOn: "enter" as const },
    }),
  },
  {
    regex:
      /\b(?:remind me|alert me)\s+(?:to\s+)?(.+?)\s+(?:when|once)\s+(?:i'm|i am|we're|we are)\s+(?:near|at)\s+(?:any\s+)?(.+)/i,
    type: "task_create_location",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
      locationTrigger: { groupName: match[2]?.trim().toLowerCase(), triggerOn: "enter" as const },
    }),
  },
];

const TASK_LIST_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:what's|whats|what is)\s+(?:on\s+)?(?:my\s+)?(?:list|tasks?|todo|to-do|reminders?)/i,
    type: "task_list",
    baseConfidence: 0.95,
  },
  {
    regex:
      /\b(?:show|list|display|read)\s+(?:me\s+)?(?:my\s+)?(?:list|tasks?|todo|to-do|reminders?)/i,
    type: "task_list",
    baseConfidence: 0.95,
  },
  {
    regex: /\b(?:do i have|are there)\s+(?:any\s+)?(?:tasks?|reminders?|todos?)/i,
    type: "task_list",
    baseConfidence: 0.9,
  },
  {
    regex: /\b(?:what|anything)\s+(?:do i need|should i)\s+(?:to\s+)?(?:do|remember)/i,
    type: "task_list",
    baseConfidence: 0.85,
  },
];

const TASK_COMPLETE_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:mark|set)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?|last)\s+(?:task|reminder|item)\s+(?:as\s+)?(?:done|complete|completed|finished)/i,
    type: "task_complete",
    baseConfidence: 0.95,
    extractContent: (match, transcript) => ({
      taskIdentifier: extractTaskIdentifier(transcript),
    }),
  },
  {
    regex:
      /\b(?:complete|finish|done with)\s+(?:the\s+)?(?:task|reminder)\s+(?:about|for|to)\s+(.+)/i,
    type: "task_complete",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      taskIdentifier: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:i\s+)?(?:did|finished|completed|done)\s+(?:the\s+)?(.+?)\s+(?:task|reminder)/i,
    type: "task_complete",
    baseConfidence: 0.85,
    extractContent: (match) => ({
      taskIdentifier: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:check off|cross off|remove)\s+(.+?)\s+(?:from\s+)?(?:my\s+)?(?:list|tasks?)/i,
    type: "task_complete",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      taskIdentifier: match[1]?.trim(),
    }),
  },
];

const LOCATION_SAVE_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:save|mark|star)\s+(?:this|current|my current)\s+(?:location|place|position)\s+(?:as\s+)?(.+)/i,
    type: "location_save",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:this|here)\s+is\s+(?:my\s+)?(.+?)(?:\s+location|\s+place)?$/i,
    type: "location_save",
    baseConfidence: 0.85,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:call|name)\s+(?:this|here|this place|this location)\s+(.+)/i,
    type: "location_save",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:set|make)\s+(?:this|here)\s+(?:as\s+)?(?:my\s+)?(.+)/i,
    type: "location_save",
    baseConfidence: 0.85,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
];

const LOCATION_GROUP_PATTERNS: IntentPattern[] = [
  {
    regex:
      /\b(?:add|put)\s+(?:this|here|this place|this location)\s+(?:to|in)\s+(?:my\s+)?(.+?)(?:\s+group|\s+list)?$/i,
    type: "location_group",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:create|make)\s+(?:a\s+)?(?:location\s+)?group\s+(?:called|named)\s+(.+)/i,
    type: "location_group",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
];

const PERSON_LOCATION_SET_PATTERNS: IntentPattern[] = [
  {
    regex: /\b([A-Za-z]+)(?:'s|s)\s+(home|house|work|office|place)\s+is\s+(?:at\s+)?(.+)/i,
    type: "person_location_set",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: match[2].toLowerCase(),
        locationValue: match[3]?.trim(),
      },
    }),
  },
  {
    regex: /\b([A-Za-z]+)\s+(?:lives|works|stays)\s+(?:at|in|on)\s+(.+)/i,
    type: "person_location_set",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: match[0].toLowerCase().includes("works") ? "work" : "home",
        locationValue: match[2]?.trim(),
      },
    }),
  },
  {
    regex: /\b([A-Za-z]+)(?:'s|s)\s+(?:favorite|fav)\s+(.+?)\s+is\s+(.+)/i,
    type: "person_location_set",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: `favorite_${match[2].toLowerCase().replace(/\s+/g, "_")}`,
        locationValue: match[3]?.trim(),
      },
    }),
  },
  {
    regex: /\b(?:set|save)\s+([A-Za-z]+)(?:'s|s)\s+(home|work|office|place)\s+(?:as|to)\s+(.+)/i,
    type: "person_location_set",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: match[2].toLowerCase(),
        locationValue: match[3]?.trim(),
      },
    }),
  },
];

const PERSON_LOCATION_QUERY_PATTERNS: IntentPattern[] = [
  {
    regex: /\b(?:where)\s+(?:does|is)\s+([A-Za-z]+)\s+(?:live|work|stay)/i,
    type: "person_location_query",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: match[0].toLowerCase().includes("work") ? "work" : "home",
      },
    }),
  },
  {
    regex: /\b(?:what(?:'s|s)?|what is)\s+([A-Za-z]+)(?:'s|s)?\s+(?:address|location|home|work)/i,
    type: "person_location_query",
    baseConfidence: 0.95,
    extractContent: (match) => ({
      personLocation: {
        personName: capitalizeFirstLetter(match[1]),
        locationType: match[0].toLowerCase().includes("work") ? "work" : "home",
      },
    }),
  },
];

const MEMORY_SAVE_PATTERNS: IntentPattern[] = [
  {
    regex: /\b(?:remember\s+(?:this|that)|note that|save this|keep in mind)\s*[:\-]?\s*(.+)?$/i,
    type: "memory_save",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:make a note|take a note)\s*[:\-]?\s*(.+)?$/i,
    type: "memory_save",
    baseConfidence: 0.9,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
  {
    regex: /\b(?:important)\s*[:\-]?\s*(.+)$/i,
    type: "memory_save",
    baseConfidence: 0.7,
    extractContent: (match) => ({
      extractedText: match[1]?.trim(),
    }),
  },
];

// ============================================================================
// Complexity Detection -- decides regex vs LLM path
// ============================================================================

/**
 * Heuristics to detect if a transcript line likely needs LLM classification.
 * Returns true if the utterance appears compound, ambiguous, or context-dependent.
 */
function looksComplex(text: string): boolean {
  const normalized = text.toLowerCase().trim();

  // Compound commands joined by "and", "then", "also", "plus"
  if (
    /\b(?:and\s+(?:also\s+)?(?:then\s+)?|then\s+|also\s+|plus\s+)(?:update|save|mark|add|set|create|remind|note|remember|put|show|send)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // References to pronouns that require context resolution
  if (
    /\b(?:this house|this place|his|her|their|that person|that guy|that address)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // Multiple action verbs in a single utterance
  const actionVerbs = normalized.match(
    /\b(?:mark|save|update|add|set|create|remind|note|remember|put|send|show|list|complete|finish|delete|remove)\b/gi,
  );
  if (actionVerbs && actionVerbs.length >= 2) {
    return true;
  }

  // Conversational references that need diarization context
  if (
    /\b(?:what (?:he|she|they) (?:said|mentioned)|(?:he|she|they) (?:said|told|mentioned))\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // Profile-update language that doesn't match simple regex patterns
  if (/\bupdate\s+(?:his|her|their|\w+'s)\s+profile\b/i.test(normalized)) {
    return true;
  }

  return false;
}

// ============================================================================
// Helper Functions
// ============================================================================

function capitalizeFirstLetter(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function extractTaskIdentifier(transcript: string): string | undefined {
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    last: -1,
  };
  for (const [word, num] of Object.entries(ordinals)) {
    if (transcript.toLowerCase().includes(word)) return `#${num}`;
  }
  const numMatch = transcript.match(/(\d+)(?:st|nd|rd|th)?/);
  if (numMatch) return `#${parseInt(numMatch[1], 10)}`;
  return undefined;
}

function parseTimeExpression(transcript: string): string | undefined {
  const timePatterns = [
    { regex: /\b(?:at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i },
    { regex: /\b(?:tomorrow|tmrw)\b/i },
    { regex: /\b(?:today)\b/i },
    { regex: /\b(?:tonight)\b/i },
    { regex: /\b(?:this\s+)?(?:morning|afternoon|evening)\b/i },
    { regex: /\bin\s+(\d+)\s+(?:hour|minute|min|hr)s?\b/i },
    { regex: /\b(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i },
  ];
  for (const pattern of timePatterns) {
    const match = transcript.match(pattern.regex);
    if (match) return match[0];
  }
  return undefined;
}

// ============================================================================
// LLM Provider Resolution (mirrors gateway STT pattern)
// ============================================================================

interface ResolvedLLMProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  api: "openai" | "anthropic";
}

/**
 * Resolve the best available LLM provider from the OpenClaw config.
 * Checks environment variables and config in order: Anthropic, OpenAI, Groq.
 */
function resolveLLMProvider(
  api: OpenClawPluginApi,
  modelOverride?: string,
): ResolvedLLMProvider | null {
  const cfg = api.runtime.config.loadConfig();
  const providerOverrides = (cfg as any).models?.providers;

  const candidates: Array<{
    id: string;
    envVar: string;
    baseUrl: string;
    model: string;
    api: "openai" | "anthropic";
  }> = [
    {
      id: "anthropic",
      envVar: "ANTHROPIC_API_KEY",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
      api: "anthropic",
    },
    {
      id: "openai",
      envVar: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      api: "openai",
    },
    {
      id: "groq",
      envVar: "GROQ_API_KEY",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.1-70b-versatile",
      api: "openai",
    },
  ];

  for (const candidate of candidates) {
    const providerConfig = providerOverrides?.[candidate.id];
    const apiKey = process.env[candidate.envVar] || providerConfig?.apiKey;
    if (apiKey) {
      return {
        baseUrl: providerConfig?.baseUrl || candidate.baseUrl,
        apiKey,
        model: modelOverride || providerConfig?.models?.[0]?.id || candidate.model,
        api: candidate.api,
      };
    }
  }

  return null;
}

// ============================================================================
// LLM Prompt Construction
// ============================================================================

function buildClassificationPrompt(window: TranscriptWindow): string {
  const transcriptLines = window.entries
    .map((entry) => {
      const speaker = entry.speakerName
        ? `[${entry.speakerName} (${entry.speakerId || "unknown"})]`
        : entry.speakerId
          ? `[Speaker ${entry.speakerId}]`
          : "[User]";
      return `${speaker}: ${entry.text}`;
    })
    .join("\n");

  const locationContext = window.currentLocation
    ? `\nCurrent GPS location: ${window.currentLocation.latitude}, ${window.currentLocation.longitude}`
    : "";

  const intentDescriptions = Object.entries(INTENT_TYPE_SCHEMA)
    .map(([type, schema]) => `  - "${type}": ${schema.description}\n    params: ${schema.params}`)
    .join("\n");

  return `You are an intent extraction engine for a voice-controlled assistant called Zeke.
You analyze conversation transcripts from a wearable pendant that captures audio, performs speaker diarization, and transcription.

Your job is to extract ALL actionable intents from the most recent utterance, using the full conversation context to resolve references and extract implicit data.

## Available Intent Types

${intentDescriptions}

## Rules

1. Extract EVERY actionable intent from the latest utterance. A single sentence can produce multiple intents.
2. Use conversation context to resolve references:
   - "this house" / "here" -> use current GPS location (useCurrentLocation: true)
   - Pronouns ("his", "her") -> resolve to the person being discussed
   - "about 5 years" -> extract as structured metadata (years_at_address: 5)
3. Cross-speaker awareness: the speaker IDs tell you who said what. Link actions to the correct person.
4. Extract implicit data from casual conversation:
   - If someone asks "how long have you lived here?" and the answer is "5 years", extract years_at_address
   - If a place is described as "beautiful house", infer property_type: "residential"
   - If someone says "this is my home", the current location is their home address
5. Only extract intents with confidence >= 0.5. Use "default" type for pure conversation with no actions.
6. Set useCurrentLocation: true when the speaker references their current physical location.

## Conversation Transcript

${transcriptLines}${locationContext}

## Output Format

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "intents": [
    {
      "type": "<intent_type>",
      "confidence": <0.0-1.0>,
      "params": { ... intent-specific params ... }
    }
  ],
  "contextNotes": "<brief summary of what you understood from the conversation context>"
}

If the latest utterance is pure conversation with no actionable intents, return:
{
  "intents": [{ "type": "default", "confidence": 1.0, "params": {} }],
  "contextNotes": "<conversation summary>"
}`;
}

// ============================================================================
// LLM API Calls
// ============================================================================

/**
 * Call an OpenAI-compatible chat completions endpoint.
 */
async function callOpenAIChat(
  provider: ResolvedLLMProvider,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[Pendant] LLM classification (${provider.model}): HTTP ${response.status}${detail ? ": " + detail : ""}`,
      );
      return null;
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return result.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("[Pendant] LLM classification error (OpenAI-compat):", error);
    return null;
  }
}

/**
 * Call the Anthropic Messages API.
 */
async function callAnthropicChat(
  provider: ResolvedLLMProvider,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": provider.apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[Pendant] LLM classification (${provider.model}): HTTP ${response.status}${detail ? ": " + detail : ""}`,
      );
      return null;
    }

    const result = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = result.content?.find((b) => b.type === "text");
    return textBlock?.text?.trim() || null;
  } catch (error) {
    console.error("[Pendant] LLM classification error (Anthropic):", error);
    return null;
  }
}

/**
 * Parse the LLM's JSON response into a CompoundIntent.
 */
function parseLLMResponse(
  raw: string,
  window: TranscriptWindow,
  confidenceThreshold: number,
): CompoundIntent | null {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned) as {
      intents?: Array<{
        type: string;
        confidence: number;
        params?: Record<string, unknown>;
      }>;
      contextNotes?: string;
      conversationSummary?: string;
    };

    if (!parsed.intents || !Array.isArray(parsed.intents)) {
      console.error("[Pendant] LLM response missing intents array");
      return null;
    }

    const latestEntry = window.entries[window.entries.length - 1];
    const rawTranscript = latestEntry?.text || "";

    const intents: ClassifiedIntent[] = parsed.intents
      .filter((i) => i.confidence >= confidenceThreshold)
      .map((i) => {
        const intent: ClassifiedIntent = {
          type: (i.type as IntentType) || "default",
          confidence: i.confidence,
          rawTranscript,
          params: i.params,
        };

        // Map LLM params into legacy ClassifiedIntent fields for backward compat
        if (i.params) {
          if (typeof i.params.text === "string") {
            intent.extractedText = i.params.text;
          }
          if (typeof i.params.name === "string") {
            intent.extractedText = i.params.name;
          }
          if (typeof i.params.dueTime === "string") {
            intent.dueTime = i.params.dueTime;
          }
          if (typeof i.params.taskIdentifier === "string") {
            intent.taskIdentifier = i.params.taskIdentifier;
          }
          if (typeof i.params.groupName === "string" && !intent.extractedText) {
            intent.extractedText = i.params.groupName;
          }

          // Map location trigger params
          if (i.type === "task_create_location") {
            intent.locationTrigger = {
              locationName: i.params.locationName as string | undefined,
              groupName: i.params.groupName as string | undefined,
              personName: i.params.personName as string | undefined,
              triggerOn: (i.params.triggerOn as "enter" | "exit") || "enter",
            };
          }

          // Map person location params
          if (i.type === "person_location_set" || i.type === "person_location_query") {
            intent.personLocation = {
              personName: (i.params.personName as string) || "",
              locationType: (i.params.locationType as string) || "home",
              locationValue: i.params.locationValue as string | undefined,
            };
          }
        }

        return intent;
      });

    // If no intents passed the threshold, return default
    if (intents.length === 0) {
      intents.push({
        type: "default",
        confidence: 1.0,
        rawTranscript,
      });
    }

    return {
      intents,
      contextNotes: parsed.contextNotes,
      conversationSummary: parsed.conversationSummary,
    };
  } catch (error) {
    console.error("[Pendant] Failed to parse LLM classification response:", error, "\nRaw:", raw);
    return null;
  }
}

// ============================================================================
// Public API -- Regex Fast-Path
// ============================================================================

/**
 * Classify the intent of a single transcript line using regex patterns.
 * This is the legacy fast-path -- no API calls, immediate return.
 *
 * @param transcript The raw transcript text
 * @returns Classified intent with confidence and extracted data
 */
export function classifyIntent(transcript: string): ClassifiedIntent {
  const normalizedTranscript = transcript.trim();

  const allPatterns: IntentPattern[] = [
    ...LOCATION_TASK_PATTERNS,
    ...TASK_COMPLETE_PATTERNS,
    ...TASK_LIST_PATTERNS,
    ...PERSON_LOCATION_SET_PATTERNS,
    ...PERSON_LOCATION_QUERY_PATTERNS,
    ...LOCATION_SAVE_PATTERNS,
    ...LOCATION_GROUP_PATTERNS,
    ...MEMORY_SAVE_PATTERNS,
    ...TASK_CREATE_PATTERNS,
  ];

  let bestMatch: ClassifiedIntent = {
    type: "default",
    confidence: 0,
    rawTranscript: normalizedTranscript,
  };

  for (const pattern of allPatterns) {
    const match = normalizedTranscript.match(pattern.regex);
    if (match) {
      const extractedData = pattern.extractContent?.(match, normalizedTranscript) ?? {};
      let confidence = pattern.baseConfidence;

      if (extractedData.extractedText && extractedData.extractedText.length > 5) {
        confidence = Math.min(confidence + 0.05, 1);
      }
      if (extractedData.locationTrigger?.locationName || extractedData.locationTrigger?.groupName) {
        confidence = Math.min(confidence + 0.03, 1);
      }

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          type: pattern.type,
          confidence,
          rawTranscript: normalizedTranscript,
          ...extractedData,
        };
      }
    }
  }

  if (bestMatch.type === "task_create" || bestMatch.type === "task_create_location") {
    const timeExpr = parseTimeExpression(normalizedTranscript);
    if (timeExpr) {
      bestMatch.dueTime = timeExpr;
    }
  }

  return bestMatch;
}

// ============================================================================
// Public API -- LLM Classification
// ============================================================================

/**
 * Classify intents from a transcript window using the LLM.
 * Sends the full conversation context for intelligent extraction.
 *
 * @param window - Sliding window of recent transcript entries
 * @param api - OpenClaw plugin API (used to resolve LLM provider)
 * @param config - Optional classification configuration
 * @returns Compound intent with all extracted intents
 */
export async function classifyWithLLM(
  window: TranscriptWindow,
  api: OpenClawPluginApi,
  config?: { confidenceThreshold?: number; model?: string },
): Promise<CompoundIntent> {
  const confidenceThreshold = config?.confidenceThreshold ?? 0.5;
  const latestEntry = window.entries[window.entries.length - 1];
  const rawTranscript = latestEntry?.text || "";

  // Resolve LLM provider
  const provider = resolveLLMProvider(api, config?.model);
  if (!provider) {
    console.error(
      "[Pendant] LLM classification: no LLM provider configured. " +
        "Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY. " +
        "Falling back to regex.",
    );
    const regexResult = classifyIntent(rawTranscript);
    return { intents: [regexResult] };
  }

  // Build prompt
  const prompt = buildClassificationPrompt(window);
  const systemPrompt = "You are a precise intent extraction engine. Output ONLY valid JSON.";

  console.log(
    `[Pendant] LLM classification: sending ${window.entries.length} entries to ${provider.model}`,
  );

  // Call LLM
  let response: string | null = null;
  if (provider.api === "anthropic") {
    response = await callAnthropicChat(provider, systemPrompt, prompt);
  } else {
    response = await callOpenAIChat(provider, systemPrompt, prompt);
  }

  if (!response) {
    console.warn("[Pendant] LLM classification returned null, falling back to regex");
    const regexResult = classifyIntent(rawTranscript);
    return { intents: [regexResult] };
  }

  // Parse response
  const result = parseLLMResponse(response, window, confidenceThreshold);
  if (!result) {
    console.warn("[Pendant] LLM response parse failed, falling back to regex");
    const regexResult = classifyIntent(rawTranscript);
    return { intents: [regexResult] };
  }

  console.log(
    `[Pendant] LLM extracted ${result.intents.length} intent(s): ${result.intents.map((i) => i.type).join(", ")}`,
  );
  return result;
}

// ============================================================================
// Public API -- Smart Router
// ============================================================================

/**
 * Smart intent classification router.
 *
 * 1. If useLLMAlways is true, always uses LLM.
 * 2. Otherwise, checks if the latest utterance is a simple command (regex match
 *    with high confidence). If so, returns the regex result immediately (fast path).
 * 3. If the utterance looks complex, compound, or ambiguous, sends the full
 *    transcript window to the LLM for intelligent extraction.
 *
 * @param window - Sliding window of recent transcript entries
 * @param api - OpenClaw plugin API
 * @param config - Classification configuration
 * @returns Compound intent with one or more extracted intents
 */
export async function classifyTranscript(
  window: TranscriptWindow,
  api: OpenClawPluginApi,
  config?: ClassifyConfig,
): Promise<CompoundIntent> {
  const latestEntry = window.entries[window.entries.length - 1];
  if (!latestEntry) {
    return {
      intents: [{ type: "default", confidence: 1.0, rawTranscript: "" }],
    };
  }

  const text = latestEntry.text.trim();
  const useLLMAlways = config?.useLLMAlways ?? false;

  // Fast path: try regex first (unless forced to LLM)
  if (!useLLMAlways) {
    const regexResult = classifyIntent(text);

    // If regex matched with high confidence AND the text doesn't look complex,
    // return immediately without calling the LLM
    if (regexResult.type !== "default" && regexResult.confidence >= 0.85 && !looksComplex(text)) {
      console.log(
        `[Pendant] Regex fast-path: ${regexResult.type} (confidence: ${regexResult.confidence.toFixed(2)})`,
      );
      return { intents: [regexResult] };
    }

    // If it's clearly just conversation (no action verbs, no regex match)
    if (regexResult.type === "default" && !looksComplex(text) && !hasActionLanguage(text)) {
      return {
        intents: [regexResult],
      };
    }
  }

  // Complex/ambiguous/compound path: use LLM
  return classifyWithLLM(window, api, {
    confidenceThreshold: config?.confidenceThreshold,
    model: config?.model,
  });
}

/**
 * Check if text contains any action-oriented language that might need classification.
 */
function hasActionLanguage(text: string): boolean {
  return /\b(?:mark|save|update|add|set|create|remind|note|remember|put|send|show|list|complete|finish|delete|remove|call|name|star)\b/i.test(
    text,
  );
}

// ============================================================================
// Utility Exports (backward compat)
// ============================================================================

/**
 * Check if an intent requires AI clarification.
 */
export function needsAIClarification(intent: ClassifiedIntent): boolean {
  if (intent.confidence < 0.6 && intent.type !== "default") {
    return true;
  }
  if (
    (intent.type === "task_create" || intent.type === "task_create_location") &&
    (!intent.extractedText || intent.extractedText.length < 3)
  ) {
    return true;
  }
  if (
    intent.type === "task_create_location" &&
    !intent.locationTrigger?.locationName &&
    !intent.locationTrigger?.groupName &&
    !intent.locationTrigger?.personName
  ) {
    return true;
  }
  return false;
}

/**
 * Get a human-readable description of an intent.
 */
export function describeIntent(intent: ClassifiedIntent): string {
  switch (intent.type) {
    case "task_create":
      return `Create task: "${intent.extractedText}"${intent.dueTime ? ` (${intent.dueTime})` : ""}`;

    case "task_create_location": {
      const loc = intent.locationTrigger;
      const trigger = loc?.triggerOn === "exit" ? "leaving" : "arriving at";
      const place = loc?.locationName || loc?.groupName || `${loc?.personName}'s place`;
      return `Create location task: "${intent.extractedText}" when ${trigger} ${place}`;
    }

    case "task_list":
      return "List tasks";

    case "task_complete":
      return `Complete task: ${intent.taskIdentifier || "specified task"}`;

    case "location_save":
      return `Save current location as "${intent.extractedText}"`;

    case "location_group":
      return `Add to location group "${intent.extractedText}"`;

    case "person_location_set":
      return `Set ${intent.personLocation?.personName}'s ${intent.personLocation?.locationType}`;

    case "person_location_query":
      return `Query ${intent.personLocation?.personName}'s ${intent.personLocation?.locationType}`;

    case "person_location_add":
      return `Add location tag "${intent.params?.tag}" to ${intent.params?.personName}'s profile`;

    case "person_profile_update":
      return `Update ${intent.params?.personName}'s profile with metadata`;

    case "memory_save":
      return `Save to memory: "${intent.extractedText || "conversation"}"`;

    default:
      return "Continue conversation";
  }
}
