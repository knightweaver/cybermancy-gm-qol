const MODULE_ID = "cybermancy-gm-qol";
const LEGACY_MODULE_ID = "cybermancy-gm-inspector";
const VERSION = "1.0.1";
const NATIVE_ATTACK_VALIDATED_DH_VERSION = "1.2.7";
const COMBAT_STATE_FLAG = "combatState";
const LEGACY_MIGRATION_FLAG = "legacyCombatStateMigrated";
const COMBAT_STATE_SCHEMA_VERSION = 14;
const COMBAT_STATE_FORMAT = "json-snapshot";
const ENVIRONMENT_FLAG_NAMESPACE = "cybermancy";
const ENVIRONMENT_FLAG_KEY = "activeEnvironments";

// Runtime compatibility for unmodifiable SRD Actors. Keys must be verified,
// stable source/compendium UUIDs. Intentionally empty in v0.15 until a concrete
// SRD source UUID is validated; the resolver mechanism is active and tested.
const SPOTLIGHT_LIMIT_COMPATIBILITY = Object.freeze({
  actorSpotlightLimits: Object.freeze({
    // Example shape only:
    // "Compendium.daggerheart.adversaries.Actor.<stable-id>": 2
  })
});

let inspectorDialog = null;

// Inspector-session-only UI state. This is never persisted to Foundry.
const expandedGroups = new Set();
const expandedEnvironments = new Set();
const collapsedFastPlay = new Set();
let pcSectionCollapsed = false;
let inspectorDiagnosticsVisible = false;
let inspectorSceneId = null;

// Scene-persistent GM combat state. Stored in:
// flags.cybermancy-gm-qol.combatState
// v0.x/RC compatibility: flags.cybermancy-gm-inspector.combatState
let spotlightOwner = "PC";
let gmEntryMode = null;                // null | "natural" | "interrupt"
let gmMovesThisTurn = 0;
const gmMoveLedger = [];               // [{ kind, fearCost }] supports deterministic undo/refund
const spotlightUses = new Map();       // tokenId -> uses in current GM turn
const spotlightTotals = new Map();     // tokenId -> cumulative uses for this Scene
let spotlightSceneId = null;
let combatStateLoaded = false;
let combatStateRevision = 0;
let combatStateWritePending = false;
let combatStateWriteChain = Promise.resolve();
let fearTransactionPending = false;
let actionTransactionPending = false;
let reactionTransactionPending = false;
let conditionTransactionPending = false;
let nativeQolWritePending = false;

// Reactions/non-Spotlight feature executions are not GM Moves. They persist in
// their own current-cycle ledger and are cleared by END GM TURN.
const reactionLedger = [];
let gmEventSequence = 0;

// Scene-persistent pending natural GM opportunity detected from a structured
// Daggerheart PC Action Roll. The Inspector observes; it never seizes Spotlight
// or generates Fear automatically.
let pendingOpportunity = null;

// Informational PC-roll state. A NO RESULT roll is not a GM Opportunity.
let pendingRollNotice = null;

// Monotonic runtime identifier for structured Daggerheart postRollDuality events.
// It is not persisted and has no rules meaning.
let nativeOpportunitySequence = 0;

// Inspector-session-only grant mode. The grant relationships themselves are
// persisted on the owning GM Action transaction; this pointer is not.
let grantModeLedgerIndex = null;
