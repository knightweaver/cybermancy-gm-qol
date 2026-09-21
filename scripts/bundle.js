// GENERATED FILE — DO NOT EDIT DIRECTLY.
// Source: scripts/src/*.js
// Rebuild: node tools/build-bundle.mjs
// ===== 00-preamble.js =====
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

// ===== 10-fear.js =====
/* -------------------------------------------- */
/*  Daggerheart Fear — Native                  */
/* -------------------------------------------- */

function getFearDescriptor() {
  try {
    const namespace = CONFIG?.DH?.id;
    const fearKey = CONFIG?.DH?.SETTINGS?.gameSettings?.Resources?.Fear;
    const homebrewKey = CONFIG?.DH?.SETTINGS?.gameSettings?.Homebrew;

    if (!namespace || !fearKey || !homebrewKey) {
      return {
        available: false,
        reason: "Daggerheart Fear configuration keys are unavailable.",
        namespace: namespace ?? null,
        fearKey: fearKey ?? null,
        homebrewKey: homebrewKey ?? null
      };
    }

    return {
      available: true,
      namespace,
      fearKey,
      homebrewKey,
      fearCompositeKey: `${namespace}.${fearKey}`,
      homebrewCompositeKey: `${namespace}.${homebrewKey}`
    };
  } catch (error) {
    return {
      available: false,
      reason: `Could not resolve Daggerheart Fear configuration: ${error.message}`
    };
  }
}

function getFearState() {
  const descriptor = getFearDescriptor();

  if (!descriptor.available) {
    return { ...descriptor, current: null, max: null };
  }

  try {
    const currentRaw = game.settings.get(
      descriptor.namespace,
      descriptor.fearKey
    );

    const homebrew = game.settings.get(
      descriptor.namespace,
      descriptor.homebrewKey
    );

    const maxRaw = homebrew?.maxFear;
    const current = Number(currentRaw);
    const max = Number(maxRaw);

    if (!Number.isFinite(current) || !Number.isFinite(max)) {
      return {
        ...descriptor,
        available: false,
        current: null,
        max: null,
        reason: `Daggerheart returned non-numeric Fear data (current=${String(currentRaw)}, max=${String(maxRaw)}).`
      };
    }

    return {
      ...descriptor,
      available: true,
      current,
      max,
      reason: null
    };
  } catch (error) {
    return {
      ...descriptor,
      available: false,
      current: null,
      max: null,
      reason: `Could not read Daggerheart Fear settings: ${error.message}`
    };
  }
}

function isFearRelatedSetting(setting) {
  const descriptor = getFearDescriptor();
  if (!descriptor.available) return false;

  const key = setting?.key;
  return key === descriptor.fearCompositeKey
    || key === descriptor.homebrewCompositeKey;
}

async function changeNativeFear(delta, reason = "GM Move") {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only the GM can change Daggerheart Fear.");
    return false;
  }

  if (fearTransactionPending) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn("Native Daggerheart Fear is unavailable; no transaction was made.");
    return false;
  }

  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return true;

  const next = fear.current + amount;
  if (next < 0) {
    ui.notifications.warn(`Not enough Fear for ${reason}.`);
    return false;
  }

  // Refunds are clamped to Daggerheart's configured maximum.
  const bounded = Math.min(fear.max, next);

  try {
    fearTransactionPending = true;
    await game.settings.set(fear.namespace, fear.fearKey, bounded);

    if (amount > 0 && bounded < next) {
      ui.notifications.warn("Fear refund was capped at the configured maximum.");
    }

    return true;
  } catch (error) {
    console.error("Cybermancy GM QOL | Native Fear transaction failed", error);
    ui.notifications.error("Daggerheart Fear could not be updated. Combat state was not advanced.");
    return false;
  } finally {
    fearTransactionPending = false;
  }
}

async function gainQolFear() {
  if (
    nativeQolWritePending
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn(
      "Native Daggerheart Fear is unavailable; no Fear was added."
    );
    return false;
  }

  if (fear.current >= fear.max) {
    return false;
  }

  try {
    nativeQolWritePending = true;
    return await changeNativeFear(1, "QOL Fear control");
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function spendQolFear() {
  if (
    nativeQolWritePending
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn(
      "Native Daggerheart Fear is unavailable; no Fear was spent."
    );
    return false;
  }

  if (fear.current <= 0) {
    return false;
  }

  try {
    nativeQolWritePending = true;
    return await changeNativeFear(-1, "QOL manual Fear control");
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function spendNativeFear(amount, reason) {
  const value = Math.max(0, Number(amount) || 0);
  if (value === 0) return true;
  return changeNativeFear(-value, reason);
}

async function refundNativeFear(amount, reason) {
  const value = Math.max(0, Number(amount) || 0);
  if (value === 0) return true;
  return changeNativeFear(value, reason);
}

// ===== 20-state.js =====
/* -------------------------------------------- */
/*  Scene-Persistent GM Combat State            */
/* -------------------------------------------- */

function coercePositiveCount(raw) {
  const count = Math.max(0, Math.trunc(Number(raw) || 0));
  return count > 0 ? count : 0;
}

function tokenIdFromLegacyPath(pathParts) {
  const parts = pathParts.map(part => String(part));

  // v0.10 keys were normally Scene.<sceneId>.Token.<tokenId>.
  const tokenIndex = parts.lastIndexOf("Token");
  if (tokenIndex >= 0 && parts[tokenIndex + 1]) {
    return parts[tokenIndex + 1];
  }

  // Also accept a literal dotted key which survived storage unchanged.
  const joined = parts.join(".");
  const match = joined.match(/(?:^|\.)Token\.([^.]+)$/);
  if (match?.[1]) return match[1];

  // Schema v2 direct object keys are Token document IDs.
  if (parts.length === 1 && parts[0] && !parts[0].includes(".")) {
    return parts[0];
  }

  return null;
}

function normalizeTokenCountCollection(value) {
  const result = {};

  // Future-proof array form, if ever supplied manually.
  if (Array.isArray(value)) {
    for (const entry of value) {
      const tokenId = String(entry?.tokenId ?? "");
      const count = coercePositiveCount(entry?.count);
      if (tokenId && count > 0) result[tokenId] = count;
    }
    return result;
  }

  if (!value || typeof value !== "object") return result;

  function walk(node, path = []) {
    if (node === null || node === undefined) return;

    if (typeof node !== "object") {
      const count = coercePositiveCount(node);
      const tokenId = tokenIdFromLegacyPath(path);
      if (tokenId && count > 0) result[tokenId] = count;
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      // If a v0.10 literal UUID key survived without expansion, parse it whole.
      const literalTokenId = tokenIdFromLegacyPath([key]);
      const literalCount = coercePositiveCount(child);
      if (literalTokenId && literalCount > 0 && typeof child !== "object") {
        result[literalTokenId] = literalCount;
        continue;
      }

      // A direct v2 token-id key is also handled here.
      if (
        path.length === 0
        && !key.includes(".")
        && typeof child !== "object"
      ) {
        const count = coercePositiveCount(child);
        if (count > 0) result[key] = count;
        continue;
      }

      // Otherwise recurse. This recovers Foundry-expanded v0.10 structures:
      // { Scene: { <sceneId>: { Token: { <tokenId>: 3 }}}}
      walk(child, [...path, key]);
    }
  }

  walk(value);
  return result;
}

function sanitizePendingOpportunity(value) {
  if (!value || typeof value !== "object") return null;

  const messageId = value.messageId ? String(value.messageId) : null;
  const actorName = value.actorName ? String(value.actorName) : "PC";
  const actorUuid = value.actorUuid ? String(value.actorUuid) : null;
  const outcome = [
    "success-fear",
    "failure-hope",
    "failure-fear"
  ].includes(value.outcome)
    ? value.outcome
    : null;

  const moveWeight = value.moveWeight === "major" ? "major" : "minor";

  if (!messageId || !outcome) return null;

  return {
    messageId,
    actorUuid,
    actorName,
    outcome,
    moveWeight,
    outcomeLabel: value.outcomeLabel
      ? String(value.outcomeLabel)
      : formatOpportunityOutcome(outcome),
    sourceSignature: value.sourceSignature
      ? String(value.sourceSignature)
      : `${messageId}:${outcome}`,
    sourceKey: value.sourceKey ? String(value.sourceKey) : null,
    speakerSceneId: value.speakerSceneId
      ? String(value.speakerSceneId)
      : null,
    detectionSource: [
      "native",
      "native+chat",
      "chat-diagnostic"
    ].includes(value.detectionSource)
      ? value.detectionSource
      : "native",
    observedCount: Math.max(
      1,
      Math.trunc(Number(value.observedCount) || 1)
    ),
    createdAt: Math.max(0, Number(value.createdAt) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}

function formatOpportunityOutcome(outcome) {
  switch (outcome) {
    case "success-fear": return "SUCCESS WITH FEAR";
    case "failure-hope": return "FAILURE WITH HOPE";
    case "failure-fear": return "FAILURE WITH FEAR";
    default: return "GM OPPORTUNITY";
  }
}

function classifyOpportunityOutcome({ duality, success, isCritical }) {
  const numericDuality = Number(duality);
  const critical = Boolean(isCritical) || numericDuality === 0;

  if (critical) {
    return {
      qualifies: false,
      outcome: "critical-success",
      outcomeLabel: "CRITICAL SUCCESS",
      moveWeight: null
    };
  }

  if (success && numericDuality === -1) {
    return {
      qualifies: true,
      outcome: "success-fear",
      outcomeLabel: formatOpportunityOutcome("success-fear"),
      moveWeight: "minor"
    };
  }

  if (!success && numericDuality === 1) {
    return {
      qualifies: true,
      outcome: "failure-hope",
      outcomeLabel: formatOpportunityOutcome("failure-hope"),
      moveWeight: "minor"
    };
  }

  if (!success && numericDuality === -1) {
    return {
      qualifies: true,
      outcome: "failure-fear",
      outcomeLabel: formatOpportunityOutcome("failure-fear"),
      moveWeight: "major"
    };
  }

  return {
    qualifies: false,
    outcome: "success-hope",
    outcomeLabel: "SUCCESS WITH HOPE",
    moveWeight: null
  };
}

function buildOpportunitySourceKey(source) {
  if (!source || typeof source !== "object") return null;

  const actor = source.actor ? String(source.actor) : "";
  const item = source.item ? String(source.item) : "";
  const action = source.action ? String(source.action) : "";

  if (!actor) return null;
  return [actor, item, action].join("|");
}

function sanitizeGrantedSpotlights(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(grant => {
      const tokenId = grant?.tokenId ? String(grant.tokenId) : null;
      const delta = Math.max(0, Math.trunc(Number(grant?.delta) || 0));
      if (!tokenId || delta <= 0) return null;

      // v0.16/v7 grants had no consumption lifecycle. Conservatively migrate
      // them as used so upgrading cannot create a free extra Action.
      const status = ["available", "used"].includes(grant?.status)
        ? grant.status
        : "used";

      const executionMode = [
        "bookkeeping-only",
        "native-standard",
        "native-embedded",
        "native-effect-remove"
      ].includes(grant?.executionMode)
        ? grant.executionMode
        : null;

      const executionStatus = [
        "bookkeeping-only",
        "pending-native",
        "completed",
        "cancelled",
        "failed"
      ].includes(grant?.executionStatus)
        ? grant.executionStatus
        : null;

      return {
        tokenId,
        delta,
        status,
        actionName: grant?.actionName ? String(grant.actionName) : null,
        actionSubtype: grant?.actionSubtype ? String(grant.actionSubtype) : null,
        effectId: grant?.effectId ? String(grant.effectId) : null,
        effectName: grant?.effectName ? String(grant.effectName) : null,
        itemId: grant?.itemId ? String(grant.itemId) : null,
        nativeActionId: grant?.nativeActionId ? String(grant.nativeActionId) : null,
        executionMode,
        executionStatus,
        expectedNativeFearCost: Math.max(
          0,
          Number(grant?.expectedNativeFearCost) || 0
        ),
        featureFearCost: Math.max(
          0,
          Number(grant?.featureFearCost) || 0
        ),
        inspectorFearCost: Math.max(
          0,
          Number(grant?.inspectorFearCost) || 0
        ),
        eventSequence: Math.max(
          0,
          Math.trunc(Number(grant?.eventSequence) || 0)
        )
      };
    })
    .filter(Boolean);
}

function sanitizeMoveLedger(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(entry => {
      const kind = ["base", "additional", "interrupt"].includes(entry?.kind)
        ? entry.kind
        : null;
      if (!kind) return null;

      const legacyFearCost = Math.max(0, Number(entry?.fearCost) || 0);
      const transactionType = ["action", "environment-action"].includes(entry?.transactionType)
        ? entry.transactionType
        : null;

      const moveFearCost = Object.prototype.hasOwnProperty.call(entry ?? {}, "moveFearCost")
        ? Math.max(0, Number(entry.moveFearCost) || 0)
        : legacyFearCost;

      const featureFearCost = Object.prototype.hasOwnProperty.call(entry ?? {}, "featureFearCost")
        ? Math.max(0, Number(entry.featureFearCost) || 0)
        : 0;

      const executionMode = [
        "bookkeeping-only",
        "native-standard",
        "native-embedded",
        "native-effect-remove"
      ].includes(entry?.executionMode)
        ? entry.executionMode
        : null;

      const expectedNativeFearCost = executionMode?.startsWith("native-")
        ? Math.max(0, Number(entry?.expectedNativeFearCost) || 0)
        : 0;

      // fearCost is always the amount the Inspector itself owns/refunds.
      // Legacy transaction records owned both move + feature Fear.
      const fearCost = Object.prototype.hasOwnProperty.call(entry ?? {}, "fearCost")
        ? legacyFearCost
        : transactionType
          ? moveFearCost + featureFearCost
          : legacyFearCost;

      const spotlightDelta = transactionType === "action"
        ? Math.max(0, Math.trunc(Number(entry?.spotlightDelta) || 0))
        : 0;

      const executionStatus = [
        "bookkeeping-only",
        "pending-native",
        "completed",
        "cancelled",
        "failed"
      ].includes(entry?.executionStatus)
        ? entry.executionStatus
        : null;

      // v0.13.1 introduces an explicit GM Move lifecycle.
      // Legacy entries have no safe way to distinguish a purchased-but-unused
      // move from a move already spent in the fiction, so migrate them as used.
      const moveStatus = ["prepared", "used"].includes(entry?.moveStatus)
        ? entry.moveStatus
        : "used";

      return {
        kind,
        fearCost,
        moveFearCost,
        featureFearCost,
        expectedNativeFearCost,
        transactionType,
        executionMode,
        executionStatus,
        moveStatus,
        tokenId: transactionType === "action" && entry?.tokenId
          ? String(entry.tokenId)
          : null,
        environmentUuid: transactionType === "environment-action" && entry?.environmentUuid
          ? String(entry.environmentUuid)
          : null,
        itemId: transactionType && entry?.itemId ? String(entry.itemId) : null,
        nativeActionId: transactionType && entry?.nativeActionId ? String(entry.nativeActionId) : null,
        actionName: transactionType && entry?.actionName ? String(entry.actionName) : null,
        actionSubtype: transactionType === "action" && entry?.actionSubtype
          ? String(entry.actionSubtype)
          : null,
        effectId: transactionType === "action" && entry?.effectId
          ? String(entry.effectId)
          : null,
        effectName: transactionType === "action" && entry?.effectName
          ? String(entry.effectName)
          : null,
        eventSequence: Math.max(
          0,
          Math.trunc(Number(entry?.eventSequence) || 0)
        ),
        spotlightDelta,
        grantedSpotlights: transactionType === "action"
          ? sanitizeGrantedSpotlights(entry?.grantedSpotlights)
          : []
      };
    })
    .filter(Boolean);
}

function sanitizeReactionLedger(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(entry => {
      const sourceType = ["adversary", "environment"].includes(entry?.sourceType)
        ? entry.sourceType
        : null;

      if (!sourceType || !entry?.actionName) return null;

      const classification = ["reaction", "non-spotlight"].includes(entry?.classification)
        ? entry.classification
        : "reaction";

      const executionMode = [
        "bookkeeping-only",
        "native-embedded"
      ].includes(entry?.executionMode)
        ? entry.executionMode
        : "bookkeeping-only";

      const executionStatus = [
        "bookkeeping-only",
        "pending-native",
        "completed",
        "cancelled",
        "failed"
      ].includes(entry?.executionStatus)
        ? entry.executionStatus
        : executionMode === "native-embedded"
          ? "completed"
          : "bookkeeping-only";

      return {
        transactionType: "reaction",
        sourceType,
        classification,
        tokenId: sourceType === "adversary" && entry?.tokenId
          ? String(entry.tokenId)
          : null,
        environmentUuid: sourceType === "environment" && entry?.environmentUuid
          ? String(entry.environmentUuid)
          : null,
        itemId: entry?.itemId ? String(entry.itemId) : null,
        nativeActionId: entry?.nativeActionId ? String(entry.nativeActionId) : null,
        actionName: String(entry.actionName),
        inspectorFearCost: Math.max(
          0,
          Number(entry?.inspectorFearCost) || 0
        ),
        expectedNativeFearCost: Math.max(
          0,
          Number(entry?.expectedNativeFearCost) || 0
        ),
        executionMode,
        executionStatus,
        eventSequence: Math.max(
          0,
          Math.trunc(Number(entry?.eventSequence) || 0)
        )
      };
    })
    .filter(Boolean);
}

function allocateGmEventSequence() {
  gmEventSequence = Math.max(0, Math.trunc(Number(gmEventSequence) || 0)) + 1;
  return gmEventSequence;
}

function getLatestReactionWithIndex() {
  if (!reactionLedger.length) return null;

  let best = null;
  for (let index = 0; index < reactionLedger.length; index += 1) {
    const entry = reactionLedger[index];
    const sequence = Math.max(0, Math.trunc(Number(entry?.eventSequence) || 0));

    if (!best || sequence >= best.sequence) {
      best = { entry, index, sequence };
    }
  }

  return best;
}

function getTokenStateKey(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  return document?.id ?? null;
}

function resetCombatStateInMemory(sceneId = canvas?.scene?.id ?? null) {
  spotlightOwner = "PC";
  pendingOpportunity = null;
  pendingRollNotice = null;
  gmEntryMode = null;
  gmMovesThisTurn = 0;
  gmMoveLedger.length = 0;
  reactionLedger.length = 0;
  gmEventSequence = 0;
  grantModeLedgerIndex = null;
  spotlightUses.clear();
  spotlightTotals.clear();
  spotlightSceneId = sceneId;
  combatStateRevision = 0;
  combatStateLoaded = true;
}

function getSerializableCombatState(revision = combatStateRevision) {
  return {
    format: COMBAT_STATE_FORMAT,
    schemaVersion: COMBAT_STATE_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(revision) || 0)),
    spotlightOwner,
    pendingOpportunity: sanitizePendingOpportunity(pendingOpportunity),
    pendingRollNotice: sanitizePendingRollNotice(pendingRollNotice),
    gmEntryMode,
    gmMovesThisTurn,
    gmEventSequence: Math.max(
      0,
      Math.trunc(Number(gmEventSequence) || 0)
    ),
    gmMoveLedger: gmMoveLedger.map(entry => ({
      kind: entry.kind,
      fearCost: Number(entry.fearCost) || 0,
      moveFearCost: Number(entry.moveFearCost) || 0,
      featureFearCost: Number(entry.featureFearCost) || 0,
      expectedNativeFearCost: Number(entry.expectedNativeFearCost) || 0,
      transactionType: entry.transactionType ?? null,
      executionMode: entry.executionMode ?? null,
      executionStatus: entry.executionStatus ?? null,
      moveStatus: entry.moveStatus ?? "used",
      tokenId: entry.tokenId ?? null,
      environmentUuid: entry.environmentUuid ?? null,
      itemId: entry.itemId ?? null,
      nativeActionId: entry.nativeActionId ?? null,
      actionName: entry.actionName ?? null,
      actionSubtype: entry.actionSubtype ?? null,
      effectId: entry.effectId ?? null,
      effectName: entry.effectName ?? null,
      eventSequence: Math.max(
        0,
        Math.trunc(Number(entry.eventSequence) || 0)
      ),
      spotlightDelta: Math.max(0, Math.trunc(Number(entry.spotlightDelta) || 0)),
      grantedSpotlights: sanitizeGrantedSpotlights(entry.grantedSpotlights)
    })),
    reactionLedger: sanitizeReactionLedger(reactionLedger),
    spotlightUses: Object.fromEntries(spotlightUses),
    spotlightTotals: Object.fromEntries(spotlightTotals)
  };
}

function snapshotCombatStateMemory() {
  return foundry.utils.deepClone(getSerializableCombatState());
}

function restoreCombatStateMemory(snapshot, sceneId = spotlightSceneId) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : {};

  spotlightOwner = safe.spotlightOwner === "GM" ? "GM" : "PC";
  pendingOpportunity = sanitizePendingOpportunity(safe.pendingOpportunity);
  pendingRollNotice = sanitizePendingRollNotice(safe.pendingRollNotice);
  gmEntryMode = ["natural", "interrupt"].includes(safe.gmEntryMode)
    ? safe.gmEntryMode
    : null;

  gmMoveLedger.length = 0;
  gmMoveLedger.push(...sanitizeMoveLedger(safe.gmMoveLedger));

  reactionLedger.length = 0;
  reactionLedger.push(...sanitizeReactionLedger(safe.reactionLedger));

  const allEventSequences = [
    ...gmMoveLedger.map(entry => Math.max(0, Number(entry?.eventSequence) || 0)),
    ...gmMoveLedger.flatMap(entry =>
      sanitizeGrantedSpotlights(entry?.grantedSpotlights)
        .map(grant => Math.max(0, Number(grant?.eventSequence) || 0))
    ),
    ...reactionLedger.map(entry => Math.max(0, Number(entry?.eventSequence) || 0))
  ];

  gmEventSequence = Math.max(
    Math.max(0, Math.trunc(Number(safe.gmEventSequence) || 0)),
    ...allEventSequences,
    0
  );

  const explicitMoveCount = Math.max(0, Math.trunc(Number(safe.gmMovesThisTurn) || 0));
  gmMovesThisTurn = gmMoveLedger.length || explicitMoveCount;

  spotlightUses.clear();
  for (const [tokenId, count] of Object.entries(normalizeTokenCountCollection(safe.spotlightUses))) {
    spotlightUses.set(tokenId, count);
  }

  spotlightTotals.clear();
  for (const [tokenId, count] of Object.entries(normalizeTokenCountCollection(safe.spotlightTotals))) {
    spotlightTotals.set(tokenId, count);
  }

  // A pending natural opportunity belongs only to PC Spotlight.
  if (spotlightOwner === "GM") {
    pendingOpportunity = null;
    pendingRollNotice = null;
  }

  // Invalid PC-owned move state is normalized rather than restored.
  if (spotlightOwner === "PC") {
    gmEntryMode = null;
    gmMovesThisTurn = 0;
    gmMoveLedger.length = 0;
    spotlightUses.clear();
  }

  spotlightSceneId = sceneId ?? canvas?.scene?.id ?? null;
  combatStateRevision = Math.max(0, Math.trunc(Number(safe.revision) || 0));
  combatStateLoaded = true;
}

function parsePersistedCombatState(raw) {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { state: null, legacy: false, error: "Snapshot JSON did not contain an object." };
      }
      return {
        state: parsed,
        legacy: parsed.format !== COMBAT_STATE_FORMAT
          || Number(parsed.schemaVersion) < COMBAT_STATE_SCHEMA_VERSION,
        error: null
      };
    } catch (error) {
      return {
        state: null,
        legacy: false,
        error: `Snapshot JSON could not be parsed: ${error.message}`
      };
    }
  }

  // v0.10.x through v0.11.0 persisted a structured object directly.
  if (raw && typeof raw === "object") {
    return {
      state: raw,
      legacy: true,
      error: null
    };
  }

  return { state: null, legacy: false, error: null };
}

function getStoredDocumentFlagRaw(document, scope, key) {
  if (!document) return null;

  // Foundry v13 validates Document#getFlag scope names against active packages.
  // A disabled pre-v1 module is therefore not a valid getFlag scope. Read the
  // serialized Scene data directly for one-time legacy migration.
  const data = typeof document.toObject === "function"
    ? document.toObject(false)
    : document;

  const scoped = data?.flags?.[scope];
  if (!scoped || !Object.prototype.hasOwnProperty.call(scoped, key)) {
    return null;
  }

  return scoped[key];
}

function getCombatStateFlagRecord(scene = canvas?.scene) {
  if (!scene) {
    return {
      raw: null,
      scope: MODULE_ID,
      legacyScope: false,
      legacyMigrationComplete: false
    };
  }

  // Canonical v1 flags use the normal Foundry flag API.
  const currentRaw = scene.getFlag(
    MODULE_ID,
    COMBAT_STATE_FLAG
  );

  const migrationComplete = Boolean(
    scene.getFlag(
      MODULE_ID,
      LEGACY_MIGRATION_FLAG
    )
  );

  if (currentRaw !== undefined && currentRaw !== null) {
    return {
      raw: currentRaw,
      scope: MODULE_ID,
      legacyScope: false,
      legacyMigrationComplete: migrationComplete
    };
  }

  // Once v1 has migrated or explicitly reset this Scene, stale pre-v1 state
  // must never be treated as authoritative again.
  if (migrationComplete) {
    return {
      raw: null,
      scope: MODULE_ID,
      legacyScope: false,
      legacyMigrationComplete: true
    };
  }

  const legacyRaw = getStoredDocumentFlagRaw(
    scene,
    LEGACY_MODULE_ID,
    COMBAT_STATE_FLAG
  );

  return {
    raw: legacyRaw,
    scope: legacyRaw !== null ? LEGACY_MODULE_ID : MODULE_ID,
    legacyScope: legacyRaw !== null,
    legacyMigrationComplete: false
  };
}

async function markLegacyCombatStateMigrationComplete(scene = canvas?.scene) {
  if (!scene) return false;

  await scene.setFlag(
    MODULE_ID,
    LEGACY_MIGRATION_FLAG,
    true
  );

  return true;
}

async function loadCombatStateFromScene(scene = canvas?.scene) {
  if (!scene) {
    resetCombatStateInMemory(null);
    return false;
  }

  const flagRecord = getCombatStateFlagRecord(scene);
  const raw = flagRecord.raw;
  const parsed = parsePersistedCombatState(raw);

  if (parsed.error) {
    console.error("Cybermancy GM QOL | Could not parse persisted combat state", parsed.error, raw);
    resetCombatStateInMemory(scene.id);
    ui.notifications.error("Cybermancy GM QOL combat state exists but could not be parsed. Recovery can clear it; no automatic overwrite was performed.");
    return false;
  }

  if (!parsed.state) {
    resetCombatStateInMemory(scene.id);
    return true;
  }

  restoreCombatStateMemory(parsed.state, scene.id);

  if (parsed.legacy || flagRecord.legacyScope) {
    console.log(
      "Cybermancy GM QOL | migrating Scene combat state",
      {
        scene: scene.name,
        fromScope: flagRecord.scope,
        toScope: MODULE_ID,
        fromSchema: parsed.state?.schemaVersion ?? 0,
        toSchema: COMBAT_STATE_SCHEMA_VERSION
      }
    );

    const migrated = await persistCombatState({
      forceNextRevision: true
    });

    if (!migrated) {
      ui.notifications.warn(
        "Cybermancy GM QOL restored legacy combat state but could not rewrite it under the v1 package namespace."
      );
    } else if (flagRecord.legacyScope) {
      try {
        await markLegacyCombatStateMigrationComplete(scene);
      } catch (error) {
        console.warn(
          "Cybermancy GM QOL | Legacy state was migrated, but the v1 migration marker could not be saved.",
          error
        );
      }
    }
  }

  return true;
}

function syncSpotlightSceneState() {
  const sceneId = canvas?.scene?.id ?? null;

  if (sceneId !== spotlightSceneId) {
    resetCombatStateInMemory(sceneId);
  }
}

function queueCombatStateWrite(scene, state, revision) {
  if (!scene) return Promise.resolve(false);

  // The flag value is a single JSON string, intentionally making every save a
  // whole-state scalar replacement instead of a nested differential merge.
  const snapshotText = JSON.stringify(state);

  const write = async () => {
    try {
      combatStateWritePending = true;

      const updatedScene = await scene.setFlag(
        MODULE_ID,
        COMBAT_STATE_FLAG,
        snapshotText
      );

      const verificationRaw = updatedScene?.getFlag?.(
        MODULE_ID,
        COMBAT_STATE_FLAG
      ) ?? scene.getFlag(MODULE_ID, COMBAT_STATE_FLAG);

      if (verificationRaw !== snapshotText) {
        console.error(
          "Cybermancy GM QOL | Scene combat state read-back mismatch",
          {
            scene: scene.name,
            expectedRevision: revision,
            expected: snapshotText,
            actual: verificationRaw
          }
        );
        ui.notifications.error("Cybermancy GM combat state save could not be verified. The action was rolled back where possible.");
        return false;
      }

      combatStateRevision = revision;
      return true;
    } catch (error) {
      console.error("Cybermancy GM QOL | Failed to persist combat state", error);
      ui.notifications.error("Cybermancy GM combat state could not be saved to the Scene.");
      return false;
    } finally {
      combatStateWritePending = false;
    }
  };

  combatStateWriteChain = combatStateWriteChain.then(write, write);
  return combatStateWriteChain;
}

async function persistCombatState({ forceNextRevision = false } = {}) {
  const scene = canvas?.scene;
  if (!scene || scene.id !== spotlightSceneId) {
    ui.notifications.warn("Cybermancy GM combat state was not saved because the active Scene changed.");
    return false;
  }

  const nextRevision = Math.max(
    combatStateRevision + 1,
    forceNextRevision ? 1 : 0
  );

  const state = getSerializableCombatState(nextRevision);
  return queueCombatStateWrite(scene, state, nextRevision);
}

function getSpotlightUseCount(tokenKey) {
  return Math.max(0, Number(spotlightUses.get(tokenKey) ?? 0));
}

function getSpotlightTotalCount(tokenKey) {
  return Math.max(0, Number(spotlightTotals.get(tokenKey) ?? 0));
}

function getLinkedSpotlightCount(tokenKey) {
  if (!tokenKey) return 0;

  return gmMoveLedger.reduce((sum, entry) => {
    if (entry?.transactionType !== "action") return sum;

    let linked = 0;

    if (String(entry?.tokenId ?? "") === String(tokenKey)) {
      linked += Math.max(
        0,
        Math.trunc(Number(entry?.spotlightDelta) || 0)
      );
    }

    for (const grant of sanitizeGrantedSpotlights(entry?.grantedSpotlights)) {
      if (String(grant.tokenId) === String(tokenKey)) {
        linked += grant.delta;
      }
    }

    return sum + linked;
  }, 0);
}

function getUnlinkedSpotlightCount(tokenKey) {
  const turn = getSpotlightUseCount(tokenKey);
  const linked = getLinkedSpotlightCount(tokenKey);
  return Math.max(0, turn - linked);
}

function getSpotlightIntegrity() {
  const tokenKeys = new Set([
    ...spotlightUses.keys(),
    ...spotlightTotals.keys()
  ]);

  for (const entry of gmMoveLedger) {
    if (entry?.transactionType !== "action") continue;

    if (entry?.tokenId && Number(entry?.spotlightDelta) > 0) {
      tokenKeys.add(String(entry.tokenId));
    }

    for (const grant of sanitizeGrantedSpotlights(entry?.grantedSpotlights)) {
      tokenKeys.add(String(grant.tokenId));
    }
  }

  const tokens = {};
  let valid = true;

  for (const tokenKey of tokenKeys) {
    const turn = getSpotlightUseCount(tokenKey);
    const total = getSpotlightTotalCount(tokenKey);
    const linked = getLinkedSpotlightCount(tokenKey);
    const unlinked = Math.max(0, turn - linked);

    const issues = [];
    if (linked > turn) {
      issues.push(
        `Transaction ledger links ${linked} Spotlight(s), but TURN contains only ${turn}.`
      );
    }
    if (turn > total) {
      issues.push(
        `TURN contains ${turn} Spotlight(s), but TOTAL contains only ${total}.`
      );
    }

    const tokenValid = issues.length === 0;
    if (!tokenValid) valid = false;

    const spotlightLimit = getSpotlightLimit(tokenKey);

    tokens[tokenKey] = {
      turn,
      linked,
      unlinked,
      total,
      limit: spotlightLimit,
      valid: tokenValid,
      issues
    };
  }

  return {
    valid,
    sceneId: spotlightSceneId,
    tokens
  };
}

function adjustSpotlightCounts(tokenKey, delta) {
  if (!tokenKey || !Number(delta)) return;

  const numericDelta = Math.trunc(Number(delta) || 0);
  const nextTurn = Math.max(0, getSpotlightUseCount(tokenKey) + numericDelta);
  const nextTotal = Math.max(0, getSpotlightTotalCount(tokenKey) + numericDelta);

  if (nextTurn > 0) spotlightUses.set(tokenKey, nextTurn);
  else spotlightUses.delete(tokenKey);

  if (nextTotal > 0) spotlightTotals.set(tokenKey, nextTotal);
  else spotlightTotals.delete(tokenKey);
}

async function recordSpotlightUse(tokenKey) {
  if (spotlightOwner !== "GM" || !tokenKey) return false;

  const token = canvas?.tokens?.get(tokenKey)
    ?? (canvas?.tokens?.placeables ?? [])
      .find(candidate => String(candidate?.id) === String(tokenKey))
    ?? null;

  if (token?.actor && isAdversaryDefeated(token)) {
    ui.notifications.warn(
      `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot receive a new Spotlight.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  spotlightUses.set(tokenKey, getSpotlightUseCount(tokenKey) + 1);
  spotlightTotals.set(tokenKey, getSpotlightTotalCount(tokenKey) + 1);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function undoSpotlightUse(tokenKey) {
  if (!tokenKey) return false;

  const currentTurn = getSpotlightUseCount(tokenKey);
  if (currentTurn <= 0) return false;

  const linked = getLinkedSpotlightCount(tokenKey);
  const unlinked = getUnlinkedSpotlightCount(tokenKey);

  if (unlinked <= 0) {
    ui.notifications.warn(
      linked > currentTurn
        ? "This token's Spotlight bookkeeping is inconsistent: the GM Move ledger links more Spotlights than TURN contains. Use the Spotlight integrity diagnostic and GM Move Undo rather than token Undo."
        : "The remaining Spotlight use is linked to a GM Action transaction. Use Undo GM Move to reverse it."
    );
    return false;
  }

  const before = snapshotCombatStateMemory();

  // Token-level Undo removes only one unlinked/manual/granted Spotlight. It
  // never removes the TURN/TOTAL mark owned by a GM Action transaction.
  if (currentTurn === 1) spotlightUses.delete(tokenKey);
  else spotlightUses.set(tokenKey, currentTurn - 1);

  const total = getSpotlightTotalCount(tokenKey);
  if (total <= 1) spotlightTotals.delete(tokenKey);
  else spotlightTotals.set(tokenKey, total - 1);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function removeSpotlightTokenState(tokenDocument) {
  const tokenKey = getTokenStateKey(tokenDocument);
  if (!tokenKey) return false;

  const hadState = spotlightUses.has(tokenKey) || spotlightTotals.has(tokenKey);
  if (!hadState) return false;

  const before = snapshotCombatStateMemory();
  spotlightUses.delete(tokenKey);
  spotlightTotals.delete(tokenKey);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function takeNaturalGmSpotlight() {
  if (spotlightOwner !== "PC") return false;

  const before = snapshotCombatStateMemory();

  spotlightOwner = "GM";
  pendingOpportunity = null;
  pendingRollNotice = null;
  gmEntryMode = "natural";
  gmMovesThisTurn = 0;
  gmMoveLedger.length = 0;
  spotlightUses.clear();

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function takeInterruptGmSpotlight() {
  if (spotlightOwner !== "PC") return false;

  const before = snapshotCombatStateMemory();

  const paid = await spendNativeFear(1, "GM interrupt");
  if (!paid) return false;

  // The interrupt purchase includes the first GM Move.
  spotlightOwner = "GM";
  pendingOpportunity = null;
  pendingRollNotice = null;
  gmEntryMode = "interrupt";
  gmMovesThisTurn = 1;
  gmMoveLedger.length = 0;
  gmMoveLedger.push({
    kind: "interrupt",
    fearCost: 1,
    moveFearCost: 1,
    featureFearCost: 0,
    expectedNativeFearCost: 0,
    transactionType: null,
    executionMode: null,
    executionStatus: null,
    moveStatus: "prepared",
    tokenId: null,
    nativeActionId: null,
    itemId: null,
    actionName: null,
    spotlightDelta: 0,
    grantedSpotlights: []
  });
  spotlightUses.clear();

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    const refunded = await refundNativeFear(1, "failed GM interrupt state save");
    if (!refunded) {
      ui.notifications.error("Combat state save failed and the interrupt Fear refund also failed. Check native Fear manually.");
    }
    return false;
  }

  return true;
}

function getPreparedGmMove() {
  if (spotlightOwner !== "GM" || gmMoveLedger.length <= 0) return null;

  const index = gmMoveLedger.length - 1;
  const entry = gmMoveLedger[index];

  return entry?.moveStatus === "prepared"
    ? { entry, index }
    : null;
}

function getNewGmMoveCost() {
  if (spotlightOwner !== "GM") return null;
  if (gmEntryMode === "natural" && gmMovesThisTurn === 0) return 0;
  return 1;
}

function getNextGmMoveCost() {
  if (spotlightOwner !== "GM") return null;
  if (getPreparedGmMove()) return 0;
  return getNewGmMoveCost();
}

async function recordGmMove() {
  if (spotlightOwner !== "GM") return false;

  if (getPreparedGmMove()) {
    ui.notifications.warn(
      "A GM Move is already prepared. Use it with an Action, complete it as a manual move, or undo it before preparing another."
    );
    return false;
  }

  const fearCost = getNewGmMoveCost();
  if (fearCost === null) return false;

  const before = snapshotCombatStateMemory();

  if (fearCost > 0) {
    const paid = await spendNativeFear(fearCost, "prepare additional GM Move");
    if (!paid) return false;
  }

  gmMovesThisTurn += 1;
  gmMoveLedger.push({
    kind: fearCost === 0 ? "base" : "additional",
    fearCost,
    moveFearCost: fearCost,
    featureFearCost: 0,
    expectedNativeFearCost: 0,
    transactionType: null,
    executionMode: null,
    executionStatus: null,
    moveStatus: "prepared",
    tokenId: null,
    itemId: null,
    nativeActionId: null,
    actionName: null,
    spotlightDelta: 0,
    grantedSpotlights: []
  });

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);

    if (fearCost > 0) {
      const refunded = await refundNativeFear(fearCost, "failed prepared GM Move state save");
      if (!refunded) {
        ui.notifications.error("Combat state save failed and the prepared GM Move Fear refund also failed. Check native Fear manually.");
      }
    }

    return false;
  }

  return true;
}

async function completePreparedGmMoveManually() {
  if (spotlightOwner !== "GM") return false;

  const prepared = getPreparedGmMove();
  if (!prepared) {
    ui.notifications.warn("There is no prepared GM Move to complete manually.");
    return false;
  }

  const before = snapshotCombatStateMemory();

  prepared.entry.moveStatus = "used";
  prepared.entry.executionStatus = "completed";

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function undoGmMove() {
  if (spotlightOwner !== "GM" || gmMoveLedger.length <= 0) return false;

  const last = gmMoveLedger[gmMoveLedger.length - 1];

  // Rolling back the purchased interrupt removes GM Spotlight entirely.
  // A transaction-backed Action has one known associated Spotlight and can
  // reverse it automatically. Any additional/manual Spotlight history remains
  // ambiguous and must be undone first.
  if (last.kind === "interrupt" && gmMoveLedger.length === 1) {
    const totalTokenUses = [...spotlightUses.values()]
      .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);

    const associatedActionUses =
      last.transactionType === "action"
        ? Math.max(0, Number(last.spotlightDelta) || 0)
          + sanitizeGrantedSpotlights(last.grantedSpotlights)
            .reduce((sum, grant) => sum + grant.delta, 0)
        : 0;

    if (totalTokenUses > associatedActionUses) {
      ui.notifications.warn(
        "Undo other current-turn adversary Spotlights before undoing the interrupt."
      );
      return false;
    }
  }

  const before = snapshotCombatStateMemory();
  const undoingNativeExecution = [
    "native-standard",
    "native-embedded",
    "native-effect-remove"
  ].includes(last.executionMode)
    || sanitizeGrantedSpotlights(last.grantedSpotlights).some(grant =>
      ["native-standard", "native-embedded", "native-effect-remove"]
        .includes(grant.executionMode)
    );
  let fearRefunded = false;

  if (last.fearCost > 0) {
    fearRefunded = await refundNativeFear(last.fearCost, "GM Move undo");
    if (!fearRefunded) return false;
  }

  gmMoveLedger.pop();
  gmMovesThisTurn = Math.max(0, gmMovesThisTurn - 1);

  if (
    last.transactionType === "action"
    && last.tokenId
    && Number(last.spotlightDelta) > 0
  ) {
    const delta = Math.max(0, Math.trunc(Number(last.spotlightDelta) || 0));
    adjustSpotlightCounts(last.tokenId, -delta);
  }

  if (last.transactionType === "action") {
    for (const grant of sanitizeGrantedSpotlights(last.grantedSpotlights)) {
      adjustSpotlightCounts(grant.tokenId, -grant.delta);
    }
  }

  if (
    grantModeLedgerIndex !== null
    && grantModeLedgerIndex >= gmMoveLedger.length
  ) {
    grantModeLedgerIndex = null;
  }

  if (last.kind === "interrupt" && gmMoveLedger.length === 0) {
    spotlightOwner = "PC";
    gmEntryMode = null;
    gmMovesThisTurn = 0;
  }

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);

    // Reverse the refund so native Fear and restored ledger remain aligned.
    if (fearRefunded && last.fearCost > 0) {
      const respent = await spendNativeFear(last.fearCost, "failed GM Move undo state save");
      if (!respent) {
        ui.notifications.error("Combat state save failed and the Fear rollback also failed. Check native Fear manually.");
      }
    }

    return false;
  }

  if (undoingNativeExecution) {
    const conditionRemoval =
      last.executionMode === "native-effect-remove"
      || sanitizeGrantedSpotlights(last.grantedSpotlights)
        .some(grant => grant.executionMode === "native-effect-remove");

    ui.notifications.warn(
      conditionRemoval
        ? "QOL Undo reversed the GM Move, QOL-owned Fear, and Spotlight bookkeeping only. A native condition/effect already removed from the Actor was not restored."
        : last.transactionType === "environment-action"
          ? "QOL Undo reversed the Environment GM Move and QOL-owned Fear. No adversary Spotlight was changed. Native Daggerheart costs, chat, rolls, damage, uses, and effects were not reversed."
          : "QOL Undo reversed the GM Move, QOL-owned Fear, and recorded Spotlight only. Native Daggerheart costs, chat, rolls, damage, uses, and effects were not reversed."
    );
  }

  return true;
}

async function endGmTurn() {
  const before = snapshotCombatStateMemory();

  spotlightUses.clear();
  gmMovesThisTurn = 0;
  gmMoveLedger.length = 0;
  reactionLedger.length = 0;
  gmEventSequence = 0;
  grantModeLedgerIndex = null;
  pendingOpportunity = null;
  pendingRollNotice = null;
  gmEntryMode = null;
  spotlightOwner = "PC";

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function resetInspectorCombatState() {
  const scene = canvas?.scene;
  if (!scene) return false;

  try {
    // Write the v1 tombstone before removing current state so stale pre-v1
    // data can never reappear after Reset.
    await markLegacyCombatStateMigrationComplete(scene);
    await scene.unsetFlag(MODULE_ID, COMBAT_STATE_FLAG);
    resetCombatStateInMemory(scene.id);
    refreshInspector();
    ui.notifications.info("Cybermancy GM QOL combat state reset for this Scene. Native Fear was not changed.");
    return true;
  } catch (error) {
    console.error("Cybermancy GM QOL | Failed to reset Scene combat state", error);
    ui.notifications.error("Cybermancy GM QOL combat state could not be reset.");
    return false;
  }
}

function confirmResetInspectorCombatState() {
  if (!game.user?.isGM || !canvas?.scene) return;

  new Dialog({
    title: "Reset QOL Combat State?",
    content: `
      <p>This clears the Cybermancy GM QOL state saved on <strong>${escapeHtml(canvas.scene.name)}</strong>:</p>
      <ul>
        <li>Spotlight owner and entry mode</li>
        <li>GM Move history for the current turn</li>
        <li>Reaction/non-Spotlight event history</li>
        <li>TURN Spotlight counts</li>
        <li>TOTAL Spotlight counts</li>
      </ul>
      <p><strong>Native Daggerheart Fear is not changed or refunded.</strong></p>
    `,
    buttons: {
      reset: {
        icon: '<i class="fa-solid fa-rotate-left"></i>',
        label: "Reset State",
        callback: () => resetInspectorCombatState()
      },
      cancel: {
        label: "Cancel"
      }
    },
    default: "cancel"
  }).render(true);
}

function getPersistedCombatStateDiagnostic(scene = canvas?.scene) {
  if (!scene) {
    return {
      raw: null,
      parsed: null,
      scope: MODULE_ID,
      legacyScope: false
    };
  }

  const flagRecord = getCombatStateFlagRecord(scene);

  return {
    raw: flagRecord.raw,
    parsed: parsePersistedCombatState(flagRecord.raw),
    scope: flagRecord.scope,
    legacyScope: flagRecord.legacyScope,
    legacyMigrationComplete: flagRecord.legacyMigrationComplete
  };
}

function getArchitectureDiagnostic() {
  return {
    version: VERSION,
    combatStateSchema: COMBAT_STATE_SCHEMA_VERSION,
    runtime: "generated-single-esmodule-bundle",
    sourceModules: [
      "00-preamble.js",
      "10-fear.js",
      "20-state.js",
      "30-opportunities.js",
      "40-environments.js",
      "50-adversaries.js",
      "52-pcs.js",
      "60-actions.js",
      "65-environment-actions.js",
      "67-reactions.js",
      "68-combat-state.js",
      "68-writeback.js",
      "69-compatibility.js",
      "70-rendering.js",
      "80-window.js",
      "90-hooks.js"
    ],
    opportunityRuntime: "daggerheart.postRollDuality",
    opportunityClassifier: "classifyOpportunityOutcome",
    chatRole: "enrichment-only",
    environmentCardsCollapsible: true,
    environmentActionTransactions: true,
    environmentActionsUseAdversarySpotlight: false,
    reactionTransactions: true,
    reactionsUseGmMove: false,
    reactionsUseAdversarySpotlight: false,
    nativeCombatStateHud: true,
    conditionClearTransactions: true,
    hiddenRemovalUsesGmMove: false,
    compatibilityResolution: true,
    compatibilityReport: true,
    diagnosticDisplayToggle: true,
    compactQolLayout: true,
    fastPlayCollapsible: true,
    directNativeWriteback: true,
    fearDotWriteback: true,
    hpStressWriteback: true,
    conditionToggleWriteback: true,
    scenePcRoster: true,
    pcNativeWriteback: true,
    pcArmorSlotsReadout: true,
    pcEmbeddedItemRefresh: true,
    pcNameTokenFocus: true,
    collapsiblePcSection: true,
    compactRemainingTransactionDialogs: true,
    runtimeDiagnostics: true,
    manualFearBidirectionalControl: true,
    pcEvasionReadout: true,
    pcOptionalStateRenderGuard: true,
    canonicalModuleId: MODULE_ID,
    legacyModuleId: LEGACY_MODULE_ID,
    legacyFlagMigration: true,
    legacyFlagRawRead: true,
    legacyMigrationTombstone: true,
    legacyGlobalApiAlias: true,
    deadPresentationCodePruned: true,
    schemaStableV1: true,
    qolWritesUseGmMove: false,
    qolWritesUseSpotlight: false,
    proseParsing: false
  };
}

function getSpotlightState() {
  return {
    persistence: "scene-flag-json-snapshot",
    flagPath: `flags.${MODULE_ID}.${COMBAT_STATE_FLAG}`,
    legacyFlagPath: `flags.${LEGACY_MODULE_ID}.${COMBAT_STATE_FLAG}`,
    format: COMBAT_STATE_FORMAT,
    schemaVersion: COMBAT_STATE_SCHEMA_VERSION,
    revision: combatStateRevision,
    owner: spotlightOwner,
    pendingOpportunity: getPendingOpportunity(),
    pendingRollNotice: getPendingRollNotice(),
    entryMode: gmEntryMode,
    sceneId: spotlightSceneId,
    loaded: combatStateLoaded,
    writePending: combatStateWritePending,
    gmMovesThisTurn,
    preparedMove: getPreparedGmMove()
      ? { index: getPreparedGmMove().index, ...getPreparedGmMove().entry }
      : null,
    nextGmMoveFearCost: getNextGmMoveCost(),
    nextActionGmMoveFearCost: getNextGmMoveCost(),
    newGmMoveFearCost: getNewGmMoveCost(),
    gmMoveLedger: gmMoveLedger.map(entry => ({
      ...entry,
      grantedSpotlights: sanitizeGrantedSpotlights(entry.grantedSpotlights)
    })),
    reactionLedger: sanitizeReactionLedger(reactionLedger),
    latestReaction: getLatestReactionWithIndex()
      ? foundry.utils.deepClone(getLatestReactionWithIndex())
      : null,
    gmEventSequence,
    grantMode: getGrantModeTransaction()
      ? {
          ledgerIndex: getGrantModeTransaction().index,
          actionName: getGrantModeTransaction().entry.actionName
        }
      : null,
    turnUses: Object.fromEntries(spotlightUses),
    totalUses: Object.fromEntries(spotlightTotals),
    spotlightIntegrity: getSpotlightIntegrity()
  };
}

/* -------------------------------------------- */
/*  Scene / Adversary Discovery                 */
/* -------------------------------------------- */

// ===== 30-opportunities.js =====
function sanitizePendingRollNotice(value) {
  if (!value || typeof value !== "object") return null;
  const reason = value.reason ? String(value.reason) : null;
  if (!reason || !reason.startsWith("NO RESULT")) return null;

  return {
    actorUuid: value.actorUuid ? String(value.actorUuid) : null,
    actorName: value.actorName ? String(value.actorName) : "PC",
    actionType: value.actionType ? String(value.actionType) : null,
    sourceKey: value.sourceKey ? String(value.sourceKey) : null,
    reason,
    createdAt: Math.max(0, Number(value.createdAt) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}

function getPendingRollNotice() {
  return pendingRollNotice
    ? foundry.utils.deepClone(pendingRollNotice)
    : null;
}

async function dismissPendingRollNotice() {
  if (!pendingRollNotice) return false;
  const before = snapshotCombatStateMemory();
  pendingRollNotice = null;

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  refreshInspector();
  return true;
}

async function setPendingRollNoticeFromDiagnostic(diagnostic) {
  if (!diagnostic?.reason?.startsWith?.("NO RESULT")) return false;

  const before = snapshotCombatStateMemory();
  const now = Date.now();

  pendingRollNotice = sanitizePendingRollNotice({
    actorUuid: diagnostic.actorUuid,
    actorName: diagnostic.actorName,
    actionType: diagnostic.actionType,
    sourceKey: diagnostic.sourceKey,
    reason: diagnostic.reason,
    createdAt:
      pendingRollNotice?.sourceKey
      && diagnostic.sourceKey
      && pendingRollNotice.sourceKey === diagnostic.sourceKey
        ? pendingRollNotice.createdAt
        : now,
    updatedAt: now
  });

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  refreshInspector();
  return true;
}

async function dismissPendingOpportunityAndRollNotice() {
  if (!pendingOpportunity && !pendingRollNotice) return false;
  const before = snapshotCombatStateMemory();
  pendingOpportunity = null;
  pendingRollNotice = null;

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  refreshInspector();
  return true;
}

function inspectNativeDualityOpportunity(config) {
  if (!config || typeof config !== "object") {
    return {
      recognized: false,
      qualifies: false,
      reason: "No Daggerheart Duality Roll configuration was supplied."
    };
  }

  const roll = config.roll ?? {};
  const duality = Number(roll?.result?.duality);

  if (!Number.isFinite(duality) || ![-1, 0, 1].includes(duality)) {
    return {
      recognized: false,
      qualifies: false,
      reason: "Structured Duality result is unavailable."
    };
  }

  const actionType = String(config.actionType ?? roll.type ?? "").toLowerCase();
  const reactionId = String(
    CONFIG?.DH?.ITEM?.actionTypes?.reaction?.id ?? "reaction"
  ).toLowerCase();

  if (actionType === reactionId || actionType === "reaction") {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: false,
      qualifies: false,
      actionType,
      reason: "Reaction Roll; not a PC Action Roll opportunity."
    };
  }

  if (config.tagTeamSelected) {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: false,
      qualifies: false,
      actionType,
      reason: "Tag Team Roll; ignored by v0.18.2 opportunity detection."
    };
  }

  const actorUuid = config?.source?.actor ? String(config.source.actor) : null;
  let actor = null;

  if (actorUuid && typeof fromUuidSync === "function") {
    try {
      actor = fromUuidSync(actorUuid);
    } catch (error) {
      console.warn(
        "Cybermancy GM QOL | Native Duality source Actor resolution failed",
        actorUuid,
        error
      );
    }
  }

  const pcSide = isPcSideOpportunityActor(actor);
  if (!pcSide) {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: true,
      qualifies: false,
      actorUuid,
      actorName: actor?.name ?? null,
      actionType,
      reason: "Roll source is not a confidently identified PC-side Actor."
    };
  }

  const targets = Array.isArray(config.targets) ? config.targets : [];
  const hasRollSuccess = Object.prototype.hasOwnProperty.call(roll, "success");
  const hasTargetEvidence = targets.length > 0;

  if (!hasRollSuccess && !hasTargetEvidence) {
    return {
      recognized: true,
      pcSide: true,
      actionRoll: false,
      qualifies: false,
      actorUuid,
      actorName: actor?.name ?? "PC",
      actionType,
      sourceKey: buildOpportunitySourceKey(config.source),
      reason: "NO RESULT — Duality Roll has no structured success/target-hit evidence. Select a target or supply a difficulty so Daggerheart can determine success/failure."
    };
  }

  // Mirrors Daggerheart 1.2.7 postRollDuality spotlight calculation.
  const success =
    Boolean(hasRollSuccess && roll.success)
    || targets.some(target => target?.hit === true);

  const isCritical = Boolean(roll.isCritical) || duality === 0;
  const classification = classifyOpportunityOutcome({
    duality,
    success,
    isCritical
  });

  return {
    recognized: true,
    pcSide: true,
    actionRoll: true,
    ...classification,
    actorUuid: actor?.uuid ?? actorUuid,
    actorName: actor?.name ?? "PC",
    actionType,
    duality,
    success,
    isCritical,
    sourceKey: buildOpportunitySourceKey(config.source),
    reroll: Boolean(config.rerolledRoll)
  };
}

async function processNativeDualityOpportunity(config) {
  // This listener is observational only. Daggerheart owns Hope/Fear generation.
  if (!game.user?.isGM) return false;
  if (!canvas?.scene || spotlightOwner !== "PC") return false;

  const diagnostic = inspectNativeDualityOpportunity(config);
  if (!diagnostic.recognized || !diagnostic.pcSide) return false;

  // Surface unresolved PC rolls as information, not as a GM Opportunity.
  if (diagnostic.reason?.startsWith?.("NO RESULT")) {
    return setPendingRollNoticeFromDiagnostic(diagnostic);
  }

  const sameActorAsPending =
    pendingOpportunity?.actorUuid
    && diagnostic.actorUuid
    && String(pendingOpportunity.actorUuid) === String(diagnostic.actorUuid);

  const sameSourceAsPending =
    pendingOpportunity?.sourceKey
    && diagnostic.sourceKey
      ? String(pendingOpportunity.sourceKey) === String(diagnostic.sourceKey)
      : sameActorAsPending;

  // Prefer the exact structured action source (Actor + Item + Action) for
  // reroll correlation. Actor-only fallback is retained for roll types where
  // Daggerheart does not supply Item/Action identifiers.
  if (diagnostic.reroll && sameSourceAsPending && !diagnostic.qualifies) {
    return dismissPendingOpportunityAndRollNotice();
  }

  // A later resolved roll supersedes any prior NO RESULT notice.
  if (!diagnostic.qualifies) {
    return pendingRollNotice
      ? dismissPendingRollNotice()
      : false;
  }

  const before = snapshotCombatStateMemory();
  pendingRollNotice = null;
  const now = Date.now();
  const rerollOfCurrentOpportunity =
    diagnostic.reroll && sameSourceAsPending && Boolean(pendingOpportunity);

  nativeOpportunitySequence += 1;

  const messageId = rerollOfCurrentOpportunity
    ? pendingOpportunity.messageId
    : `native-duality:${now}:${nativeOpportunitySequence}`;

  const priorCount = pendingOpportunity?.observedCount ?? 0;

  pendingOpportunity = sanitizePendingOpportunity({
    messageId,
    actorUuid: diagnostic.actorUuid,
    actorName: diagnostic.actorName,
    outcome: diagnostic.outcome,
    moveWeight: diagnostic.moveWeight,
    outcomeLabel: diagnostic.outcomeLabel,
    sourceSignature: [
      "native-duality",
      messageId,
      diagnostic.sourceKey ?? diagnostic.actorUuid ?? "unknown",
      diagnostic.outcome,
      diagnostic.success ? "success" : "failure",
      diagnostic.duality
    ].join(":"),
    sourceKey: diagnostic.sourceKey,
    speakerSceneId: canvas?.scene?.id ?? null,
    detectionSource: "native",
    observedCount: rerollOfCurrentOpportunity
      ? Math.max(1, priorCount)
      : priorCount + 1,
    createdAt: rerollOfCurrentOpportunity
      ? pendingOpportunity?.createdAt ?? now
      : now,
    updatedAt: now
  });

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  // Environment rendering is isolated separately; this refresh must be allowed
  // to surface the newly persisted opportunity even when an Environment is bad.
  refreshInspector();
  return true;
}

function resolveOpportunityMessage(messageOrId) {
  if (!messageOrId) return null;
  if (typeof messageOrId === "object") return messageOrId;
  return game.messages?.get?.(String(messageOrId)) ?? null;
}

function resolveOpportunityActor(message) {
  const actorUuid = message?.system?.source?.actor;
  if (!actorUuid || typeof fromUuidSync !== "function") return null;

  try {
    return fromUuidSync(actorUuid);
  } catch (error) {
    console.warn(
      "Cybermancy GM QOL | Could not resolve Action Roll source Actor",
      actorUuid,
      error
    );
    return null;
  }
}

function isPcSideOpportunityActor(actor) {
  if (!actor) return false;

  // Never classify an adversary/environment as PC-side even if permissions are
  // unusual. Character Actors count as PCs; other player-owned Actor types
  // allow player-controlled companions/Primary Drones to participate safely.
  if (isAdversaryActor(actor) || actor.type === "environment") return false;

  return actor.type === "character" || actor.hasPlayerOwner === true;
}

function getRollSuccessEvidence(system) {
  const roll = system?.roll ?? {};
  const targets = Array.isArray(system?.targets)
    ? system.targets
    : [];

  const hasRollSuccess = Object.prototype.hasOwnProperty.call(
    roll,
    "success"
  );

  const hasTargetEvidence = targets.length > 0;

  if (!hasRollSuccess && !hasTargetEvidence) {
    return {
      available: false,
      success: null,
      hasRollSuccess,
      hasTargetEvidence
    };
  }

  // Mirrors Daggerheart 1.2.7's native spotlight result:
  // config.roll.success || config.targets.some(t => t.hit)
  const success =
    Boolean(hasRollSuccess && roll.success)
    || targets.some(target => target?.hit === true);

  return {
    available: true,
    success,
    hasRollSuccess,
    hasTargetEvidence
  };
}

function buildOpportunitySignature(message, {
  duality,
  success,
  isCritical,
  actionType
}) {
  return [
    String(message?.id ?? message?._id ?? ""),
    String(duality),
    success ? "S" : "F",
    isCritical ? "C" : "N",
    String(actionType ?? "")
  ].join(":");
}

function inspectRollOpportunity(messageOrId) {
  const message = resolveOpportunityMessage(messageOrId);

  if (!message) {
    return {
      recognized: false,
      qualifies: false,
      reason: "ChatMessage not found."
    };
  }

  const messageId = String(message.id ?? message._id ?? "");
  const system = message.system ?? {};
  const roll = system.roll ?? {};
  const duality = Number(roll?.result?.duality);
  const isDualityRoll =
    message.type === "dualityRoll"
    && Number.isFinite(duality)
    && [-1, 0, 1].includes(duality);

  if (!isDualityRoll) {
    return {
      recognized: false,
      qualifies: false,
      messageId,
      reason: "Not a structured Daggerheart Duality Roll."
    };
  }

  const actionType = String(
    system.actionType
    ?? roll.type
    ?? ""
  ).toLowerCase();

  const reactionId = String(
    CONFIG?.DH?.ITEM?.actionTypes?.reaction?.id
    ?? "reaction"
  ).toLowerCase();

  const reaction = actionType === reactionId || actionType === "reaction";
  if (reaction) {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: false,
      qualifies: false,
      messageId,
      actionType,
      reason: "Reaction Roll; not a PC Action Roll opportunity."
    };
  }

  if (system.tagTeamSelected) {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: false,
      qualifies: false,
      messageId,
      actionType,
      reason: "Tag Team Roll; ignored by v0.17 opportunity detection."
    };
  }

  const actor = resolveOpportunityActor(message);
  const pcSide = isPcSideOpportunityActor(actor);

  if (!pcSide) {
    return {
      recognized: true,
      pcSide: false,
      actionRoll: true,
      qualifies: false,
      messageId,
      actorUuid: system?.source?.actor ?? null,
      actorName: actor?.name ?? null,
      actionType,
      reason: "Roll source is not a confidently identified PC-side Actor."
    };
  }

  const successEvidence = getRollSuccessEvidence(system);
  if (!successEvidence.available) {
    return {
      recognized: true,
      pcSide: true,
      actionRoll: false,
      qualifies: false,
      messageId,
      actorUuid: actor.uuid ?? system?.source?.actor ?? null,
      actorName: actor.name ?? "PC",
      actionType,
      sourceKey: buildOpportunitySourceKey(system.source),
      reason: "NO RESULT — Duality Roll has no structured success/target-hit evidence. Select a target or supply a difficulty so Daggerheart can determine success/failure."
    };
  }

  const isCritical = Boolean(roll.isCritical) || duality === 0;
  const success = successEvidence.success;
  const classification = classifyOpportunityOutcome({
    duality,
    success,
    isCritical
  });

  const speakerSceneId = message?.speaker?.scene
    ? String(message.speaker.scene)
    : null;
  const currentSceneId = canvas?.scene?.id
    ? String(canvas.scene.id)
    : null;
  const sceneMatchesCurrent =
    !speakerSceneId
    || !currentSceneId
    || speakerSceneId === currentSceneId;

  const sourceSignature = buildOpportunitySignature(message, {
    duality,
    success,
    isCritical,
    actionType
  });

  return {
    recognized: true,
    pcSide: true,
    actionRoll: true,
    ...classification,
    messageId,
    actorUuid: actor.uuid ?? system?.source?.actor ?? null,
    actorName: actor.name ?? "PC",
    actionType,
    duality,
    success,
    isCritical,
    sceneMatchesCurrent,
    speakerSceneId,
    currentSceneId,
    sourceSignature,
    sourceKey: buildOpportunitySourceKey(system.source),
    reason: sceneMatchesCurrent
      ? null
      : "Roll belongs to a different Scene than the current QOL Scene."
  };
}

async function enrichPendingOpportunityFromMessage(message) {
  if (!game.user?.isGM || !pendingOpportunity || spotlightOwner !== "PC") {
    return false;
  }

  const diagnostic = inspectRollOpportunity(message);
  if (
    !diagnostic.recognized
    || !diagnostic.pcSide
    || !diagnostic.actionRoll
    || !diagnostic.qualifies
    || diagnostic.sceneMatchesCurrent === false
  ) {
    return false;
  }

  const actorMatches =
    pendingOpportunity.actorUuid
    && diagnostic.actorUuid
    && String(pendingOpportunity.actorUuid) === String(diagnostic.actorUuid);

  const sourceMatches =
    pendingOpportunity.sourceKey
    && diagnostic.sourceKey
      ? String(pendingOpportunity.sourceKey) === String(diagnostic.sourceKey)
      : actorMatches;

  if (
    !sourceMatches
    || pendingOpportunity.outcome !== diagnostic.outcome
  ) {
    return false;
  }

  const realMessageId = diagnostic.messageId;
  const speakerSceneId = diagnostic.speakerSceneId ?? canvas?.scene?.id ?? null;

  if (
    pendingOpportunity.messageId === realMessageId
    && pendingOpportunity.speakerSceneId === speakerSceneId
    && pendingOpportunity.detectionSource === "native+chat"
  ) {
    return false;
  }

  const before = snapshotCombatStateMemory();

  pendingOpportunity = sanitizePendingOpportunity({
    ...pendingOpportunity,
    messageId: realMessageId,
    sourceSignature: diagnostic.sourceSignature,
    sourceKey: diagnostic.sourceKey ?? pendingOpportunity.sourceKey,
    speakerSceneId,
    detectionSource: "native+chat",
    updatedAt: Date.now()
  });

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  refreshInspector();
  return true;
}


function getPendingOpportunity() {
  return pendingOpportunity
    ? foundry.utils.deepClone(pendingOpportunity)
    : null;
}

async function dismissPendingOpportunity() {
  if (!pendingOpportunity) return false;

  const before = snapshotCombatStateMemory();
  pendingOpportunity = null;

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

async function processRollOpportunity(message) {
  // All clients observe ChatMessage hooks; only a GM may persist Inspector
  // Scene state. No Fear is read, generated, or changed here.
  if (!game.user?.isGM) return false;
  if (!canvas?.scene || spotlightOwner !== "PC") return false;

  const diagnostic = inspectRollOpportunity(message);
  if (!diagnostic.recognized || !diagnostic.pcSide) return false;
  if (!diagnostic.sceneMatchesCurrent) return false;

  const samePendingMessage =
    pendingOpportunity?.messageId
    && pendingOpportunity.messageId === diagnostic.messageId;

  // A reroll/update of the same ChatMessage can remove a previously detected
  // opportunity. Do not leave stale failure/Fear state behind.
  if (samePendingMessage && !diagnostic.qualifies) {
    return dismissPendingOpportunity();
  }

  if (!diagnostic.qualifies) return false;

  // createChatMessage and updateChatMessage can both surface the same settled
  // result. Do not increment or rewrite state for an identical signature.
  if (
    samePendingMessage
    && pendingOpportunity?.sourceSignature === diagnostic.sourceSignature
  ) {
    return false;
  }

  const before = snapshotCombatStateMemory();
  const now = Date.now();
  const priorCount = pendingOpportunity?.observedCount ?? 0;

  pendingOpportunity = sanitizePendingOpportunity({
    messageId: diagnostic.messageId,
    actorUuid: diagnostic.actorUuid,
    actorName: diagnostic.actorName,
    outcome: diagnostic.outcome,
    moveWeight: diagnostic.moveWeight,
    outcomeLabel: diagnostic.outcomeLabel,
    sourceSignature: diagnostic.sourceSignature,

    // A reroll of the SAME PC Action updates the opportunity rather than
    // counting as a second qualifying Action.
    observedCount: samePendingMessage
      ? Math.max(1, priorCount)
      : priorCount + 1,

    createdAt: samePendingMessage
      ? pendingOpportunity?.createdAt ?? now
      : now,
    updatedAt: now
  });

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  refreshInspector();
  return true;
}

// ===== 40-environments.js =====
function isEnvironmentActor(actor) {
  return actor?.type === "environment";
}

function normalizeEnvironmentLinks(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];

  for (const raw of value) {
    if (!raw) continue;
    const uuid = String(raw).trim();
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    result.push(uuid);
  }

  return result;
}

function getEnvironmentLinks(scene = canvas?.scene) {
  if (!scene) return [];

  return normalizeEnvironmentLinks(
    scene.getFlag?.(ENVIRONMENT_FLAG_NAMESPACE, ENVIRONMENT_FLAG_KEY)
      ?? scene.flags?.[ENVIRONMENT_FLAG_NAMESPACE]?.[ENVIRONMENT_FLAG_KEY]
      ?? []
  );
}

function resolveEnvironmentActorUuid(uuid) {
  if (!uuid || typeof fromUuidSync !== "function") return null;

  try {
    const document = fromUuidSync(String(uuid));
    return isEnvironmentActor(document) ? document : null;
  } catch (error) {
    console.warn(
      "Cybermancy GM QOL | Could not resolve linked Environment Actor",
      uuid,
      error
    );
    return null;
  }
}

function getEnvironmentActorUuidForToken(token) {
  if (!token) return null;

  const worldActor = token.document?.actorId
    ? game.actors?.get?.(token.document.actorId)
    : null;

  const actor = worldActor ?? token.actor ?? null;
  return isEnvironmentActor(actor) ? actor.uuid ?? null : null;
}

function getSceneEnvironments(scene = canvas?.scene) {
  const sceneId = scene?.id ?? null;
  const linkedUuids = getEnvironmentLinks(scene);
  const linkedSet = new Set(linkedUuids);
  const effective = [];
  const byUuid = new Map();

  // Explicit links are authoritative and retain their stored order, including
  // unresolved/broken UUIDs. Nothing is silently repaired or removed.
  for (const uuid of linkedUuids) {
    const actor = resolveEnvironmentActorUuid(uuid);
    const record = {
      uuid,
      actor,
      actorId: actor?.id ?? null,
      name: actor?.name ?? null,
      source: "linked",
      linked: true,
      tokenDetected: false,
      tokenIds: [],
      resolved: Boolean(actor),
      issue: actor ? null : "The linked Actor could not be resolved as an Environment."
    };

    effective.push(record);
    byUuid.set(uuid, record);
  }

  const tokenDetected = [];
  const seenTokenUuids = new Set();

  for (const token of canvas?.tokens?.placeables ?? []) {
    if (!isEnvironmentActor(token?.actor)) continue;

    const uuid = getEnvironmentActorUuidForToken(token);
    if (!uuid) continue;

    let tokenRecord = tokenDetected.find(record => record.uuid === uuid);

    if (!tokenRecord) {
      const actor = resolveEnvironmentActorUuid(uuid)
        ?? game.actors?.get?.(token.document?.actorId)
        ?? token.actor;

      tokenRecord = {
        uuid,
        actor,
        actorId: actor?.id ?? null,
        name: actor?.name ?? token.name ?? "Environment",
        source: linkedSet.has(uuid) ? "linked" : "token",
        linked: linkedSet.has(uuid),
        tokenDetected: true,
        tokenIds: [],
        resolved: Boolean(actor),
        issue: null
      };

      tokenDetected.push(tokenRecord);
    }

    if (!tokenRecord.tokenIds.includes(token.id)) {
      tokenRecord.tokenIds.push(token.id);
    }

    seenTokenUuids.add(uuid);

    const existing = byUuid.get(uuid);
    if (existing) {
      existing.tokenDetected = true;
      existing.tokenIds = [...tokenRecord.tokenIds];
      existing.actor ??= tokenRecord.actor;
      existing.actorId ??= tokenRecord.actorId;
      existing.name ??= tokenRecord.name;
      existing.resolved = Boolean(existing.actor);
      existing.issue = existing.actor ? null : existing.issue;
      continue;
    }

    effective.push(tokenRecord);
    byUuid.set(uuid, tokenRecord);
  }

  return {
    sceneId,
    links: [...linkedUuids],
    linked: effective.filter(record => record.linked),
    tokenDetected,
    effective
  };
}

async function linkEnvironmentUuid(uuid) {
  const scene = canvas?.scene;
  if (!game.user?.isGM || !scene || !uuid) return false;

  const actor = resolveEnvironmentActorUuid(uuid);
  if (!actor) {
    ui.notifications.warn(
      "Only a resolvable Environment Actor can be linked to the Scene."
    );
    return false;
  }

  const current = getEnvironmentLinks(scene);
  if (current.includes(String(uuid))) return false;

  const next = [...current, String(uuid)];

  try {
    await scene.setFlag(
      ENVIRONMENT_FLAG_NAMESPACE,
      ENVIRONMENT_FLAG_KEY,
      next
    );
    refreshInspector();
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Failed to link Environment",
      uuid,
      error
    );
    ui.notifications.error("The Environment could not be linked to this Scene.");
    return false;
  }
}

async function unlinkEnvironmentUuid(uuid) {
  const scene = canvas?.scene;
  if (!game.user?.isGM || !scene || !uuid) return false;

  const current = getEnvironmentLinks(scene);
  const next = current.filter(entry => entry !== String(uuid));

  if (next.length === current.length) return false;

  try {
    if (next.length) {
      await scene.setFlag(
        ENVIRONMENT_FLAG_NAMESPACE,
        ENVIRONMENT_FLAG_KEY,
        next
      );
    } else {
      await scene.unsetFlag(
        ENVIRONMENT_FLAG_NAMESPACE,
        ENVIRONMENT_FLAG_KEY
      );
    }

    refreshInspector();
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Failed to unlink Environment",
      uuid,
      error
    );
    ui.notifications.error("The Environment link could not be removed.");
    return false;
  }
}

function showLinkEnvironmentDialog() {
  if (!game.user?.isGM || !canvas?.scene) return;

  const linked = new Set(getEnvironmentLinks());
  const environments = [...(game.actors ?? [])]
    .filter(isEnvironmentActor)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  if (!environments.length) {
    ui.notifications.warn("No world Environment Actors are available to link.");
    return;
  }

  const options = environments.map(actor => `
    <option value="${escapeHtml(actor.uuid)}"
            ${linked.has(actor.uuid) ? "disabled" : ""}>
      ${escapeHtml(actor.name)}
      ${linked.has(actor.uuid) ? " — already linked" : ""}
    </option>
  `).join("");

  new Dialog({
    title: "Link Environment to Scene",
    content: `
      <form>
        <div class="form-group">
          <label>Environment</label>
          <select name="environmentUuid">
            ${options}
          </select>
        </div>
        <p class="notes">
          This writes only
          <code>flags.${ENVIRONMENT_FLAG_NAMESPACE}.${ENVIRONMENT_FLAG_KEY}</code>
          on the current Scene.
        </p>
      </form>
    `,
    buttons: {
      link: {
        icon: '<i class="fa-solid fa-link"></i>',
        label: "Link",
        callback: html => {
          const uuid =
            html?.find?.('[name="environmentUuid"]')?.val?.()
            ?? html?.[0]?.querySelector?.('[name="environmentUuid"]')?.value
            ?? html?.querySelector?.('[name="environmentUuid"]')?.value
            ?? null;

          if (uuid) linkEnvironmentUuid(uuid);
        }
      },
      cancel: {
        label: "Cancel"
      }
    },
    default: "link"
  }).render(true);
}

// ===== 50-adversaries.js =====
function isAdversaryActor(actor) {
  if (!actor) return false;
  if (actor.type === "adversary") return true;

  const role = String(actor.system?.type ?? "").toLowerCase();
  return [
    "minion", "standard", "bruiser", "horde", "leader",
    "skulk", "social", "solo", "support"
  ].includes(role);
}

function normalizeSpotlightLimit(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  const integer = Math.trunc(numeric);
  if (integer < 1 || integer !== numeric) return null;

  return integer;
}

function getActorSpotlightLimitSourceKeys(actor) {
  if (!actor) return [];

  const keys = [
    actor?._stats?.compendiumSource,
    foundry.utils.getProperty(actor, "flags.core.sourceId"),
    foundry.utils.getProperty(actor, "_source.flags.core.sourceId"),
    actor?.uuid?.startsWith?.("Compendium.") ? actor.uuid : null
  ];

  return [...new Set(
    keys
      .map(value => value ? String(value) : null)
      .filter(Boolean)
  )];
}

function getExplicitActorSpotlightLimit(actor) {
  if (!actor) return { present: false, raw: undefined };

  const direct = foundry.utils.getProperty(
    actor,
    "flags.cybermancy.spotlightLimit"
  );

  if (direct !== undefined && direct !== null) {
    return { present: true, raw: direct };
  }

  const source = foundry.utils.getProperty(
    actor,
    "_source.flags.cybermancy.spotlightLimit"
  );

  if (source !== undefined && source !== null) {
    return { present: true, raw: source };
  }

  return { present: false, raw: undefined };
}

function resolveActorSpotlightLimit(actor) {
  const resolved = getSpotlightLimitCompatibility(actor);

  return {
    limit: resolved.limit,
    source:
      resolved.source === "CYBERMANCY"
        ? "cybermancy"
        : resolved.source === "NATIVE"
          ? "native"
          : resolved.source === "SIDECAR"
            ? "srd"
            : "default",
    sourceLabel: resolved.source,
    sourceKey: resolved.sourceKey ?? null,
    reason: resolved.reason ?? null
  };
}

function resolveSpotlightLimitToken(tokenOrId) {
  if (!tokenOrId) return null;

  if (typeof tokenOrId === "object") {
    if (tokenOrId.actor) return tokenOrId;
    if (tokenOrId.document?.actor) return tokenOrId;
  }

  const tokenId = String(tokenOrId);

  return canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(
      candidate => String(candidate?.id) === tokenId
    )
    ?? null;
}

function getSpotlightLimit(tokenOrId) {
  const token = resolveSpotlightLimitToken(tokenOrId);
  const tokenId = token?.id
    ?? token?.document?.id
    ?? (typeof tokenOrId === "string" ? tokenOrId : null);

  if (!token?.actor) {
    return {
      available: false,
      tokenId,
      limit: 1,
      source: "default",
      sourceLabel: "DEFAULT",
      sourceKey: null,
      turn: tokenId ? getSpotlightUseCount(tokenId) : 0,
      remaining: null,
      reached: false,
      exceeded: false,
      overBy: 0,
      reason: "The exact Scene token could not be resolved."
    };
  }

  const resolved = resolveActorSpotlightLimit(token.actor);
  const turn = getSpotlightUseCount(tokenId);
  const remaining = Math.max(0, resolved.limit - turn);
  const overBy = Math.max(0, turn - resolved.limit);

  return {
    available: true,
    tokenId,
    actorId: token.actor?.id ?? null,
    actorName: token.actor?.name ?? null,
    ...resolved,
    turn,
    remaining,
    reached: turn === resolved.limit,
    exceeded: turn > resolved.limit,
    overBy
  };
}

function tokenGroupKey(token) {
  return token?.document?.actorId
    ?? token?.actor?.id
    ?? token?.actor?.name
    ?? token?.id;
}

function getFastPlay(actor) {
  return actor?.getFlag?.("cybermancy", "fastPlay")
    ?? actor?.flags?.cybermancy?.fastPlay
    ?? null;
}

function getGmActionMetadata(item) {
  return item?.getFlag?.("cybermancy", "gmAction")
    ?? item?.flags?.cybermancy?.gmAction
    ?? null;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function getSelectedToken() {
  return canvas?.tokens?.controlled?.[0] ?? null;
}

function resetInspectorSessionState() {
  expandedGroups.clear();
  expandedEnvironments.clear();
  collapsedFastPlay.clear();
  pcSectionCollapsed = false;
  inspectorDiagnosticsVisible = false;
  grantModeLedgerIndex = null;
  inspectorSceneId = canvas?.scene?.id ?? null;
}

function syncSceneSessionState() {
  const sceneId = canvas?.scene?.id ?? null;

  if (inspectorSceneId !== null && sceneId !== inspectorSceneId) {
    expandedGroups.clear();
    expandedEnvironments.clear();
    collapsedFastPlay.clear();
    pcSectionCollapsed = false;
    inspectorDiagnosticsVisible = false;
    grantModeLedgerIndex = null;
  }

  inspectorSceneId = sceneId;
}

function setSelectedGroupExpanded(token) {
  if (!token || !isAdversaryActor(token.actor)) return;
  expandedGroups.add(tokenGroupKey(token));
}

function isGroupExpanded(groupKey) {
  return expandedGroups.has(groupKey);
}

function getTokenInstanceLabels(group) {
  const tokens = group?.tokens ?? [];
  const baseNames = tokens.map(token =>
    String(token?.name ?? token?.actor?.name ?? "Token")
  );

  const counts = new Map();
  for (const name of baseNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const ordinals = new Map();

  return tokens.map((token, index) => {
    const baseName = baseNames[index];
    let label = baseName;

    // Only append an ordinal when duplicate display names would otherwise
    // make exact-token selection ambiguous.
    if ((counts.get(baseName) ?? 0) > 1) {
      const ordinal = (ordinals.get(baseName) ?? 0) + 1;
      ordinals.set(baseName, ordinal);
      label = `${baseName} ${ordinal}`;
    }

    return {
      token,
      label
    };
  });
}

function getSceneGroups() {
  if (!canvas?.ready || !canvas.scene) return [];

  const tokens = (canvas.tokens?.placeables ?? []).filter(
    token => isAdversaryActor(token.actor)
  );

  const groups = new Map();

  for (const token of tokens) {
    const key = tokenGroupKey(token);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        actor: token.actor,
        tokens: []
      });
    }

    groups.get(key).tokens.push(token);
  }

  const selected = getSelectedToken();
  const selectedKey = selected ? tokenGroupKey(selected) : null;

  const result = [...groups.values()].map(group => ({
    ...group,
    selected: group.key === selectedKey,
    expanded: isGroupExpanded(group.key)
  }));

  result.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    return String(a.actor?.name ?? "").localeCompare(
      String(b.actor?.name ?? "")
    );
  });

  return result;
}

// ===== 52-pcs.js =====
/* -------------------------------------------- */
/*  Scene PC Roster                              */
/* -------------------------------------------- */

function isPcActor(actor) {
  return Boolean(actor && actor.type === "character");
}

function pcSceneEntryKey(token) {
  if (!token?.actor) return null;

  const linked = Boolean(token.document?.actorLink);
  const actorId = token.actor?.id ?? token.document?.actorId ?? null;

  if (linked && actorId) {
    return `actor:${actorId}`;
  }

  return `token:${token.id}`;
}

function getScenePcEntries() {
  if (!canvas?.ready || !canvas.scene) return [];

  const tokens = (canvas.tokens?.placeables ?? [])
    .filter(token => isPcActor(token.actor));

  const entries = new Map();

  // Prefer a controlled representation when a linked Actor appears more than
  // once. Linked tokens share Actor state, so only one row is needed.
  const ordered = [
    ...tokens.filter(token => token.controlled),
    ...tokens.filter(token => !token.controlled)
  ];

  for (const token of ordered) {
    const key = pcSceneEntryKey(token);
    if (!key || entries.has(key)) continue;

    entries.set(key, {
      key,
      actor: token.actor,
      token,
      linked: Boolean(token.document?.actorLink)
    });
  }

  return [...entries.values()].sort((a, b) =>
    String(a.actor?.name ?? "").localeCompare(
      String(b.actor?.name ?? "")
    )
  );
}

function resolvePcToken(tokenId) {
  if (!tokenId) return null;

  const token = canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(
      candidate => String(candidate?.id) === String(tokenId)
    )
    ?? null;

  return token?.actor && isPcActor(token.actor)
    ? token
    : null;
}

// ===== 60-actions.js =====
/* -------------------------------------------- */
/*  GM Action Palette — READ ONLY               */
/* -------------------------------------------- */

function getNativeActions(item) {
  const actions = item?.system?.actions;
  if (!actions || typeof actions !== "object") return [];

  if (Array.isArray(actions)) {
    return actions.filter(Boolean);
  }

  if (typeof actions.values === "function") {
    try {
      return [...actions.values()].filter(Boolean);
    } catch (error) {
      console.warn(
        "Cybermancy GM QOL | Could not iterate structured Action collection",
        error
      );
    }
  }

  if (Symbol.iterator in Object(actions)) {
    try {
      return [...actions].map(entry => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
    } catch (_) {
      // Fall through to plain-object support.
    }
  }

  return Object.values(actions).filter(Boolean);
}

function getFastPlayFeatureRefs(actor) {
  const fastPlay = getFastPlay(actor);
  const refs = new Set();

  for (const prompt of fastPlay?.prompts ?? []) {
    for (const ref of prompt?.featureRefs ?? []) {
      if (ref) refs.add(String(ref));
    }
  }

  return refs;
}

function normalizeCost(cost) {
  if (!cost || !cost.key) return null;

  const value = Number(cost.value);
  return {
    key: String(cost.key),
    value: Number.isFinite(value) ? value : cost.value,
    scalable: Boolean(cost.scalable)
  };
}

function collectNativeCosts(actions) {
  const result = [];

  for (const action of actions) {
    for (const rawCost of action?.cost ?? []) {
      const cost = normalizeCost(rawCost);
      if (!cost) continue;

      const signature = `${cost.key}:${String(cost.value)}:${cost.scalable}`;
      if (!result.some(existing => existing.signature === signature)) {
        result.push({ ...cost, signature });
      }
    }
  }

  return result;
}

function applyExplicitMetadataToCosts(nativeCosts, meta) {
  if (!meta) return nativeCosts;

  let costs = nativeCosts.map(cost => ({ ...cost }));

  for (const [metaKey, costKey] of [
    ["fearCost", "fear"],
    ["stressCost", "stress"]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(meta, metaKey)) continue;

    costs = costs.filter(cost => cost.key !== costKey);

    const value = Number(meta[metaKey]);
    if (Number.isFinite(value) && value > 0) {
      costs.push({
        key: costKey,
        value,
        scalable: false,
        signature: `${costKey}:${value}:false`,
        explicit: true
      });
    }
  }

  return costs;
}

function deriveFeatureKind(item, actions, meta) {
  if (meta?.actionType) {
    return {
      label: capitalize(meta.actionType),
      source: "explicit"
    };
  }

  if (actions.some(action => String(action?.type).toLowerCase() === "attack")) {
    return { label: "Attack", source: "native" };
  }

  const actionTypes = [
    ...new Set(
      actions
        .map(action => String(action?.actionType ?? "").toLowerCase())
        .filter(Boolean)
    )
  ];

  if (actionTypes.length === 1) {
    return {
      label: capitalize(actionTypes[0]),
      source: "native"
    };
  }

  if (actionTypes.length > 1) {
    return {
      label: actionTypes.map(capitalize).join(" / "),
      source: "native"
    };
  }

  return {
    label: "Feature",
    source: "unclassified"
  };
}

function getActionRanges(actions) {
  return [
    ...new Set(
      actions
        .map(action => String(action?.range ?? "").trim())
        .filter(Boolean)
    )
  ];
}

function formatCost(cost, fear) {
  const key = String(cost.key ?? "").toLowerCase();
  const value = cost.value;

  if (key === "fear") {
    const availability = fear.available && Number.isFinite(Number(value))
      ? (fear.current >= Number(value) ? "available" : "insufficient")
      : "unknown";

    return {
      text: `Fear ${value}`,
      className: `cmgi-cost-fear cmgi-fear-${availability}`,
      title: fear.available
        ? `Native Fear pool is ${fear.current}/${fear.max}. This indicates resource availability only; it does not determine whether the feature is legally usable.`
        : "Fear availability is unknown. This does not determine whether the feature is legally usable."
    };
  }

  if (key === "stress") {
    return {
      text: `Stress ${value}`,
      className: "cmgi-cost-stress",
      title: "Structured feature cost from the Actor/Item. Read only."
    };
  }

  return {
    text: `${capitalize(key)} ${value}`,
    className: "cmgi-cost-other",
    title: "Structured feature cost from the Actor/Item. Read only."
  };
}

function getDamageFormula(damage) {
  const parts = damage?.parts ?? [];
  const formulas = [];

  for (const part of parts) {
    const value = part?.value ?? {};
    let formula = "";

    if (value?.custom?.enabled && value?.custom?.formula) {
      formula = String(value.custom.formula);
    } else {
      const dice = value?.dice ? String(value.dice) : "";
      const bonus = Number(value?.bonus ?? 0);

      if (dice) {
        formula = dice;
        if (bonus > 0) formula += `+${bonus}`;
        else if (bonus < 0) formula += String(bonus);
      } else if (Number.isFinite(bonus) && bonus !== 0) {
        formula = String(bonus);
      }
    }

    const types = Array.isArray(part?.type) ? part.type.filter(Boolean) : [];
    if (formula) {
      formulas.push(
        types.length ? `${formula} ${types.join("/")}` : formula
      );
    }
  }

  return formulas.join(", ");
}

function buildStandardAttack(actor) {
  const attack = actor?.system?.attack;
  if (!attack || !attack.name) return null;

  const bonus = attack?.roll?.bonus;
  const range = String(attack?.range ?? "").trim();
  const damage = getDamageFormula(attack?.damage);

  const detailBits = [];
  if (Number.isFinite(Number(bonus))) {
    const numericBonus = Number(bonus);
    detailBits.push(`Attack ${numericBonus >= 0 ? "+" : ""}${numericBonus}`);
  }
  if (range) detailBits.push(capitalize(range));
  if (damage) detailBits.push(damage);

  const description = String(attack?.description ?? "").trim();

  return {
    id: "standard-attack",
    name: attack.name,
    kind: { label: "Attack", source: "native" },
    ranges: range ? [range] : [],
    costs: collectNativeCosts([attack]),
    description,
    detailsHtml: detailBits.length
      ? `<p><strong>Standard attack:</strong> ${escapeHtml(detailBits.join(" · "))}</p>`
      : `<p>Standard adversary attack.</p>`,
    explicit: false,
    fastPlayReferenced: false,
    standardAttack: true,
    nativeActions: [attack]
  };
}

function buildFeatureEntry(item, fastPlayRefs) {
  const actions = getNativeActions(item);
  const meta = getGmActionMetadata(item);
  const nativeCosts = collectNativeCosts(actions);
  const costs = applyExplicitMetadataToCosts(nativeCosts, meta);
  const kind = deriveFeatureKind(item, actions, meta);
  const ranges = getActionRanges(actions);

  return {
    id: item.id,
    name: item.name,
    kind,
    ranges,
    costs,
    description: String(item?.system?.description ?? ""),
    detailsHtml: "",
    explicit: Boolean(meta),
    metadata: meta,
    fastPlayReferenced: fastPlayRefs.has(String(item.name)),
    standardAttack: false,
    nativeActions: actions
  };
}

function buildGmActionEntries(actor) {
  const fastPlayRefs = getFastPlayFeatureRefs(actor);
  const entries = [];

  const standard = buildStandardAttack(actor);
  if (standard) entries.push(standard);

  const features = [...(actor?.items ?? [])]
    .filter(item => item?.type === "feature")
    .map(item => buildFeatureEntry(item, fastPlayRefs));

  // Keep Item order, but put Fast Play-referenced features before other
  // embedded features. Standard attack remains first.
  const referenced = features.filter(entry => entry.fastPlayReferenced);
  const other = features.filter(entry => !entry.fastPlayReferenced);

  return [...entries, ...referenced, ...other]
    .map(entry => applyFeatureSidecarCompatibility(actor, entry));
}


function normalizedActionCostSignature(action) {
  const actionType = String(action?.actionType ?? action?.type ?? "").toLowerCase();
  const costs = (action?.cost ?? [])
    .map(normalizeCost)
    .filter(Boolean)
    .map(cost => ({
      key: String(cost.key).toLowerCase(),
      value: Number.isFinite(Number(cost.value)) ? Number(cost.value) : String(cost.value),
      scalable: Boolean(cost.scalable)
    }))
    .sort((a, b) =>
      `${a.key}:${String(a.value)}:${a.scalable}`.localeCompare(
        `${b.key}:${String(b.value)}:${b.scalable}`
      )
    );

  return JSON.stringify({ actionType, costs });
}

function hasAmbiguousNativeActions(entry) {
  const actions = Array.isArray(entry?.nativeActions) ? entry.nativeActions : [];
  if (actions.length <= 1) return false;

  const signatures = new Set(actions.map(normalizedActionCostSignature));
  return signatures.size > 1;
}

function resolveSingleStructuredCost(entry, key) {
  const matching = (entry?.costs ?? []).filter(
    cost => String(cost?.key ?? "").toLowerCase() === key
  );

  if (!matching.length) {
    return { value: 0, ambiguous: false, reason: null };
  }

  if (matching.length !== 1) {
    return {
      value: null,
      ambiguous: true,
      reason: `Multiple structured ${capitalize(key)} costs are present.`
    };
  }

  const cost = matching[0];
  const numeric = Number(cost.value);

  if (!Number.isFinite(numeric) || numeric < 0 || cost.scalable) {
    return {
      value: null,
      ambiguous: true,
      reason: `The structured ${capitalize(key)} cost is scalable or non-numeric.`
    };
  }

  return {
    value: numeric,
    ambiguous: false,
    reason: null
  };
}

function getManualStructuredCosts(entry) {
  const manual = [];

  const stress = resolveSingleStructuredCost(entry, "stress");
  if (stress.ambiguous) {
    manual.push("Structured Stress cost — MANUAL");
  } else if (stress.value > 0) {
    manual.push(`Mark ${stress.value} Stress — MANUAL`);
  }

  for (const cost of entry?.costs ?? []) {
    const key = String(cost?.key ?? "").toLowerCase();
    if (key === "fear" || key === "stress") continue;

    if (cost.scalable || !Number.isFinite(Number(cost.value))) {
      manual.push(`${capitalize(key)} cost — MANUAL`);
    } else if (Number(cost.value) > 0) {
      manual.push(`${capitalize(key)} ${Number(cost.value)} — MANUAL`);
    }
  }

  return [...new Set(manual)];
}

function resolveActionTransactionCapability(entry) {
  if (!entry) {
    return { eligible: false, reason: "Action data unavailable." };
  }

  const kind = String(entry.kind?.label ?? "").toLowerCase();

  if (!["attack", "action"].includes(kind)) {
    return {
      eligible: false,
      reason: "Only confidently classified Attacks and Actions are transaction-capable in v0.11."
    };
  }

  if (
    (entry.explicit || entry.compatibilitySource === "sidecar")
    && entry.metadata?.usesSpotlight === false
  ) {
    return {
      eligible: false,
      reason: "Explicit gmAction metadata says this feature does not use an adversary Spotlight."
    };
  }

  if (hasAmbiguousNativeActions(entry)) {
    return {
      eligible: false,
      reason: "This feature contains multiple structured actions with different types or costs."
    };
  }

  const fear = resolveSingleStructuredCost(entry, "fear");
  if (fear.ambiguous) {
    return {
      eligible: false,
      reason: fear.reason
    };
  }

  return {
    eligible: true,
    reason: null,
    featureFearCost: fear.value,
    spotlightDelta: 1,
    manualCosts: getManualStructuredCosts(entry)
  };
}

function getSelectedTokenForGroup(group) {
  const selected = getSelectedToken();
  if (!selected) return null;

  return (group?.tokens ?? []).some(token => token.id === selected.id)
    ? selected
    : null;
}

function findLiveActionEntry(actor, entryId) {
  return buildGmActionEntries(actor).find(entry => String(entry.id) === String(entryId)) ?? null;
}

function buildActionTransactionPlan(tokenId, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  if (spotlightOwner !== "GM") {
    return { valid: false, reason: "Take GM Spotlight before using a GM Action transaction." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { valid: false, reason: "The intended adversary token is no longer available." };
  }

  if (isAdversaryDefeated(token)) {
    return {
      valid: false,
      reason: `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot take a normal Action.`
    };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry) {
    return { valid: false, reason: "The intended action is no longer available on that Actor." };
  }

  const capability = resolveActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { valid: false, reason: capability.reason };
  }

  // Token-specific granted Spotlight permission has priority over a generic
  // prepared GM Move. A grant was already recorded into TURN/TOTAL and does
  // not purchase or consume another GM Move.
  const granted = findAvailableGrantedSpotlight(token.id);
  const prepared = granted ? null : getPreparedGmMove();

  const moveFearCost = granted
    ? 0
    : prepared
      ? 0
      : getNewGmMoveCost();

  if (moveFearCost === null) {
    return { valid: false, reason: "GM Move cost could not be resolved." };
  }

  const preparedMoveFearCost = prepared
    ? Math.max(0, Number(prepared.entry.moveFearCost) || 0)
    : 0;

  const featureFearCost = Math.max(0, Number(capability.featureFearCost) || 0);
  const totalFearCost = moveFearCost + featureFearCost;

  return {
    valid: true,
    sceneId: canvas.scene.id,
    tokenId: token.id,
    tokenName: token.name ?? token.actor.name ?? "Adversary",
    actorId: token.actor.id,
    actorName: token.actor.name ?? "Adversary",
    entryId: entry.id,
    itemId: entry.standardAttack ? null : entry.id,
    actionName: entry.name,
    standardAttack: Boolean(entry.standardAttack),

    grantedSpotlight: Boolean(granted),
    grantLedgerIndex: granted?.ledgerIndex ?? null,
    grantIndex: granted?.grantIndex ?? null,
    grantOwnerActionName: granted?.ownerEntry?.actionName ?? null,
    grantRecordedDelta: granted?.grant?.delta ?? 0,

    preparedMove: Boolean(prepared),
    preparedMoveIndex: prepared?.index ?? null,
    preparedMoveFearCost,
    preparedMoveKind: prepared?.entry?.kind ?? null,

    moveKind: granted
      ? "granted"
      : prepared
        ? prepared.entry.kind
        : moveFearCost === 0
          ? "base"
          : "additional",

    moveFearCost,
    featureFearCost,
    totalFearCost,

    // A grant already placed its Spotlight mark when it was granted.
    // Consuming the grant must not double-increment TURN/TOTAL.
    spotlightDelta: granted ? 0 : capability.spotlightDelta,
    manualCosts: capability.manualCosts ?? []
  };
}

function getFeatureItemForEntry(actor, entryId) {
  if (!actor || !entryId || entryId === "standard-attack") return null;

  if (typeof actor.items?.get === "function") {
    const direct = actor.items.get(entryId);
    if (direct) return direct;
  }

  return [...(actor.items ?? [])].find(
    item => String(item?.id) === String(entryId)
  ) ?? null;
}

function getNativeActionFearCost(action) {
  const nativeCosts = collectNativeCosts([action]);
  const fear = resolveSingleStructuredCost({ costs: nativeCosts }, "fear");

  if (fear.ambiguous) {
    return {
      value: null,
      ambiguous: true,
      reason: "The native Daggerheart Fear cost is scalable, non-numeric, or otherwise ambiguous."
    };
  }

  return {
    value: Math.max(0, Number(fear.value) || 0),
    ambiguous: false,
    reason: null
  };
}

function getNativeActionCostLabels(action) {
  const costs = collectNativeCosts([action]);

  return costs.map(cost => {
    const key = String(cost?.key ?? "").toLowerCase();
    const numeric = Number(cost?.value);
    const value = Number.isFinite(numeric) ? numeric : cost?.value;

    return {
      key,
      value,
      scalable: Boolean(cost?.scalable),
      label: `${capitalize(key)} ${value}${cost?.scalable ? " (scalable)" : ""}`
    };
  });
}

function explicitMetadataMatchesNativeCosts(entry, action) {
  if (!entry?.metadata) return { matches: true, reason: null };

  const nativeCosts = collectNativeCosts([action]);

  for (const [metaKey, costKey] of [
    ["fearCost", "fear"],
    ["stressCost", "stress"]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(entry.metadata, metaKey)) continue;

    const metadataValue = Math.max(0, Number(entry.metadata[metaKey]) || 0);
    const native = resolveSingleStructuredCost({ costs: nativeCosts }, costKey);

    if (native.ambiguous) {
      return {
        matches: false,
        reason: `Explicit ${costKey} metadata cannot be reconciled with the native Daggerheart Action cost.`
      };
    }

    const nativeValue = Math.max(0, Number(native.value) || 0);
    if (metadataValue !== nativeValue) {
      return {
        matches: false,
        reason:
          `Explicit ${costKey} metadata (${metadataValue}) differs from the native Daggerheart Action cost (${nativeValue}). ` +
          "Use bookkeeping-only until the content metadata and native Action agree."
      };
    }
  }

  return { matches: true, reason: null };
}

function resolveNativeEmbeddedActionCapability(tokenId, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { available: false, reason: "No ready Canvas Scene." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { available: false, reason: "The intended adversary token is no longer available." };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      available: false,
      reason: "Native embedded execution requires an embedded feature Action."
    };
  }

  const capability = resolveActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { available: false, reason: capability.reason };
  }

  const item = getFeatureItemForEntry(token.actor, entryId);
  if (!item) {
    return { available: false, reason: "The embedded feature Item is no longer available." };
  }

  const actions = getNativeActions(item);
  if (actions.length !== 1) {
    return {
      available: false,
      reason:
        actions.length === 0
          ? "This feature has no executable native Daggerheart Action."
          : "v0.13 native execution requires exactly one native Daggerheart Action in the feature."
    };
  }

  const action = actions[0];
  if (!action || typeof action.use !== "function") {
    return {
      available: false,
      reason: "The feature's native Action does not expose Daggerheart Action.use()."
    };
  }

  const nativeKind = String(
    action?.type === "attack" ? "attack" : action?.actionType ?? ""
  ).toLowerCase();

  if (!["attack", "action"].includes(nativeKind)) {
    return {
      available: false,
      reason: "Only native Attack/Action feature workflows are executable in v0.13."
    };
  }

  if (entry.explicit && entry.metadata?.usesSpotlight === false) {
    return {
      available: false,
      reason: "Explicit gmAction metadata says this feature does not use an adversary Spotlight."
    };
  }

  const metadataMatch = explicitMetadataMatchesNativeCosts(entry, action);
  if (!metadataMatch.matches) {
    return { available: false, reason: metadataMatch.reason };
  }

  const nativeFear = getNativeActionFearCost(action);
  if (nativeFear.ambiguous) {
    return { available: false, reason: nativeFear.reason };
  }

  return {
    available: true,
    reason: null,
    token,
    item,
    action,
    entry,
    nativeActionId: action.id ?? action._id ?? null,
    expectedNativeFearCost: nativeFear.value,
    nativeCosts: getNativeActionCostLabels(action),
    systemVersion: game.system?.version ?? null,
    validatedVersion: NATIVE_ATTACK_VALIDATED_DH_VERSION,
    versionMatches: game.system?.version === NATIVE_ATTACK_VALIDATED_DH_VERSION
  };
}

async function invokeNativeEmbeddedAction(plan) {
  const capability = resolveNativeEmbeddedActionCapability(
    plan?.tokenId,
    plan?.entryId
  );

  if (!capability.available) {
    throw new Error(capability.reason);
  }

  const { token, action, item } = capability;

  if (!token.controlled) {
    token.control({ releaseOthers: true });
  }

  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart embedded Action",
    {
      token: token.name,
      tokenId: token.id,
      actorUuid: token.actor?.uuid,
      item: item.name,
      itemId: item.id,
      action: action.name,
      actionId: action.id ?? action._id,
      daggerheartVersion: game.system?.version
    }
  );

  return action.use(nativeEvent);
}

function resolveNativeStandardAttackCapability(tokenId, entryId = "standard-attack") {
  if (!canvas?.ready || !canvas.scene) {
    return { available: false, reason: "No ready Canvas Scene." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { available: false, reason: "The intended adversary token is no longer available." };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry?.standardAttack) {
    return {
      available: false,
      reason: "Native execution is limited to the adversary's built-in standard attack in v0.12."
    };
  }

  const attack = token.actor?.system?.attack;
  if (!attack || typeof attack.use !== "function") {
    return {
      available: false,
      reason: "This Actor does not expose the validated Daggerheart standard-attack Action.use() interface."
    };
  }

  return {
    available: true,
    reason: null,
    token,
    attack,
    systemVersion: game.system?.version ?? null,
    validatedVersion: NATIVE_ATTACK_VALIDATED_DH_VERSION,
    versionMatches: game.system?.version === NATIVE_ATTACK_VALIDATED_DH_VERSION
  };
}

function createNativeAttackEvent() {
  // Daggerheart 1.2.7 Action.use(event) reads the ordinary keyboard-modifier
  // properties from its triggering event. A synthetic MouseEvent provides the
  // same native event shape while intentionally applying no modifier shortcuts.
  return new MouseEvent("click", {
    bubbles: false,
    cancelable: true,
    view: window,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false
  });
}

async function invokeNativeStandardAttack(plan) {
  const capability = resolveNativeStandardAttackCapability(
    plan?.tokenId,
    plan?.entryId ?? "standard-attack"
  );

  if (!capability.available) {
    throw new Error(capability.reason);
  }

  const { token, attack } = capability;

  // The transaction is tied to one exact Token. Re-control that Token before
  // invoking Daggerheart so the native workflow/speaker context comes from the
  // intended synthetic Actor even if canvas selection changed while the preview
  // dialog was open.
  if (!token.controlled) {
    token.control({ releaseOthers: true });
  }

  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart standard attack",
    {
      token: token.name,
      tokenId: token.id,
      actorUuid: token.actor?.uuid,
      action: attack.name,
      daggerheartVersion: game.system?.version
    }
  );

  // Daggerheart 1.2.7 native integration point:
  // token.actor.system.attack is an ActionField-backed DHAttackAction whose
  // .use(event) method executes Daggerheart's own configuration + workflow.
  return attack.use(nativeEvent);
}

function getLastActionLedgerEntryWithIndex() {
  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];

    // Never reach backward through a later Environment Action to attach a
    // new grant to an older adversary Action transaction.
    if (entry?.transactionType === "environment-action") return null;

    if (entry?.transactionType === "action" && entry.actionName) {
      return { entry, index };
    }
  }
  return null;
}

function getLastActionLedgerEntry() {
  return getLastActionLedgerEntryWithIndex()?.entry ?? null;
}

function findAvailableGrantedSpotlight(tokenId) {
  if (!tokenId) return null;

  for (let ledgerIndex = gmMoveLedger.length - 1; ledgerIndex >= 0; ledgerIndex -= 1) {
    const entry = gmMoveLedger[ledgerIndex];
    if (entry?.transactionType !== "action") continue;

    const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);

    for (let grantIndex = 0; grantIndex < grants.length; grantIndex += 1) {
      const grant = grants[grantIndex];

      if (
        String(grant.tokenId) === String(tokenId)
        && grant.status === "available"
      ) {
        return {
          ledgerIndex,
          grantIndex,
          ownerEntry: entry,
          grant
        };
      }
    }
  }

  return null;
}

function getActionExecutionRecord(plan) {
  if (plan?.grantedSpotlight) {
    const ownerEntry = gmMoveLedger[plan.grantLedgerIndex];
    if (ownerEntry?.transactionType !== "action") return null;

    const grants = Array.isArray(ownerEntry.grantedSpotlights)
      ? ownerEntry.grantedSpotlights
      : [];

    return grants[plan.grantIndex] ?? null;
  }

  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];
    if (
      entry?.transactionType === "action"
      && String(entry?.tokenId ?? "") === String(plan?.tokenId ?? "")
      && String(entry?.actionName ?? "") === String(plan?.actionName ?? "")
    ) {
      return entry;
    }
  }

  return null;
}

function getGrantModeTransaction() {
  if (spotlightOwner !== "GM" || grantModeLedgerIndex === null) return null;

  const entry = gmMoveLedger[grantModeLedgerIndex];
  if (entry?.transactionType !== "action") {
    grantModeLedgerIndex = null;
    return null;
  }

  return { entry, index: grantModeLedgerIndex };
}

function startGrantSpotlightMode() {
  if (
    spotlightOwner !== "GM"
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) {
    return false;
  }

  const latest = getLastActionLedgerEntryWithIndex();
  if (!latest) {
    ui.notifications.warn("No current-turn GM Action transaction is available to receive granted Spotlights.");
    return false;
  }

  grantModeLedgerIndex = latest.index;
  return true;
}

function stopGrantSpotlightMode() {
  if (grantModeLedgerIndex === null) return false;
  grantModeLedgerIndex = null;
  return true;
}

async function grantSpotlightToToken(tokenId) {
  const grantTransaction = getGrantModeTransaction();
  if (!grantTransaction || !tokenId) return false;

  const token = canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    ui.notifications.warn("Granted Spotlight requires a live adversary token on the current Scene.");
    return false;
  }

  if (isAdversaryDefeated(token)) {
    ui.notifications.warn(
      `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot receive a granted Spotlight.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const limitBefore = getSpotlightLimit(token);
  const projectedTurn = getSpotlightUseCount(tokenId) + 1;
  const projectedOverBy = Math.max(0, projectedTurn - limitBefore.limit);

  grantTransaction.entry.grantedSpotlights = sanitizeGrantedSpotlights(
    grantTransaction.entry.grantedSpotlights
  );
  grantTransaction.entry.grantedSpotlights.push({
    tokenId: String(tokenId),
    delta: 1,
    status: "available",
    actionName: null,
    actionSubtype: null,
    effectId: null,
    effectName: null,
    itemId: null,
    nativeActionId: null,
    executionMode: null,
    executionStatus: null,
    expectedNativeFearCost: 0,
    featureFearCost: 0,
    inspectorFearCost: 0
  });

  adjustSpotlightCounts(tokenId, 1);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  if (projectedOverBy > 0) {
    ui.notifications.warn(
      `Granted Spotlight recorded for ${token.name}. TURN ${projectedTurn} exceeds resolved LIMIT ${limitBefore.limit} by ${projectedOverBy}. Advisory only; the grant was recorded.`
    );
  }

  return true;
}

async function removeGrantedSpotlight(ledgerIndex, grantIndex) {
  const safeLedgerIndex = Math.trunc(Number(ledgerIndex));
  const safeGrantIndex = Math.trunc(Number(grantIndex));
  const entry = gmMoveLedger[safeLedgerIndex];

  if (entry?.transactionType !== "action") return false;

  const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);
  const grant = grants[safeGrantIndex];
  if (!grant) return false;

  if (grant.status !== "available") {
    ui.notifications.warn(
      "This granted Spotlight has already been consumed by an Action. It cannot be individually removed; undo the owning GM Move if the transaction must be reversed."
    );
    return false;
  }

  const turn = getSpotlightUseCount(grant.tokenId);
  const total = getSpotlightTotalCount(grant.tokenId);
  if (turn < grant.delta || total < grant.delta) {
    ui.notifications.warn(
      "This granted Spotlight cannot be removed safely because TURN/TOTAL no longer contain the linked grant. Use the Spotlight integrity diagnostic before changing it."
    );
    return false;
  }

  const before = snapshotCombatStateMemory();

  grants.splice(safeGrantIndex, 1);
  entry.grantedSpotlights = grants;
  adjustSpotlightCounts(grant.tokenId, -grant.delta);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

function renderLastActionSummary() {
  const latestReaction = getLatestReactionWithIndex();
  const latestTransaction = getLastGmActionTransactionWithIndex();

  const reactionSequence = latestReaction?.sequence ?? 0;
  const actionSequence = Math.max(
    0,
    Number(latestTransaction?.entry?.eventSequence) || 0
  );

  if (latestReaction && reactionSequence >= actionSequence) {
    return renderLastReactionSummary(latestReaction);
  }

  if (latestTransaction?.entry?.transactionType === "environment-action") {
    return renderLastEnvironmentActionSummary(latestTransaction);
  }

  const latest = getLastActionLedgerEntryWithIndex();
  if (!latest) return "";

  const { entry, index } = latest;
  const token = entry.tokenId
    ? canvas?.tokens?.get(entry.tokenId)
      ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === entry.tokenId)
    : null;

  const tokenName = token?.name ?? (entry.tokenId ? `Token ${entry.tokenId}` : "Adversary");
  const status = entry.executionStatus
    ? String(entry.executionStatus).replaceAll("-", " ").toUpperCase()
    : "";

  const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);
  const totalGranted = grants.reduce((sum, grant) => sum + grant.delta, 0);
  const availableGranted = grants
    .filter(grant => grant.status === "available")
    .reduce((sum, grant) => sum + grant.delta, 0);
  const grantModeActive = grantModeLedgerIndex === index && spotlightOwner === "GM";

  const grantRows = grants.map((grant, grantIndex) => {
    const grantToken = canvas?.tokens?.get(grant.tokenId)
      ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === grant.tokenId)
      ?? null;
    const grantName = grantToken?.name ?? `Token ${grant.tokenId}`;

    const grantStatus = grant.status === "available"
      ? "AVAILABLE"
      : grant.actionName
        ? `USED — ${grant.actionName}`
        : "USED";

    const grantStatusHtml =
      grant.status === "available" && grantToken
        ? `
          <button type="button"
                  class="cmgi-grant-available"
                  data-action="focus-token"
                  data-token-id="${escapeHtml(grant.tokenId)}"
                  title="Select and focus ${escapeHtml(grantName)}. This does not consume the granted Spotlight.">
            AVAILABLE
          </button>`
        : `<strong>${escapeHtml(grantStatus)}</strong>`;

    const canRemove = grant.status === "available"
      && !actionTransactionPending
      && !fearTransactionPending;

    return `
      <span class="cmgi-grant-chip">
        ${escapeHtml(grantName)} ×${grant.delta}
        ${grantStatusHtml}
        <button type="button"
                class="cmgi-grant-remove"
                data-action="remove-granted-spotlight"
                data-ledger-index="${index}"
                data-grant-index="${grantIndex}"
                ${canRemove ? "" : "disabled"}
                title="${grant.status === "available"
                  ? "Remove this unused granted Spotlight bookkeeping from the owning GM Action transaction."
                  : "This grant has already been consumed by an Action and cannot be individually removed. Undo the owning GM Move if the transaction must be reversed."}">
          ×
        </button>
      </span>`;
  }).join("");

  return `
    <div class="cmgi-last-action" title="Most recent committed GM event in the current Inspector cycle.">
      <span class="cmgi-last-action-label">LAST GM EVENT</span>
      <strong>${escapeHtml(tokenName)} — ${escapeHtml(entry.actionName)}</strong>
      ${status ? `<span class="cmgi-last-action-status">${escapeHtml(status)}</span>` : ""}
      <span class="cmgi-grant-count">GRANTS ${totalGranted} · AVAILABLE ${availableGranted}</span>
      ${grantRows ? `<span class="cmgi-grant-list">${grantRows}</span>` : ""}

      ${spotlightOwner === "GM" ? `
        <button type="button"
                class="cmgi-grant-mode-button"
                data-action="${grantModeActive ? "stop-grant-mode" : "start-grant-mode"}"
                ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
                title="${grantModeActive
                  ? "Finish assigning granted Spotlights from this GM Action."
                  : "Assign one or more exact-token Spotlights to this GM Action without creating another GM Move or spending Fear."}">
          ${grantModeActive ? "DONE GRANTING" : "GRANT SPOTLIGHT"}
        </button>
      ` : ""}
    </div>

    ${grantModeActive ? `
      <div class="cmgi-grant-mode-banner">
        <strong>GRANTING FROM:</strong>
        ${escapeHtml(tokenName)} — ${escapeHtml(entry.actionName)}
        <span class="cmgi-muted">Choose GRANT +1 on any exact adversary token. Grants create linked Spotlight bookkeeping but no additional GM Move or Fear cost.</span>
      </div>
    ` : ""}`;
}

function buildStandardAttackImplementationDetails(plan) {
  const fear = getFearState();
  const spotlightLimit = getSpotlightLimit(plan.tokenId);
  const currentTurn = getSpotlightUseCount(plan.tokenId);
  const projectedTurn =
    currentTurn + Math.max(0, Number(plan.spotlightDelta) || 0);
  const nativeAttack = resolveNativeStandardAttackCapability(
    plan.tokenId,
    plan.entryId
  );

  const moveLabel = plan.grantedSpotlight
    ? "GRANTED — no new GM Move"
    : plan.preparedMove
      ? "READY — prepared GM Move"
      : plan.moveFearCost === 0
        ? "BASE — 0 Fear"
        : `ADDITIONAL — ${plan.moveFearCost} Fear`;

  const spotlightLabel = plan.grantedSpotlight
    ? `${currentTurn}/${spotlightLimit.limit} — already counted by grant`
    : `${currentTurn}/${spotlightLimit.limit} → ${projectedTurn}/${spotlightLimit.limit}`;

  const nativeLabel = nativeAttack?.available
    ? `Available — Daggerheart ${nativeAttack.systemVersion ?? "version unknown"}`
    : `Unavailable — ${nativeAttack?.reason ?? "native interface not found"}`;

  return {
    rows: [
      ["GM Move", moveLabel],
      ["Spotlight", spotlightLabel],
      ["Spotlight Limit", `${spotlightLimit.limit} · ${spotlightLimit.sourceLabel}`],
      ["Native Attack", nativeLabel],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      "COMMIT & ROLL commits QOL bookkeeping, then invokes Daggerheart's native standard attack.",
      "BOOKKEEPING ONLY commits GM Move/Fear/Spotlight bookkeeping without invoking the native attack.",
      "Undo GM Move reverses QOL bookkeeping only; it does not reverse native rolls, damage, chat, or effects."
    ]
  };
}

function renderStandardAttackCompactPreviewContent(plan) {
  const details = buildStandardAttackImplementationDetails(plan);

  return `
    <style>
      .cmgi-transaction-preview-compact {
        position: relative;
        overflow: visible;
        font-size: 14px;
        padding: .1rem .05rem;
      }
      .cmgi-transaction-compact-heading {
        display: flex;
        align-items: center;
        gap: .4rem;
        margin-bottom: .75rem;
      }
      .cmgi-transaction-compact-heading h3 {
        flex: 1 1 auto;
        margin: 0;
      }
      .cmgi-transaction-info-wrap {
        position: relative;
        display: inline-flex;
        flex: 0 0 auto;
      }
      .cmgi-transaction-info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .72rem;
        cursor: help;
        opacity: .7;
      }
      .cmgi-transaction-info:hover,
      .cmgi-transaction-info:focus {
        opacity: 1;
      }
      .cmgi-transaction-info-popover {
        display: none;
        position: absolute;
        z-index: 1000;
        top: calc(100% + .35rem);
        right: 0;
        width: min(470px, calc(100vw - 4rem));
        padding: .65rem .75rem;
        border: 1px solid rgba(0,0,0,.38);
        border-radius: 6px;
        background: rgba(246,243,231,.985);
        color: #1b1b1b;
        box-shadow: 0 .35rem 1rem rgba(0,0,0,.3);
        font-size: .82rem;
        line-height: 1.3;
      }
      .cmgi-transaction-info-wrap:hover .cmgi-transaction-info-popover,
      .cmgi-transaction-info-wrap:focus-within .cmgi-transaction-info-popover {
        display: block;
      }
      .cmgi-transaction-info-grid {
        display: grid;
        grid-template-columns: minmax(95px, auto) minmax(0, 1fr);
        gap: .28rem .65rem;
        align-items: baseline;
      }
      .cmgi-transaction-info-label {
        font-weight: 800;
        text-align: right;
      }
      .cmgi-transaction-info-notes {
        display: block;
        margin-top: .55rem;
        padding-top: .5rem;
        border-top: 1px solid rgba(0,0,0,.2);
      }
      .cmgi-transaction-info-notes div + div {
        margin-top: .3rem;
      }
      .cmgi-transaction-fear {
        padding-top: .6rem;
        border-top: 1px solid rgba(0,0,0,.22);
        font-size: 1.05rem;
        font-weight: 850;
      }
    </style>
    <div class="cmgi-transaction-preview-compact">
      <div class="cmgi-transaction-compact-heading">
        <h3>${escapeHtml(plan.tokenName)} — ${escapeHtml(plan.actionName)}</h3>
        <span class="cmgi-transaction-info-wrap">
          <span class="cmgi-transaction-info"
                tabindex="0"
                role="img"
                aria-label="Transaction implementation details">ⓘ</span>
          <span class="cmgi-transaction-info-popover" role="tooltip">
            <span class="cmgi-transaction-info-grid">
              ${details.rows.map(([label, value]) => `
                <span class="cmgi-transaction-info-label">${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
              `).join("")}
            </span>
            <span class="cmgi-transaction-info-notes">
              ${details.notes.map(note => `<div>${escapeHtml(note)}</div>`).join("")}
            </span>
          </span>
        </span>
      </div>
      <div class="cmgi-transaction-fear">
        TOTAL FEAR: ${escapeHtml(plan.totalFearCost)}
      </div>
    </div>`;
}

function configureStandardAttackDialogButtons(html, {
  nativeAvailable,
  nativeReason = null
} = {}) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;

  const buttonBar =
    root.querySelector(".dialog-buttons")
    ?? root.querySelector("footer")
    ?? null;

  if (buttonBar?.style) {
    buttonBar.style.display = "flex";
    buttonBar.style.gap = ".4rem";
  }

  const commit = root.querySelector('[data-button="commitAndRoll"]');
  const bookkeep = root.querySelector('[data-button="bookkeepOnly"]');
  const cancel = root.querySelector('[data-button="cancel"]');

  const commitTitle = nativeAvailable
    ? "Commit the GM Move/Fear/Spotlight bookkeeping, then invoke Daggerheart's native standard attack roll. Native roll, damage, chat, and effects remain Daggerheart-owned."
    : `Native roll unavailable: ${nativeReason ?? "native standard attack interface not found"}.`;

  const bookkeepTitle =
    "Commit only the GM Move/Fear/Spotlight bookkeeping. Do not invoke the native attack roll; resolve the attack manually.";

  const cancelTitle =
    "Close this transaction without spending Fear, recording a GM Move or Spotlight, or rolling the attack.";

  if (commit) {
    commit.title = commitTitle;
    if (!nativeAvailable) commit.disabled = true;
  }

  if (bookkeep) {
    bookkeep.title = bookkeepTitle;
  }

  if (cancel) {
    cancel.title = cancelTitle;
  }

  for (const button of [commit, bookkeep, cancel].filter(Boolean)) {
    button.style.flex = "1 1 0";
    button.style.width = "auto";
    button.style.minWidth = "0";
    button.style.height = "2rem";
    button.style.minHeight = "2rem";
    button.style.padding = ".12rem .4rem";
    button.style.fontSize = ".78rem";
    button.style.lineHeight = "1";
    button.style.whiteSpace = "nowrap";
  }
}

function renderQolCompactTransactionContent({
  heading,
  totalFear,
  rows = [],
  notes = [],
  warning = null
}) {
  return `
    <style>
      .cmgi-transaction-preview-compact {
        position: relative;
        overflow: visible;
        font-size: 14px;
        padding: .1rem .05rem;
      }
      .cmgi-transaction-compact-heading {
        display: flex;
        align-items: center;
        gap: .4rem;
        margin-bottom: .75rem;
      }
      .cmgi-transaction-compact-heading h3 {
        flex: 1 1 auto;
        margin: 0;
      }
      .cmgi-transaction-info-wrap {
        position: relative;
        display: inline-flex;
        flex: 0 0 auto;
      }
      .cmgi-transaction-info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .72rem;
        cursor: help;
        opacity: .7;
      }
      .cmgi-transaction-info:hover,
      .cmgi-transaction-info:focus { opacity: 1; }
      .cmgi-transaction-info-popover {
        display: none;
        position: absolute;
        z-index: 1000;
        top: calc(100% + .35rem);
        right: 0;
        width: min(470px, calc(100vw - 4rem));
        padding: .65rem .75rem;
        border: 1px solid rgba(0,0,0,.38);
        border-radius: 6px;
        background: rgba(246,243,231,.985);
        color: #1b1b1b;
        box-shadow: 0 .35rem 1rem rgba(0,0,0,.3);
        font-size: .82rem;
        line-height: 1.3;
      }
      .cmgi-transaction-info-wrap:hover .cmgi-transaction-info-popover,
      .cmgi-transaction-info-wrap:focus-within .cmgi-transaction-info-popover {
        display: block;
      }
      .cmgi-transaction-info-grid {
        display: grid;
        grid-template-columns: minmax(105px, auto) minmax(0, 1fr);
        gap: .28rem .65rem;
        align-items: baseline;
      }
      .cmgi-transaction-info-label {
        font-weight: 800;
        text-align: right;
      }
      .cmgi-transaction-info-notes {
        display: block;
        margin-top: .55rem;
        padding-top: .5rem;
        border-top: 1px solid rgba(0,0,0,.2);
      }
      .cmgi-transaction-info-notes div + div { margin-top: .3rem; }
      .cmgi-transaction-warning {
        display: block;
        margin-top: .45rem;
        font-weight: 800;
      }
      .cmgi-transaction-fear {
        padding-top: .6rem;
        border-top: 1px solid rgba(0,0,0,.22);
        font-size: 1.05rem;
        font-weight: 850;
      }
    </style>
    <div class="cmgi-transaction-preview-compact">
      <div class="cmgi-transaction-compact-heading">
        <h3>${escapeHtml(heading)}</h3>
        <span class="cmgi-transaction-info-wrap">
          <span class="cmgi-transaction-info"
                tabindex="0"
                role="img"
                aria-label="Transaction implementation details">ⓘ</span>
          <span class="cmgi-transaction-info-popover" role="tooltip">
            <span class="cmgi-transaction-info-grid">
              ${rows.map(([label, value]) => `
                <span class="cmgi-transaction-info-label">${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
              `).join("")}
            </span>
            ${notes.length ? `
              <span class="cmgi-transaction-info-notes">
                ${notes.map(note => `<div>${escapeHtml(note)}</div>`).join("")}
              </span>` : ""}
            ${warning
              ? `<span class="cmgi-transaction-warning">${escapeHtml(warning)}</span>`
              : ""}
          </span>
        </span>
      </div>
      <div class="cmgi-transaction-fear">
        TOTAL FEAR: ${escapeHtml(totalFear)}
      </div>
    </div>`;
}

function configureQolCompactTransactionButtons(
  html,
  { titles = {}, disabled = {} } = {}
) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;

  const buttonBar =
    root.querySelector(".dialog-buttons")
    ?? root.querySelector("footer")
    ?? null;

  if (buttonBar?.style) {
    buttonBar.style.display = "flex";
    buttonBar.style.gap = ".4rem";
  }

  for (const [key, title] of Object.entries(titles)) {
    const button = root.querySelector(`[data-button="${key}"]`);
    if (!button) continue;
    button.title = title;
    if (disabled[key]) button.disabled = true;
  }

  for (const button of root.querySelectorAll(".dialog-buttons button")) {
    button.style.flex = "1 1 0";
    button.style.width = "auto";
    button.style.minWidth = "0";
    button.style.height = "2rem";
    button.style.minHeight = "2rem";
    button.style.padding = ".12rem .4rem";
    button.style.fontSize = ".78rem";
    button.style.lineHeight = "1";
    button.style.whiteSpace = "nowrap";
  }
}

function getQolCompactDialogOptions() {
  return {
    width: 620,
    height: 300,
    resizable: true
  };
}

function buildEmbeddedActionCompactPreview(plan, nativeEmbedded) {
  const fear = getFearState();
  const spotlightLimit = getSpotlightLimit(plan.tokenId);
  const currentTurn = getSpotlightUseCount(plan.tokenId);
  const projectedTurn =
    currentTurn + Math.max(0, Number(plan.spotlightDelta) || 0);

  const expectedNativeFearCost = nativeEmbedded?.available
    ? Math.max(0, Number(nativeEmbedded.expectedNativeFearCost) || 0)
    : 0;

  const totalFear = nativeEmbedded?.available
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const moveLabel = plan.grantedSpotlight
    ? "GRANTED — no new GM Move"
    : plan.preparedMove
      ? "READY — prepared GM Move"
      : plan.moveFearCost === 0
        ? "BASE — 0 Fear"
        : `ADDITIONAL — ${plan.moveFearCost} Fear`;

  const spotlightLabel = plan.grantedSpotlight
    ? `${currentTurn}/${spotlightLimit.limit} — grant already counted`
    : `${currentTurn}/${spotlightLimit.limit} → ${projectedTurn}/${spotlightLimit.limit}`;

  const featureCost = nativeEmbedded?.available
    ? `${expectedNativeFearCost} Fear — Daggerheart`
    : plan.featureFearCost > 0
      ? `${plan.featureFearCost} Fear — QOL`
      : "0 Fear";

  const affordable =
    totalFear === 0
    || (fear.available && fear.current >= totalFear);

  return {
    heading: `${plan.tokenName} — ${plan.actionName}`,
    totalFear,
    rows: [
      ["GM Move", moveLabel],
      ["Spotlight", spotlightLabel],
      ["Spotlight Limit", `${spotlightLimit.limit} · ${spotlightLimit.sourceLabel}`],
      ["Feature Cost", featureCost],
      ["Native Feature", nativeEmbedded?.available
        ? "Available — exactly one Daggerheart Action"
        : `Unavailable — ${nativeEmbedded?.reason ?? "native Action unavailable"}`],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      plan.grantedSpotlight
        ? "This transaction consumes an already-recorded granted Spotlight without adding another GM Move or TURN/TOTAL mark."
        : "The QOL layer owns GM Move Fear and Spotlight bookkeeping.",
      nativeEmbedded?.available
        ? "Commit & Use then hands native feature costs, dialogs, rolls, targets, damage, uses, and effects to Daggerheart."
        : "Bookkeeping Only records the supported QOL bookkeeping; resolve the feature manually.",
      "Undo GM Move reverses QOL bookkeeping only; native Daggerheart outcomes are not reversed."
    ],
    warning: affordable
      ? null
      : fear.available
        ? `INSUFFICIENT FEAR — this transaction requires ${totalFear}.`
        : "NATIVE FEAR UNAVAILABLE — commit will be rejected."
  };
}

function showActionTransactionPreview(tokenId, entryId) {
  const plan = buildActionTransactionPlan(tokenId, entryId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return;
  }

  const buttons = {};

  if (plan.standardAttack) {
    const nativeAttack = resolveNativeStandardAttackCapability(
      tokenId,
      entryId
    );

    buttons.commitAndRoll = {
      label: "Commit & Roll",
      callback: () => commitActionTransaction(
        tokenId,
        entryId,
        { executionMode: "native-standard" }
      )
    };

    buttons.bookkeepOnly = {
      label: "Bookkeeping Only",
      callback: () => commitActionTransaction(
        tokenId,
        entryId,
        { executionMode: "bookkeeping-only" }
      )
    };

    buttons.cancel = {
      label: "Cancel"
    };

    new Dialog(
      {
        title: plan.grantedSpotlight
          ? "GM Action Transaction — Granted Spotlight"
          : "GM Action Transaction",
        content: renderStandardAttackCompactPreviewContent(plan),
        buttons,
        default: "cancel",
        render: html => configureStandardAttackDialogButtons(
          html,
          {
            nativeAvailable: nativeAttack.available,
            nativeReason: nativeAttack.reason
          }
        )
      },
      {
        width: 620,
        height: 300,
        resizable: true
      }
    ).render(true);

    return;
  }

  const nativeEmbedded = resolveNativeEmbeddedActionCapability(
    tokenId,
    entryId
  );

  const preview = buildEmbeddedActionCompactPreview(plan, nativeEmbedded);

  buttons.commitAndUse = {
    label: "Commit & Use",
    callback: () => commitActionTransaction(
      tokenId,
      entryId,
      { executionMode: "native-embedded" }
    )
  };

  buttons.bookkeepOnly = {
    label: "Bookkeeping Only",
    callback: () => commitActionTransaction(
      tokenId,
      entryId,
      { executionMode: "bookkeeping-only" }
    )
  };

  buttons.cancel = { label: "Cancel" };

  new Dialog(
    {
      title: plan.grantedSpotlight
        ? "GM Action Transaction — Granted Spotlight"
        : "GM Action Transaction",
      content: renderQolCompactTransactionContent(preview),
      buttons,
      default: "cancel",
      render: html => configureQolCompactTransactionButtons(
        html,
        {
          titles: {
            commitAndUse: nativeEmbedded.available
              ? "Commit GM Move/Fear/Spotlight bookkeeping, then invoke the native Daggerheart feature Action."
              : `Native feature execution is unavailable: ${nativeEmbedded.reason ?? "native Action unavailable"}.`,
            bookkeepOnly:
              "Commit only the supported GM Move/Fear/Spotlight bookkeeping and resolve the feature manually.",
            cancel:
              "Close this transaction without spending Fear, recording a GM Move or Spotlight, or using the feature."
          },
          disabled: { commitAndUse: !nativeEmbedded.available }
        }
      )
    },
    getQolCompactDialogOptions()
  ).render(true);
}

async function commitActionTransaction(
  tokenId,
  entryId,
  { executionMode = "bookkeeping-only" } = {}
) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const plan = buildActionTransactionPlan(tokenId, entryId);
  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return false;
  }

  if (plan.sceneId !== canvas?.scene?.id) {
    ui.notifications.warn("The active Scene changed before the transaction could commit.");
    return false;
  }

  const nativeStandard = executionMode === "native-standard";
  const nativeEmbedded = executionMode === "native-embedded";
  const nativeExecution = nativeStandard || nativeEmbedded;

  let nativeCapability = null;
  let expectedNativeFearCost = 0;

  if (nativeStandard) {
    if (!plan.standardAttack) {
      ui.notifications.warn("Native standard execution requires the built-in adversary attack.");
      return false;
    }

    nativeCapability = resolveNativeStandardAttackCapability(tokenId, entryId);
    if (!nativeCapability.available) {
      ui.notifications.warn(nativeCapability.reason);
      return false;
    }
  } else if (nativeEmbedded) {
    if (plan.standardAttack) {
      ui.notifications.warn("Native embedded execution requires a feature Action.");
      return false;
    }

    nativeCapability = resolveNativeEmbeddedActionCapability(tokenId, entryId);
    if (!nativeCapability.available) {
      ui.notifications.warn(nativeCapability.reason);
      return false;
    }

    expectedNativeFearCost = Math.max(
      0,
      Number(nativeCapability.expectedNativeFearCost) || 0
    );
  } else if (executionMode !== "bookkeeping-only") {
    ui.notifications.warn("Unknown GM Action transaction execution mode.");
    return false;
  }

  // Cost ownership:
  // - GM Move Fear is waived when consuming a granted Spotlight.
  // - bookkeeping-only feature Fear remains QOL-owned.
  // - native embedded feature Fear remains Daggerheart-owned.
  const inspectorFearCost = nativeEmbedded
    ? plan.moveFearCost
    : plan.totalFearCost;

  const requiredFearBeforeCommit = nativeEmbedded
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const fear = getFearState();
  if (!fear.available || fear.current < requiredFearBeforeCommit) {
    ui.notifications.warn(
      `Not enough native Daggerheart Fear. This transaction requires ${requiredFearBeforeCommit} available before commit.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const preparedBeforeCommit = plan.grantedSpotlight
    ? null
    : getPreparedGmMove();
  const grantBeforeCommit = plan.grantedSpotlight
    ? findAvailableGrantedSpotlight(plan.tokenId)
    : null;
  let fearSpent = false;

  if (plan.grantedSpotlight) {
    if (
      !grantBeforeCommit
      || grantBeforeCommit.ledgerIndex !== plan.grantLedgerIndex
      || grantBeforeCommit.grantIndex !== plan.grantIndex
    ) {
      ui.notifications.warn(
        "The granted Spotlight changed or was consumed before commit. Reopen the Action preview."
      );
      return false;
    }
  } else {
    if (Boolean(preparedBeforeCommit) !== Boolean(plan.preparedMove)) {
      ui.notifications.warn("GM Move readiness changed before commit. Reopen the Action preview.");
      return false;
    }

    if (
      preparedBeforeCommit
      && preparedBeforeCommit.index !== plan.preparedMoveIndex
    ) {
      ui.notifications.warn("The prepared GM Move changed before commit. Reopen the Action preview.");
      return false;
    }
  }

  try {
    grantModeLedgerIndex = null;
    actionTransactionPending = true;

    if (inspectorFearCost > 0) {
      fearSpent = await spendNativeFear(
        inspectorFearCost,
        plan.grantedSpotlight
          ? `Granted Spotlight feature cost: ${plan.actionName}`
          : `GM Action transaction: ${plan.actionName}`
      );
      if (!fearSpent) return false;
    }

    if (plan.grantedSpotlight) {
      const ownerEntry = gmMoveLedger[plan.grantLedgerIndex];
      if (ownerEntry?.transactionType !== "action") {
        throw new Error("The owning GM Action transaction is no longer available.");
      }

      const grants = sanitizeGrantedSpotlights(ownerEntry.grantedSpotlights);
      const grant = grants[plan.grantIndex];

      if (
        !grant
        || grant.status !== "available"
        || String(grant.tokenId) !== String(plan.tokenId)
      ) {
        throw new Error("The granted Spotlight is no longer available.");
      }

      // Consume the already-recorded Spotlight entitlement. Do NOT create a
      // GM Move and do NOT touch TURN/TOTAL; the grant did that at grant time.
      grant.status = "used";
      grant.actionName = plan.actionName;
      grant.itemId = plan.itemId;
      grant.nativeActionId = nativeEmbedded
        ? String(nativeCapability?.nativeActionId ?? "")
        : null;
      grant.executionMode = executionMode;
      grant.executionStatus = nativeExecution
        ? "pending-native"
        : "bookkeeping-only";
      grant.expectedNativeFearCost = expectedNativeFearCost;
      grant.featureFearCost = nativeEmbedded ? 0 : plan.featureFearCost;
      grant.inspectorFearCost = inspectorFearCost;
      grant.eventSequence = allocateGmEventSequence();

      // The owning transaction stays the grant owner, but its event sequence
      // advances so a granted Action after a Reaction correctly becomes the
      // latest GM event in the dialog.
      ownerEntry.eventSequence = grant.eventSequence;
      ownerEntry.grantedSpotlights = grants;

      // Keep QOL-owned bookkeeping Fear refundable with the owning GM
      // Move. Native Daggerheart feature costs are deliberately not included.
      ownerEntry.fearCost =
        Math.max(0, Number(ownerEntry.fearCost) || 0)
        + inspectorFearCost;
    } else if (preparedBeforeCommit) {
      // Prepared move was already acquired/paid. Consume that SAME entry.
      const ledgerEntry = preparedBeforeCommit.entry;

      ledgerEntry.fearCost =
        Math.max(0, Number(ledgerEntry.fearCost) || 0)
        + inspectorFearCost;
      ledgerEntry.featureFearCost = nativeEmbedded ? 0 : plan.featureFearCost;
      ledgerEntry.expectedNativeFearCost = expectedNativeFearCost;
      ledgerEntry.transactionType = "action";
      ledgerEntry.executionMode = executionMode;
      ledgerEntry.executionStatus = nativeExecution
        ? "pending-native"
        : "bookkeeping-only";
      ledgerEntry.moveStatus = "used";
      ledgerEntry.tokenId = plan.tokenId;
      ledgerEntry.itemId = plan.itemId;
      ledgerEntry.nativeActionId = nativeEmbedded
        ? String(nativeCapability?.nativeActionId ?? "")
        : null;
      ledgerEntry.actionName = plan.actionName;
      ledgerEntry.eventSequence = allocateGmEventSequence();
      ledgerEntry.spotlightDelta = plan.spotlightDelta;
      ledgerEntry.grantedSpotlights = [];
    } else {
      // Normal direct path: acquire and immediately use one new GM Move.
      gmMovesThisTurn += 1;
      gmMoveLedger.push({
        kind: plan.moveKind,
        fearCost: inspectorFearCost,
        moveFearCost: plan.moveFearCost,
        featureFearCost: nativeEmbedded ? 0 : plan.featureFearCost,
        expectedNativeFearCost,
        transactionType: "action",
        executionMode,
        executionStatus: nativeExecution ? "pending-native" : "bookkeeping-only",
        moveStatus: "used",
        tokenId: plan.tokenId,
        itemId: plan.itemId,
        nativeActionId: nativeEmbedded
          ? String(nativeCapability?.nativeActionId ?? "")
          : null,
        actionName: plan.actionName,
        eventSequence: allocateGmEventSequence(),
        spotlightDelta: plan.spotlightDelta,
        grantedSpotlights: []
      });
    }

    if (plan.spotlightDelta > 0) {
      adjustSpotlightCounts(plan.tokenId, plan.spotlightDelta);
    }

    const saved = await persistCombatState();
    if (!saved) {
      restoreCombatStateMemory(before);

      if (fearSpent && inspectorFearCost > 0) {
        const refunded = await refundNativeFear(
          inspectorFearCost,
          "failed GM Action transaction state save"
        );
        if (!refunded) {
          ui.notifications.error(
            "Action transaction save failed and the Fear refund also failed. Check native Fear manually."
          );
        }
      }

      return false;
    }

    refreshInspector();

    if (executionMode === "bookkeeping-only" && plan.manualCosts.length) {
      ui.notifications.warn(
        `GM Action bookkeeping committed. Manual cost remains: ${plan.manualCosts.join("; ")}`
      );
    }

    if (nativeExecution) {
      try {
        const nativeResult = nativeStandard
          ? await invokeNativeStandardAttack(plan)
          : await invokeNativeEmbeddedAction(plan);

        const executionRecord = getActionExecutionRecord(plan);
        if (executionRecord) {
          executionRecord.executionStatus = nativeResult === undefined
            ? "cancelled"
            : "completed";

          const statusSaved = await persistCombatState();
          if (!statusSaved) {
            ui.notifications.warn(
              "Native Action finished, but its execution status could not be persisted. Bookkeeping remains committed."
            );
          }
        }

        refreshInspector();

        if (nativeResult === undefined) {
          ui.notifications.warn(
            `Native Daggerheart Action did not complete for ${plan.tokenName} — ${plan.actionName}. ` +
            "QOL bookkeeping remains committed."
          );
        }
      } catch (error) {
        console.error(
          "Cybermancy GM QOL | Native Daggerheart Action invocation failed after bookkeeping commit",
          error
        );

        const executionRecord = getActionExecutionRecord(plan);
        if (executionRecord) {
          executionRecord.executionStatus = "failed";
          const statusSaved = await persistCombatState();
          if (!statusSaved) {
            ui.notifications.warn(
              "Native Action failure status could not be persisted. Bookkeeping remains committed."
            );
          }
        }

        refreshInspector();

        ui.notifications.error(
          `Native Action invocation failed for ${plan.tokenName} — ${plan.actionName}. ` +
          "QOL bookkeeping remains committed; native costs/effects are not automatically reversed."
        );

        return {
          committed: true,
          nativeExecutionInvoked: true,
          nativeExecutionStatus: "failed",
          grantedSpotlight: plan.grantedSpotlight,
          error
        };
      }
    }

    const executionRecord = getActionExecutionRecord(plan);

    return {
      committed: true,
      grantedSpotlight: plan.grantedSpotlight,
      nativeExecutionInvoked: nativeExecution,
      nativeExecutionStatus: nativeExecution
        ? executionRecord?.executionStatus ?? null
        : "bookkeeping-only"
    };
  } finally {
    actionTransactionPending = false;

    // Always rerender after releasing the transaction lock.
    refreshInspector();
  }
}

function renderActionTransactionControl(entry, group) {
  const actor = group?.actor ?? group?.tokens?.[0]?.actor ?? null;
  const compatibility = classifyFeatureCompatibility(actor, entry);

  if (["ambiguous", "unknown"].includes(compatibility.bucket)) {
    return `
      <span class="cmgi-action-manual"
            title="${escapeHtml(compatibility.reason ?? "Structured metadata is insufficient for safe execution.")}">
        ${escapeHtml(compatibility.source)}
      </span>`;
  }

  const reactionCapability = resolveReactionTransactionCapability(entry);

  if (reactionCapability.eligible) {
    return renderAdversaryReactionTransactionControl(entry, group);
  }

  const capability = resolveActionTransactionCapability(entry);

  if (!capability.eligible) {
    return `
      <span class="cmgi-action-manual"
            title="${escapeHtml(capability.reason ?? compatibility.reason ?? "Manual action bookkeeping required.")}">
        MANUAL
      </span>`;
  }

  const selectedToken = getSelectedTokenForGroup(group);

  if (!selectedToken) {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="Select an exact token from this adversary group before using the transaction.">
        SELECT TOKEN
      </button>`;
  }

  if (isAdversaryDefeated(selectedToken)) {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="This adversary is defeated and cannot take a normal Action.">
        DEFEATED
      </button>`;
  }

  if (spotlightOwner !== "GM") {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="Take GM Spotlight before using an adversary Action transaction.">
        GM SPOTLIGHT
      </button>`;
  }

  const availableGrant = findAvailableGrantedSpotlight(selectedToken.id);

  return `
    <button
      type="button"
      class="cmgi-action-use"
      data-action="preview-action-transaction"
      data-token-id="${escapeHtml(selectedToken.id)}"
      data-entry-id="${escapeHtml(entry.id)}"
      ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
      title="${availableGrant
        ? "Use one available granted Spotlight for this exact token. No GM Move Fear, no new GM Move, and no additional TURN/TOTAL mark will be added. Feature-specific costs still apply."
        : "Preview GM Move + feature costs + exact-token Spotlight bookkeeping. Eligible standard attacks and single embedded Actions can invoke Daggerheart natively."}">
      ${availableGrant ? "USE · GRANTED" : "USE"}
    </button>`;
}

function renderActionBadges(entry, fear) {
  const badges = [];

  badges.push(
    `<span class="cmgi-action-badge cmgi-kind" title="${escapeHtml(
      entry.kind.source === "explicit"
        ? "Classification supplied by flags.cybermancy.gmAction."
        : entry.kind.source === "native"
          ? "Classification supplied by structured Daggerheart action data."
          : "No structured action classification is available; no inference was made."
    )}">${escapeHtml(entry.kind.label)}</span>`
  );

  for (const range of entry.ranges) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-range">${escapeHtml(capitalize(range))}</span>`
    );
  }

  for (const cost of entry.costs) {
    const formatted = formatCost(cost, fear);
    badges.push(
      `<span class="cmgi-action-badge ${escapeHtml(formatted.className)}"
             title="${escapeHtml(formatted.title)}">${escapeHtml(formatted.text)}</span>`
    );
  }

  if (entry.fastPlayReferenced) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-fastplay-ref"
             title="This feature is referenced by the Actor's structured Fast Play prompts.">FAST PLAY</span>`
    );
  }

  if (entry.explicit) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-explicit-badge"
             title="This feature contains explicit Cybermancy gmAction metadata.">EXPLICIT</span>`
    );
  }

  return badges.join("");
}

function renderActionDetails(entry) {
  const description = entry.description?.trim();
  const descriptionHtml = description
    ? `<div class="cmgi-feature-description">${description}</div>`
    : `<div class="cmgi-muted">No feature description is stored on this entry.</div>`;

  const metadataHtml = entry.explicit
    ? `
      <details class="cmgi-inline-meta">
        <summary>gmAction metadata</summary>
        <code>${escapeHtml(JSON.stringify(entry.metadata))}</code>
      </details>`
    : "";

  return `
    ${entry.detailsHtml}
    ${descriptionHtml}
    ${metadataHtml}`;
}

function renderGmActions(actor, group) {
  const entries = buildGmActionEntries(actor);
  const fear = getFearState();

  if (!entries.length) {
    return `
      <div class="cmgi-actions">
        <div class="cmgi-section-title">GM ACTIONS</div>
        <div class="cmgi-muted">No standard attack or embedded feature Items found.</div>
      </div>`;
  }

  const rows = entries.map(entry => `
    <div class="cmgi-action-shell">
      <details class="cmgi-action-entry">
        <summary>
          <span class="cmgi-action-name">${escapeHtml(entry.name)}</span>
          <span class="cmgi-action-badges">${renderActionBadges(entry, fear)}</span>
        </summary>
        <div class="cmgi-action-details">
          ${renderActionDetails(entry)}
          ${renderCompatibilityDiagnosticForEntry(actor, entry)}
        </div>
      </details>
      <div class="cmgi-action-control">
        ${renderActionTransactionControl(entry, group)}
      </div>
    </div>
  `).join("");

  const gmActionsInfo =
    "USE previews GM Move + structured feature Fear + the selected exact token's Spotlight. " +
    "Standard attacks can COMMIT & ROLL. A feature with exactly one safe native Daggerheart Attack/Action can COMMIT & USE. " +
    "QOL owns GM Move Fear; Daggerheart owns native feature costs. Structured Reactions and explicit non-Spotlight features use REACT and do not consume a GM Move or adversary Spotlight. " +
    "Passives, ambiguous multi-Action features, and unclassified features remain reference-only or MANUAL.";

  return `
    <div class="cmgi-actions">
      <div class="cmgi-section-title cmgi-section-title-with-info">
        <span>GM ACTIONS</span>
        <span class="cmgi-info-icon"
              tabindex="0"
              role="img"
              aria-label="GM Actions information"
              title="${escapeHtml(gmActionsInfo)}">ⓘ</span>
      </div>
      ${rows}
    </div>`;
}

// ===== 65-environment-actions.js =====
/* -------------------------------------------- */
/*  Environment Action Transactions             */
/* -------------------------------------------- */

function resolveActiveEnvironmentRecord(environmentUuid) {
  if (!environmentUuid || !canvas?.scene) return null;

  const discovery = getSceneEnvironments(canvas.scene);
  const record = (discovery.effective ?? []).find(
    candidate => String(candidate?.uuid ?? "") === String(environmentUuid)
  ) ?? null;

  if (!record?.resolved || !record.actor || !isEnvironmentActor(record.actor)) {
    return null;
  }

  return record;
}

function resolveEnvironmentActionTransactionCapability(entry) {
  if (!entry) {
    return { eligible: false, reason: "Environment Action data unavailable." };
  }

  if (entry.standardAttack) {
    return {
      eligible: false,
      reason: "Environment transactions use embedded Environment feature Actions, not a standard adversary attack."
    };
  }

  const kind = String(entry.kind?.label ?? "").toLowerCase();

  if (!["attack", "action"].includes(kind)) {
    return {
      eligible: false,
      reason: "Only confidently classified Environment Attacks and Actions can consume a GM Move in v0.20."
    };
  }

  if (hasAmbiguousNativeActions(entry)) {
    return {
      eligible: false,
      reason: "This Environment feature contains multiple structured actions with different types or costs."
    };
  }

  const fear = resolveSingleStructuredCost(entry, "fear");
  if (fear.ambiguous) {
    return { eligible: false, reason: fear.reason };
  }

  return {
    eligible: true,
    reason: null,
    featureFearCost: fear.value,
    spotlightDelta: 0,
    usesAdversarySpotlight: false,
    manualCosts: getManualStructuredCosts(entry)
  };
}

function buildEnvironmentActionTransactionPlan(environmentUuid, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  if (spotlightOwner !== "GM") {
    return {
      valid: false,
      reason: "Take GM Spotlight before using an Environment Action transaction."
    };
  }

  const record = resolveActiveEnvironmentRecord(environmentUuid);
  if (!record) {
    return {
      valid: false,
      reason: "The intended Environment is no longer active on the current Scene."
    };
  }

  const entry = findLiveActionEntry(record.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      valid: false,
      reason: "The intended Environment feature Action is no longer available."
    };
  }

  const capability = resolveEnvironmentActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { valid: false, reason: capability.reason };
  }

  const prepared = getPreparedGmMove();
  const moveFearCost = prepared ? 0 : getNewGmMoveCost();

  if (moveFearCost === null) {
    return { valid: false, reason: "GM Move cost could not be resolved." };
  }

  const preparedMoveFearCost = prepared
    ? Math.max(0, Number(prepared.entry.moveFearCost) || 0)
    : 0;

  const featureFearCost = Math.max(0, Number(capability.featureFearCost) || 0);

  return {
    valid: true,
    sceneId: canvas.scene.id,
    environmentUuid: String(record.uuid),
    environmentName: record.actor?.name ?? record.name ?? "Environment",
    environmentSource: record.linked ? "linked" : "token",
    actorId: record.actor?.id ?? null,
    entryId: entry.id,
    itemId: entry.id,
    actionName: entry.name,
    standardAttack: false,
    preparedMove: Boolean(prepared),
    preparedMoveIndex: prepared?.index ?? null,
    preparedMoveFearCost,
    preparedMoveKind: prepared?.entry?.kind ?? null,
    moveKind: prepared
      ? prepared.entry.kind
      : moveFearCost === 0
        ? "base"
        : "additional",
    moveFearCost,
    featureFearCost,
    totalFearCost: moveFearCost + featureFearCost,
    spotlightDelta: 0,
    usesAdversarySpotlight: false,
    manualCosts: capability.manualCosts ?? []
  };
}

function resolveNativeEnvironmentActionCapability(environmentUuid, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { available: false, reason: "No ready Canvas Scene." };
  }

  const record = resolveActiveEnvironmentRecord(environmentUuid);
  if (!record) {
    return {
      available: false,
      reason: "The intended Environment is no longer active on the current Scene."
    };
  }

  const entry = findLiveActionEntry(record.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      available: false,
      reason: "Native Environment execution requires an embedded feature Action."
    };
  }

  const capability = resolveEnvironmentActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { available: false, reason: capability.reason };
  }

  const item = getFeatureItemForEntry(record.actor, entryId);
  if (!item) {
    return {
      available: false,
      reason: "The embedded Environment feature Item is no longer available."
    };
  }

  const actions = getNativeActions(item);
  if (actions.length !== 1) {
    return {
      available: false,
      reason: actions.length === 0
        ? "This Environment feature has no executable native Daggerheart Action."
        : "Native Environment execution requires exactly one Daggerheart Action in the feature."
    };
  }

  const action = actions[0];
  if (!action || typeof action.use !== "function") {
    return {
      available: false,
      reason: "The Environment feature's native Action does not expose Daggerheart Action.use()."
    };
  }

  const nativeKind = String(
    action?.type === "attack" ? "attack" : action?.actionType ?? ""
  ).toLowerCase();

  if (!["attack", "action"].includes(nativeKind)) {
    return {
      available: false,
      reason: "Only native Environment Attack/Action workflows are executable in v0.20."
    };
  }

  const metadataMatch = explicitMetadataMatchesNativeCosts(entry, action);
  if (!metadataMatch.matches) {
    return { available: false, reason: metadataMatch.reason };
  }

  const nativeFear = getNativeActionFearCost(action);
  if (nativeFear.ambiguous) {
    return { available: false, reason: nativeFear.reason };
  }

  return {
    available: true,
    reason: null,
    record,
    actor: record.actor,
    item,
    action,
    entry,
    nativeActionId: action.id ?? action._id ?? null,
    expectedNativeFearCost: nativeFear.value,
    nativeCosts: getNativeActionCostLabels(action),
    systemVersion: game.system?.version ?? null,
    validatedVersion: NATIVE_ATTACK_VALIDATED_DH_VERSION,
    versionMatches: game.system?.version === NATIVE_ATTACK_VALIDATED_DH_VERSION
  };
}

async function invokeNativeEnvironmentAction(plan) {
  const capability = resolveNativeEnvironmentActionCapability(
    plan?.environmentUuid,
    plan?.entryId
  );

  if (!capability.available) throw new Error(capability.reason);

  const { actor, item, action } = capability;
  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart Environment Action",
    {
      environment: actor?.name,
      environmentUuid: plan.environmentUuid,
      actorUuid: actor?.uuid,
      item: item?.name,
      itemId: item?.id,
      action: action?.name,
      actionId: action?.id ?? action?._id,
      daggerheartVersion: game.system?.version
    }
  );

  return action.use(nativeEvent);
}

function getLastGmActionTransactionWithIndex() {
  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];
    if (
      ["action", "environment-action"].includes(entry?.transactionType)
      && entry?.actionName
    ) {
      return { entry, index };
    }
  }
  return null;
}

function renderLastEnvironmentActionSummary(latest) {
  if (!latest?.entry) return "";

  const { entry } = latest;
  const record = entry.environmentUuid
    ? resolveActiveEnvironmentRecord(entry.environmentUuid)
    : null;

  const environmentName =
    record?.actor?.name
    ?? record?.name
    ?? entry.environmentUuid
    ?? "Environment";

  const status = entry.executionStatus
    ? String(entry.executionStatus).replaceAll("-", " ").toUpperCase()
    : "";

  return `
    <div class="cmgi-last-action"
         title="Most recent committed Environment Action transaction in the current GM turn.">
      <span class="cmgi-last-action-label">LAST GM EVENT</span>
      <strong>${escapeHtml(environmentName)} — ${escapeHtml(entry.actionName)}</strong>
      <span class="cmgi-last-action-status">ENVIRONMENT</span>
      ${status ? `<span class="cmgi-last-action-status">${escapeHtml(status)}</span>` : ""}
      <span class="cmgi-muted">NO ADVERSARY SPOTLIGHT</span>
    </div>`;
}

function renderEnvironmentActionTransactionControl(environmentUuid, entry) {
  const actor = resolveActiveEnvironmentRecord(environmentUuid)?.actor ?? null;
  const compatibility = classifyFeatureCompatibility(actor, entry);

  if (["ambiguous", "unknown"].includes(compatibility.bucket)) {
    return `
      <span class="cmgi-environment-readonly"
            title="${escapeHtml(compatibility.reason ?? "Structured metadata is insufficient for safe execution.")}">
        ${escapeHtml(compatibility.source)}
      </span>`;
  }

  const reactionCapability = resolveReactionTransactionCapability(entry);

  if (reactionCapability.eligible) {
    return renderEnvironmentReactionTransactionControl(
      environmentUuid,
      entry
    );
  }

  const capability = resolveEnvironmentActionTransactionCapability(entry);

  if (!capability.eligible) {
    const kind = String(entry?.kind?.label ?? "").toLowerCase();
    const transactionLike = ["attack", "action"].includes(kind);

    return `
      <span class="cmgi-environment-readonly"
            title="${escapeHtml(capability.reason ?? "Reference-only Environment feature.")}">
        ${transactionLike ? "MANUAL" : "REFERENCE"}
      </span>`;
  }

  if (spotlightOwner !== "GM") {
    return `
      <button type="button"
              class="cmgi-action-use"
              disabled
              title="Take GM Spotlight before using an Environment Action transaction.">
        GM SPOTLIGHT
      </button>`;
  }

  return `
    <button type="button"
            class="cmgi-action-use"
            data-action="preview-environment-action-transaction"
            data-environment-uuid="${escapeHtml(environmentUuid)}"
            data-entry-id="${escapeHtml(entry.id)}"
            ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
            title="Preview this Environment Action. It uses the shared GM Move economy but never consumes an adversary Spotlight.">
      USE
    </button>`;
}

function buildEnvironmentCompactPreview(plan, nativeEmbedded) {
  const fear = getFearState();

  const expectedNativeFearCost = nativeEmbedded?.available
    ? Math.max(0, Number(nativeEmbedded.expectedNativeFearCost) || 0)
    : 0;

  const totalFear = nativeEmbedded?.available
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const moveLabel = plan.preparedMove
    ? plan.preparedMoveFearCost > 0
      ? `READY — ${plan.preparedMoveFearCost} Fear already paid`
      : "READY — base GM Move prepared"
    : plan.moveFearCost === 0
      ? "BASE — 0 Fear"
      : `ADDITIONAL — ${plan.moveFearCost} Fear`;

  const featureCost = nativeEmbedded?.available
    ? `${expectedNativeFearCost} Fear — Daggerheart`
    : plan.featureFearCost > 0
      ? `${plan.featureFearCost} Fear — QOL`
      : "0 Fear";

  const affordable =
    totalFear === 0
    || (fear.available && fear.current >= totalFear);

  return {
    heading: `${plan.environmentName} — ${plan.actionName}`,
    totalFear,
    rows: [
      ["GM Move", moveLabel],
      ["Adversary Spotlight", "NONE"],
      ["Feature Cost", featureCost],
      ["Native Feature", nativeEmbedded?.available
        ? "Available — exactly one Daggerheart Action"
        : `Unavailable — ${nativeEmbedded?.reason ?? "native Action unavailable"}`],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      "Environment Actions use the shared GM Move economy but never consume adversary Spotlight or change TURN/LINK/TOTAL.",
      nativeEmbedded?.available
        ? "Commit & Use records QOL GM Move bookkeeping, then Daggerheart owns the Environment feature's native workflow."
        : "Bookkeeping Only records the supported QOL bookkeeping; resolve the Environment feature manually.",
      "Undo GM Move reverses QOL bookkeeping only; native Daggerheart outcomes are not reversed."
    ],
    warning: affordable
      ? null
      : fear.available
        ? `INSUFFICIENT FEAR — this transaction requires ${totalFear}.`
        : "NATIVE FEAR UNAVAILABLE — commit will be rejected."
  };
}

function showEnvironmentActionTransactionPreview(environmentUuid, entryId) {
  const plan = buildEnvironmentActionTransactionPlan(environmentUuid, entryId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return;
  }

  const nativeEmbedded = resolveNativeEnvironmentActionCapability(
    environmentUuid,
    entryId
  );

  const preview = buildEnvironmentCompactPreview(plan, nativeEmbedded);

  const buttons = {
    commitAndUse: {
      label: "Commit & Use",
      callback: () => commitEnvironmentActionTransaction(
        environmentUuid,
        entryId,
        { executionMode: "native-embedded" }
      )
    },
    bookkeepOnly: {
      label: "Bookkeeping Only",
      callback: () => commitEnvironmentActionTransaction(
        environmentUuid,
        entryId,
        { executionMode: "bookkeeping-only" }
      )
    },
    cancel: { label: "Cancel" }
  };

  new Dialog(
    {
      title: "Environment Action Transaction",
      content: renderQolCompactTransactionContent(preview),
      buttons,
      default: "cancel",
      render: html => configureQolCompactTransactionButtons(
        html,
        {
          titles: {
            commitAndUse: nativeEmbedded.available
              ? "Commit the GM Move bookkeeping, then invoke the native Daggerheart Environment Action. No adversary Spotlight is consumed."
              : `Native Environment execution is unavailable: ${nativeEmbedded.reason ?? "native Action unavailable"}.`,
            bookkeepOnly:
              "Commit only the supported Environment GM Move/Fear bookkeeping. Do not invoke the native feature.",
            cancel:
              "Close this transaction without spending Fear, recording a GM Move, or using the Environment feature."
          },
          disabled: { commitAndUse: !nativeEmbedded.available }
        }
      )
    },
    getQolCompactDialogOptions()
  ).render(true);
}

async function commitEnvironmentActionTransaction(
  environmentUuid,
  entryId,
  { executionMode = "bookkeeping-only" } = {}
) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const plan = buildEnvironmentActionTransactionPlan(environmentUuid, entryId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return false;
  }

  if (plan.sceneId !== canvas?.scene?.id) {
    ui.notifications.warn(
      "The active Scene changed before the Environment transaction could commit."
    );
    return false;
  }

  const nativeEmbedded = executionMode === "native-embedded";
  const nativeExecution = nativeEmbedded;

  let nativeCapability = null;
  let expectedNativeFearCost = 0;

  if (nativeEmbedded) {
    nativeCapability = resolveNativeEnvironmentActionCapability(
      environmentUuid,
      entryId
    );

    if (!nativeCapability.available) {
      ui.notifications.warn(nativeCapability.reason);
      return false;
    }

    expectedNativeFearCost = Math.max(
      0,
      Number(nativeCapability.expectedNativeFearCost) || 0
    );
  } else if (executionMode !== "bookkeeping-only") {
    ui.notifications.warn(
      "Unknown Environment Action transaction execution mode."
    );
    return false;
  }

  const inspectorFearCost = nativeEmbedded
    ? plan.moveFearCost
    : plan.totalFearCost;

  const requiredFearBeforeCommit = nativeEmbedded
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const fear = getFearState();
  if (!fear.available || fear.current < requiredFearBeforeCommit) {
    ui.notifications.warn(
      `Not enough native Daggerheart Fear. This Environment transaction requires ${requiredFearBeforeCommit} available before commit.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const preparedBeforeCommit = getPreparedGmMove();
  let fearSpent = false;
  let committedEntry = null;

  if (Boolean(preparedBeforeCommit) !== Boolean(plan.preparedMove)) {
    ui.notifications.warn(
      "GM Move readiness changed before commit. Reopen the Environment Action preview."
    );
    return false;
  }

  if (
    preparedBeforeCommit
    && preparedBeforeCommit.index !== plan.preparedMoveIndex
  ) {
    ui.notifications.warn(
      "The prepared GM Move changed before commit. Reopen the Environment Action preview."
    );
    return false;
  }

  try {
    grantModeLedgerIndex = null;
    actionTransactionPending = true;

    if (inspectorFearCost > 0) {
      fearSpent = await spendNativeFear(
        inspectorFearCost,
        `Environment Action transaction: ${plan.actionName}`
      );
      if (!fearSpent) return false;
    }

    if (preparedBeforeCommit) {
      committedEntry = preparedBeforeCommit.entry;

      committedEntry.fearCost =
        Math.max(0, Number(committedEntry.fearCost) || 0)
        + inspectorFearCost;
      committedEntry.featureFearCost =
        nativeEmbedded ? 0 : plan.featureFearCost;
      committedEntry.expectedNativeFearCost = expectedNativeFearCost;
      committedEntry.transactionType = "environment-action";
      committedEntry.executionMode = executionMode;
      committedEntry.executionStatus = nativeExecution
        ? "pending-native"
        : "bookkeeping-only";
      committedEntry.moveStatus = "used";
      committedEntry.tokenId = null;
      committedEntry.environmentUuid = plan.environmentUuid;
      committedEntry.itemId = plan.itemId;
      committedEntry.nativeActionId = nativeEmbedded
        ? String(nativeCapability?.nativeActionId ?? "")
        : null;
      committedEntry.actionName = plan.actionName;
      committedEntry.eventSequence = allocateGmEventSequence();
      committedEntry.spotlightDelta = 0;
      committedEntry.grantedSpotlights = [];
    } else {
      gmMovesThisTurn += 1;

      committedEntry = {
        kind: plan.moveKind,
        fearCost: inspectorFearCost,
        moveFearCost: plan.moveFearCost,
        featureFearCost: nativeEmbedded ? 0 : plan.featureFearCost,
        expectedNativeFearCost,
        transactionType: "environment-action",
        executionMode,
        executionStatus: nativeExecution ? "pending-native" : "bookkeeping-only",
        moveStatus: "used",
        tokenId: null,
        environmentUuid: plan.environmentUuid,
        itemId: plan.itemId,
        nativeActionId: nativeEmbedded
          ? String(nativeCapability?.nativeActionId ?? "")
          : null,
        actionName: plan.actionName,
        eventSequence: allocateGmEventSequence(),
        spotlightDelta: 0,
        grantedSpotlights: []
      };

      gmMoveLedger.push(committedEntry);
    }

    // No adversary Spotlight counter is touched by an Environment Action.

    const saved = await persistCombatState();
    if (!saved) {
      restoreCombatStateMemory(before);

      if (fearSpent && inspectorFearCost > 0) {
        const refunded = await refundNativeFear(
          inspectorFearCost,
          "failed Environment Action transaction state save"
        );

        if (!refunded) {
          ui.notifications.error(
            "Environment Action state save failed and the Fear refund also failed. Check native Fear manually."
          );
        }
      }

      return false;
    }

    refreshInspector();

    if (executionMode === "bookkeeping-only" && plan.manualCosts.length) {
      ui.notifications.warn(
        `Environment Action bookkeeping committed. Manual cost remains: ${plan.manualCosts.join("; ")}`
      );
    }

    if (nativeExecution) {
      try {
        const nativeResult = await invokeNativeEnvironmentAction(plan);

        committedEntry.executionStatus =
          nativeResult === undefined ? "cancelled" : "completed";

        const statusSaved = await persistCombatState();
        if (!statusSaved) {
          ui.notifications.warn(
            "Native Environment Action finished, but its execution status could not be persisted. GM Move bookkeeping remains committed."
          );
        }

        refreshInspector();

        if (nativeResult === undefined) {
          ui.notifications.warn(
            `Native Daggerheart Environment Action did not complete for ${plan.environmentName} — ${plan.actionName}. ` +
            "Inspector GM Move bookkeeping remains committed."
          );
        }
      } catch (error) {
        console.error(
          "Cybermancy GM QOL | Native Environment Action invocation failed after bookkeeping commit",
          error
        );

        committedEntry.executionStatus = "failed";
        const statusSaved = await persistCombatState();

        if (!statusSaved) {
          ui.notifications.warn(
            "Native Environment Action failure status could not be persisted. GM Move bookkeeping remains committed."
          );
        }

        refreshInspector();

        ui.notifications.error(
          `Native Environment Action invocation failed for ${plan.environmentName} — ${plan.actionName}. ` +
          "QOL bookkeeping remains committed; native costs/effects are not automatically reversed."
        );

        return {
          committed: true,
          transactionType: "environment-action",
          nativeExecutionInvoked: true,
          nativeExecutionStatus: "failed",
          error
        };
      }
    }

    return {
      committed: true,
      transactionType: "environment-action",
      nativeExecutionInvoked: nativeExecution,
      nativeExecutionStatus: nativeExecution
        ? committedEntry?.executionStatus ?? null
        : "bookkeeping-only",
      adversarySpotlightDelta: 0
    };
  } finally {
    actionTransactionPending = false;
    refreshInspector();
  }
}

// ===== 67-reactions.js =====
/* -------------------------------------------- */
/*  Reaction / Non-Spotlight Transactions       */
/* -------------------------------------------- */

function getReactionClassification(entry) {
  if (!entry || entry.standardAttack) {
    return {
      eligible: false,
      classification: null,
      source: null,
      reason: "Standard adversary attacks are GM Move Actions, not Reactions."
    };
  }

  const explicitType = String(
    entry?.metadata?.actionType ?? ""
  ).trim().toLowerCase();

  const explicitNoSpotlight =
    (Boolean(entry?.explicit) || entry?.compatibilitySource === "sidecar")
    && entry?.metadata?.usesSpotlight === false;

  if (explicitType === "reaction") {
    return {
      eligible: true,
      classification: "reaction",
      source: "explicit",
      reason: null
    };
  }

  const nativeTypes = [
    ...new Set(
      (entry?.nativeActions ?? [])
        .map(action =>
          String(
            action?.type === "attack"
              ? "attack"
              : action?.actionType ?? ""
          ).trim().toLowerCase()
        )
        .filter(Boolean)
    )
  ];

  if (nativeTypes.length === 1 && nativeTypes[0] === "reaction") {
    return {
      eligible: true,
      classification: "reaction",
      source: "native",
      reason: null
    };
  }

  // Limited explicit extension approved for v0.21. usesSpotlight:false is not
  // enough by itself; explicit actionType must also say what the feature is.
  // Passive/Feature classifications remain reference-only.
  if (
    explicitNoSpotlight
    && explicitType
    && !["passive", "feature", "attack"].includes(explicitType)
  ) {
    return {
      eligible: true,
      classification: explicitType === "reaction"
        ? "reaction"
        : "non-spotlight",
      source: "explicit",
      reason: null
    };
  }

  return {
    eligible: false,
    classification: null,
    source: null,
    reason:
      "Only structured native Reactions or explicit gmAction features with usesSpotlight:false and an unambiguous non-passive actionType use the v0.21 Reaction path."
  };
}

function resolveReactionTransactionCapability(entry) {
  const classification = getReactionClassification(entry);
  if (!classification.eligible) {
    return {
      eligible: false,
      reason: classification.reason,
      classification: null,
      classificationSource: null
    };
  }

  if (hasAmbiguousNativeActions(entry)) {
    return {
      eligible: false,
      reason: "This feature contains multiple structured actions with different types or costs.",
      classification: classification.classification,
      classificationSource: classification.source
    };
  }

  const fear = resolveSingleStructuredCost(entry, "fear");
  if (fear.ambiguous) {
    return {
      eligible: false,
      reason: fear.reason,
      classification: classification.classification,
      classificationSource: classification.source
    };
  }

  return {
    eligible: true,
    reason: null,
    classification: classification.classification,
    classificationSource: classification.source,
    featureFearCost: Math.max(0, Number(fear.value) || 0),
    usesGmMove: false,
    usesAdversarySpotlight: false,
    manualCosts: getManualStructuredCosts(entry)
  };
}

function buildAdversaryReactionTransactionPlan(tokenId, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? [])
      .find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return {
      valid: false,
      reason: "The intended adversary token is no longer available."
    };
  }

  if (isAdversaryDefeated(token)) {
    return {
      valid: false,
      reason: `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot take a Reaction.`
    };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      valid: false,
      reason: "The intended Reaction feature is no longer available."
    };
  }

  const capability = resolveReactionTransactionCapability(entry);
  if (!capability.eligible) {
    return { valid: false, reason: capability.reason };
  }

  return {
    valid: true,
    sceneId: canvas.scene.id,
    sourceType: "adversary",
    classification: capability.classification,
    tokenId: token.id,
    tokenName: token.name ?? token.actor.name ?? "Adversary",
    actorId: token.actor.id,
    actorName: token.actor.name ?? "Adversary",
    environmentUuid: null,
    entryId: entry.id,
    itemId: entry.id,
    actionName: entry.name,
    featureFearCost: capability.featureFearCost,
    manualCosts: capability.manualCosts ?? [],
    gmMoveDelta: 0,
    spotlightDelta: 0
  };
}

function buildEnvironmentReactionTransactionPlan(environmentUuid, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  const record = resolveActiveEnvironmentRecord(environmentUuid);
  if (!record) {
    return {
      valid: false,
      reason: "The intended Environment is no longer active on the current Scene."
    };
  }

  const entry = findLiveActionEntry(record.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      valid: false,
      reason: "The intended Environment Reaction feature is no longer available."
    };
  }

  const capability = resolveReactionTransactionCapability(entry);
  if (!capability.eligible) {
    return { valid: false, reason: capability.reason };
  }

  return {
    valid: true,
    sceneId: canvas.scene.id,
    sourceType: "environment",
    classification: capability.classification,
    tokenId: null,
    tokenName: null,
    actorId: record.actor?.id ?? null,
    actorName: record.actor?.name ?? record.name ?? "Environment",
    environmentUuid: String(record.uuid),
    entryId: entry.id,
    itemId: entry.id,
    actionName: entry.name,
    featureFearCost: capability.featureFearCost,
    manualCosts: capability.manualCosts ?? [],
    gmMoveDelta: 0,
    spotlightDelta: 0
  };
}

function resolveNativeReactionCapability(plan) {
  if (!plan?.valid) {
    return {
      available: false,
      reason: plan?.reason ?? "Reaction plan unavailable."
    };
  }

  let actor = null;

  if (plan.sourceType === "adversary") {
    const token = canvas?.tokens?.get(plan.tokenId)
      ?? (canvas?.tokens?.placeables ?? [])
        .find(candidate => candidate.id === plan.tokenId)
      ?? null;

    if (!token?.actor || !isAdversaryActor(token.actor)) {
      return {
        available: false,
        reason: "The intended adversary token is no longer available."
      };
    }

    actor = token.actor;
  } else {
    const record = resolveActiveEnvironmentRecord(plan.environmentUuid);
    if (!record?.actor) {
      return {
        available: false,
        reason: "The intended Environment is no longer active."
      };
    }

    actor = record.actor;
  }

  const entry = findLiveActionEntry(actor, plan.entryId);
  if (!entry || entry.standardAttack) {
    return {
      available: false,
      reason: "Native Reaction execution requires an embedded feature."
    };
  }

  const classification = resolveReactionTransactionCapability(entry);
  if (!classification.eligible) {
    return { available: false, reason: classification.reason };
  }

  const item = getFeatureItemForEntry(actor, plan.entryId);
  if (!item) {
    return {
      available: false,
      reason: "The embedded Reaction feature Item is no longer available."
    };
  }

  const actions = getNativeActions(item);
  if (actions.length !== 1) {
    return {
      available: false,
      reason:
        actions.length === 0
          ? "This Reaction feature has no executable native Daggerheart Action."
          : "Native Reaction execution requires exactly one Daggerheart Action in the feature."
    };
  }

  const action = actions[0];
  if (!action || typeof action.use !== "function") {
    return {
      available: false,
      reason: "The Reaction feature's native Action does not expose Daggerheart Action.use()."
    };
  }

  const nativeType = String(
    action?.type === "attack"
      ? "attack"
      : action?.actionType ?? ""
  ).trim().toLowerCase();

  const explicitType = String(
    entry?.metadata?.actionType ?? ""
  ).trim().toLowerCase();

  const explicitNoSpotlight =
    Boolean(entry?.explicit)
    && entry?.metadata?.usesSpotlight === false;

  const nativeTypeAllowed =
    nativeType === "reaction"
    || (
      explicitNoSpotlight
      && explicitType === "action"
      && nativeType === "action"
    );

  if (!nativeTypeAllowed) {
    return {
      available: false,
      reason:
        "Native execution is limited to a native Daggerheart Reaction, or an explicit usesSpotlight:false Action whose native Action is also structured as action."
    };
  }

  const metadataMatch = explicitMetadataMatchesNativeCosts(entry, action);
  if (!metadataMatch.matches) {
    return { available: false, reason: metadataMatch.reason };
  }

  const nativeFear = getNativeActionFearCost(action);
  if (nativeFear.ambiguous) {
    return { available: false, reason: nativeFear.reason };
  }

  return {
    available: true,
    reason: null,
    sourceType: plan.sourceType,
    actor,
    item,
    action,
    token: plan.sourceType === "adversary"
      ? (
          canvas?.tokens?.get(plan.tokenId)
          ?? (canvas?.tokens?.placeables ?? [])
            .find(candidate => candidate.id === plan.tokenId)
          ?? null
        )
      : null,
    nativeActionId: action.id ?? action._id ?? null,
    expectedNativeFearCost: Math.max(0, Number(nativeFear.value) || 0),
    nativeCosts: getNativeActionCostLabels(action)
  };
}

async function invokeNativeReaction(plan) {
  const capability = resolveNativeReactionCapability(plan);
  if (!capability.available) {
    throw new Error(capability.reason);
  }

  if (
    capability.sourceType === "adversary"
    && capability.token
    && !capability.token.controlled
  ) {
    capability.token.control({ releaseOthers: true });
  }

  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart Reaction",
    {
      sourceType: capability.sourceType,
      actorUuid: capability.actor?.uuid,
      tokenId: capability.token?.id ?? null,
      environmentUuid: plan.environmentUuid ?? null,
      item: capability.item?.name,
      itemId: capability.item?.id,
      action: capability.action?.name,
      actionId: capability.action?.id ?? capability.action?._id,
      daggerheartVersion: game.system?.version
    }
  );

  return capability.action.use(nativeEvent);
}

function renderAdversaryReactionTransactionControl(entry, group) {
  const selectedToken = getSelectedTokenForGroup(group);

  if (!selectedToken) {
    return `
      <button type="button"
              class="cmgi-action-use"
              disabled
              title="Select an exact token from this adversary group before using its Reaction.">
        SELECT TOKEN
      </button>`;
  }

  if (isAdversaryDefeated(selectedToken)) {
    return `
      <button type="button"
              class="cmgi-action-use"
              disabled
              title="This adversary is defeated and cannot take a Reaction.">
        DEFEATED
      </button>`;
  }

  return `
    <button type="button"
            class="cmgi-action-use cmgi-reaction-use"
            data-action="preview-reaction-transaction"
            data-source-type="adversary"
            data-token-id="${escapeHtml(selectedToken.id)}"
            data-entry-id="${escapeHtml(entry.id)}"
            ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
            title="Preview this Reaction/non-Spotlight feature. It does not consume a GM Move, adversary Spotlight, or Spotlight ownership.">
      REACT
    </button>`;
}

function renderEnvironmentReactionTransactionControl(environmentUuid, entry) {
  return `
    <button type="button"
            class="cmgi-action-use cmgi-reaction-use"
            data-action="preview-reaction-transaction"
            data-source-type="environment"
            data-environment-uuid="${escapeHtml(environmentUuid)}"
            data-entry-id="${escapeHtml(entry.id)}"
            ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
            title="Preview this Environment Reaction/non-Spotlight feature. It does not consume a GM Move or adversary Spotlight.">
      REACT
    </button>`;
}

function buildReactionCompactPreview(plan, native) {
  const fear = getFearState();

  const expectedNativeFearCost = native.available
    ? Math.max(0, Number(native.expectedNativeFearCost) || 0)
    : 0;

  const inspectorFearCost = native.available
    ? 0
    : Math.max(0, Number(plan.featureFearCost) || 0);

  const totalFear = native.available
    ? expectedNativeFearCost
    : inspectorFearCost;

  const affordable =
    totalFear === 0
    || (fear.available && fear.current >= totalFear);

  return {
    heading: `${plan.actorName} — ${plan.actionName}`,
    totalFear,
    rows: [
      ["GM Move", "NONE — prepared moves untouched"],
      ["Spotlight", `NONE — owner remains ${spotlightOwner}`],
      ["TURN/LINK/TOTAL", "UNCHANGED"],
      ["Feature Cost", native.available
        ? `${expectedNativeFearCost} Fear — Daggerheart`
        : inspectorFearCost > 0
          ? `${inspectorFearCost} Fear — QOL`
          : "0 Fear"],
      ["Native Feature", native.available
        ? "Available — safe Reaction/non-Spotlight Action"
        : `Unavailable — ${native.reason ?? "native execution unavailable"}`],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      "Reactions create no GM Move, consume no adversary Spotlight, and do not change Spotlight ownership.",
      "Prepared GM Moves and available granted Spotlights remain available after the Reaction.",
      native.available
        ? "React invokes Daggerheart's native feature workflow; native costs and outcomes remain Daggerheart-owned."
        : "Bookkeeping Only records explicit structured QOL Fear, if any; resolve the Reaction manually.",
      "Reaction Undo refunds only QOL-owned Fear and does not reverse native Daggerheart outcomes."
    ],
    warning: affordable
      ? null
      : fear.available
        ? `INSUFFICIENT FEAR — this Reaction requires ${totalFear}.`
        : "NATIVE FEAR UNAVAILABLE — commit will be rejected."
  };
}

function showReactionTransactionPreview({
  sourceType,
  tokenId = null,
  environmentUuid = null,
  entryId
}) {
  const plan = sourceType === "environment"
    ? buildEnvironmentReactionTransactionPlan(environmentUuid, entryId)
    : buildAdversaryReactionTransactionPlan(tokenId, entryId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return;
  }

  const native = resolveNativeReactionCapability(plan);
  const preview = buildReactionCompactPreview(plan, native);

  const buttons = {
    react: {
      label: "React",
      callback: () => commitReactionTransaction(plan, {
        executionMode: "native-embedded"
      })
    },
    bookkeepOnly: {
      label: "Bookkeeping Only",
      callback: () => commitReactionTransaction(plan, {
        executionMode: "bookkeeping-only"
      })
    },
    cancel: { label: "Cancel" }
  };

  new Dialog(
    {
      title: "Reaction / Non-Spotlight Transaction",
      content: renderQolCompactTransactionContent(preview),
      buttons,
      default: "cancel",
      render: html => configureQolCompactTransactionButtons(
        html,
        {
          titles: {
            react: native.available
              ? "Invoke the native Daggerheart Reaction/non-Spotlight feature. No GM Move or adversary Spotlight is consumed."
              : `Native Reaction execution is unavailable: ${native.reason ?? "native feature unavailable"}.`,
            bookkeepOnly:
              "Commit only explicit structured QOL Fear for this Reaction, if any. Do not invoke the native feature.",
            cancel:
              "Close this Reaction transaction without spending Fear, changing a GM Move or Spotlight, or using the feature."
          },
          disabled: { react: !native.available }
        }
      )
    },
    getQolCompactDialogOptions()
  ).render(true);
}

async function commitReactionTransaction(
  plan,
  { executionMode = "bookkeeping-only" } = {}
) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  if (!plan?.valid) {
    ui.notifications.warn(plan?.reason ?? "Reaction plan is invalid.");
    return false;
  }

  if (plan.sceneId !== canvas?.scene?.id) {
    ui.notifications.warn(
      "The active Scene changed before the Reaction could commit."
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const ownerBefore = spotlightOwner;
  const moveCountBefore = gmMovesThisTurn;
  const preparedBefore = getPreparedGmMove()
    ? foundry.utils.deepClone(getPreparedGmMove())
    : null;
  const usesBefore = Object.fromEntries(spotlightUses);
  const totalsBefore = Object.fromEntries(spotlightTotals);

  const nativeExecution = executionMode === "native-embedded";
  let native = null;
  let expectedNativeFearCost = 0;

  if (nativeExecution) {
    native = resolveNativeReactionCapability(plan);
    if (!native.available) {
      ui.notifications.warn(native.reason);
      return false;
    }

    expectedNativeFearCost = Math.max(
      0,
      Number(native.expectedNativeFearCost) || 0
    );
  } else if (executionMode !== "bookkeeping-only") {
    ui.notifications.warn("Unknown Reaction execution mode.");
    return false;
  }

  const inspectorFearCost = nativeExecution
    ? 0
    : Math.max(0, Number(plan.featureFearCost) || 0);

  const requiredFearBeforeCommit = nativeExecution
    ? expectedNativeFearCost
    : inspectorFearCost;

  const fear = getFearState();
  if (
    requiredFearBeforeCommit > 0
    && (!fear.available || fear.current < requiredFearBeforeCommit)
  ) {
    ui.notifications.warn(
      `Not enough native Daggerheart Fear. This Reaction requires ${requiredFearBeforeCommit} available before commit.`
    );
    return false;
  }

  let fearSpent = false;
  let reactionEntry = null;

  try {
    reactionTransactionPending = true;

    if (inspectorFearCost > 0) {
      fearSpent = await spendNativeFear(
        inspectorFearCost,
        `Reaction bookkeeping: ${plan.actionName}`
      );
      if (!fearSpent) return false;
    }

    reactionEntry = {
      transactionType: "reaction",
      sourceType: plan.sourceType,
      classification: plan.classification,
      tokenId: plan.sourceType === "adversary" ? plan.tokenId : null,
      environmentUuid: plan.sourceType === "environment"
        ? plan.environmentUuid
        : null,
      itemId: plan.itemId,
      nativeActionId: nativeExecution
        ? String(native?.nativeActionId ?? "")
        : null,
      actionName: plan.actionName,
      inspectorFearCost,
      expectedNativeFearCost,
      executionMode,
      executionStatus: nativeExecution
        ? "pending-native"
        : "bookkeeping-only",
      eventSequence: allocateGmEventSequence()
    };

    reactionLedger.push(reactionEntry);

    // Critical invariants: no move/Spotlight/grant state mutation occurs here.
    const saved = await persistCombatState();
    if (!saved) {
      restoreCombatStateMemory(before);

      if (fearSpent && inspectorFearCost > 0) {
        const refunded = await refundNativeFear(
          inspectorFearCost,
          "failed Reaction transaction state save"
        );

        if (!refunded) {
          ui.notifications.error(
            "Reaction state save failed and the Fear refund also failed. Check native Fear manually."
          );
        }
      }

      return false;
    }

    refreshInspector();

    if (executionMode === "bookkeeping-only" && plan.manualCosts.length) {
      ui.notifications.warn(
        `Reaction bookkeeping committed. Manual cost remains: ${plan.manualCosts.join("; ")}`
      );
    }

    if (nativeExecution) {
      try {
        const nativeResult = await invokeNativeReaction(plan);

        reactionEntry.executionStatus =
          nativeResult === undefined
            ? "cancelled"
            : "completed";

        const statusSaved = await persistCombatState();
        if (!statusSaved) {
          ui.notifications.warn(
            "Native Reaction finished, but its execution status could not be persisted. Reaction bookkeeping remains committed."
          );
        }

        refreshInspector();

        if (nativeResult === undefined) {
          ui.notifications.warn(
            `Native Daggerheart Reaction did not complete for ${plan.actorName} — ${plan.actionName}. QOL Reaction bookkeeping remains committed.`
          );
        }
      } catch (error) {
        console.error(
          "Cybermancy GM QOL | Native Reaction invocation failed after bookkeeping commit",
          error
        );

        reactionEntry.executionStatus = "failed";
        await persistCombatState();
        refreshInspector();

        ui.notifications.error(
          `Native Reaction invocation failed for ${plan.actorName} — ${plan.actionName}. QOL bookkeeping remains committed; native costs/effects are not automatically reversed.`
        );

        return {
          committed: true,
          transactionType: "reaction",
          nativeExecutionInvoked: true,
          nativeExecutionStatus: "failed",
          error
        };
      }
    }

    // Defensive invariant verification. If a future edit mutates any of these,
    // surface it loudly rather than silently changing action economy.
    const ownerUnchanged = spotlightOwner === ownerBefore;
    const movesUnchanged = gmMovesThisTurn === moveCountBefore;
    const preparedAfter = getPreparedGmMove()
      ? foundry.utils.deepClone(getPreparedGmMove())
      : null;
    const preparedUnchanged =
      JSON.stringify(preparedAfter) === JSON.stringify(preparedBefore);
    const usesUnchanged =
      JSON.stringify(Object.fromEntries(spotlightUses)) === JSON.stringify(usesBefore);
    const totalsUnchanged =
      JSON.stringify(Object.fromEntries(spotlightTotals)) === JSON.stringify(totalsBefore);

    if (
      !ownerUnchanged
      || !movesUnchanged
      || !preparedUnchanged
      || !usesUnchanged
      || !totalsUnchanged
    ) {
      console.error(
        "Cybermancy GM QOL | Reaction invariant violation detected",
        {
          ownerUnchanged,
          movesUnchanged,
          preparedUnchanged,
          usesUnchanged,
          totalsUnchanged
        }
      );
    }

    return {
      committed: true,
      transactionType: "reaction",
      sourceType: plan.sourceType,
      nativeExecutionInvoked: nativeExecution,
      nativeExecutionStatus: reactionEntry.executionStatus,
      gmMoveDelta: 0,
      adversarySpotlightDelta: 0,
      spotlightOwnerChanged: false
    };
  } finally {
    reactionTransactionPending = false;
    refreshInspector();
  }
}

async function undoLastReaction() {
  if (reactionTransactionPending || conditionTransactionPending || fearTransactionPending) return false;

  const latest = getLatestReactionWithIndex();
  if (!latest) {
    ui.notifications.warn("There is no Reaction bookkeeping to undo.");
    return false;
  }

  const before = snapshotCombatStateMemory();
  const { entry, index } = latest;
  let fearRefunded = false;

  if (entry.inspectorFearCost > 0) {
    fearRefunded = await refundNativeFear(
      entry.inspectorFearCost,
      "Reaction undo"
    );

    if (!fearRefunded) return false;
  }

  reactionLedger.splice(index, 1);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);

    if (fearRefunded && entry.inspectorFearCost > 0) {
      const respent = await spendNativeFear(
        entry.inspectorFearCost,
        "failed Reaction undo state save"
      );

      if (!respent) {
        ui.notifications.error(
          "Reaction undo save failed and the Fear rollback also failed. Check native Fear manually."
        );
      }
    }

    return false;
  }

  if (entry.executionMode === "native-embedded") {
    ui.notifications.warn(
      "QOL Undo removed Reaction bookkeeping and refunded QOL-owned Fear only. Native Daggerheart costs, chat, rolls, damage, uses, and effects were not reversed."
    );
  }

  refreshInspector();
  return true;
}

function getReactionSourceName(entry) {
  if (!entry) return "Reaction";

  if (entry.sourceType === "adversary" && entry.tokenId) {
    const token = canvas?.tokens?.get(entry.tokenId)
      ?? (canvas?.tokens?.placeables ?? [])
        .find(candidate => candidate.id === entry.tokenId)
      ?? null;

    return token?.name ?? `Token ${entry.tokenId}`;
  }

  if (entry.sourceType === "environment" && entry.environmentUuid) {
    const record = resolveActiveEnvironmentRecord(entry.environmentUuid);
    return record?.actor?.name
      ?? record?.name
      ?? entry.environmentUuid;
  }

  return entry.sourceType === "environment"
    ? "Environment"
    : "Adversary";
}

function renderLastReactionSummary(latest) {
  if (!latest?.entry) return "";

  const { entry } = latest;
  const sourceName = getReactionSourceName(entry);
  const status = String(
    entry.executionStatus ?? ""
  ).replaceAll("-", " ").toUpperCase();

  const typeLabel = entry.sourceType === "environment"
    ? "ENVIRONMENT REACTION"
    : entry.classification === "non-spotlight"
      ? "NON-SPOTLIGHT FEATURE"
      : "REACTION";

  return `
    <div class="cmgi-last-action"
         title="Most recent committed Reaction/non-Spotlight GM event. It consumed no GM Move or adversary Spotlight.">
      <span class="cmgi-last-action-label">LAST GM EVENT</span>
      <strong>${escapeHtml(sourceName)} — ${escapeHtml(entry.actionName)}</strong>
      <span class="cmgi-last-action-status">${escapeHtml(typeLabel)}</span>
      ${status
        ? `<span class="cmgi-last-action-status">${escapeHtml(status)}</span>`
        : ""}
      <span class="cmgi-muted">NO GM MOVE · NO SPOTLIGHT</span>
      <button type="button"
              class="cmgi-grant-remove"
              data-action="undo-reaction"
              ${reactionTransactionPending || fearTransactionPending ? "disabled" : ""}
              title="Undo this Reaction bookkeeping. QOL-owned Fear is refunded; native Daggerheart effects are not reversed.">
        UNDO REACTION
      </button>
    </div>`;
}

// ===== 68-combat-state.js =====
/* -------------------------------------------- */
/*  Native Adversary Combat State               */
/* -------------------------------------------- */

const RECOGNIZED_ADVERSARY_CONDITIONS = new Set([
  "vulnerable",
  "restrained",
  "hidden"
]);

function getNumericTrack(resource) {
  if (!resource || typeof resource !== "object") return null;

  const value = Number(resource.value);
  const max = Number(resource.max);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max < 0) {
    return null;
  }

  return {
    value,
    max,
    isReversed: Boolean(resource.isReversed)
  };
}

function getFirstNativeTrack(actor, paths) {
  for (const path of paths) {
    const track = getNumericTrack(foundry.utils.getProperty(actor, path));
    if (track) return { ...track, path };
  }

  return null;
}

function getAdversaryHpState(actor) {
  const track = getFirstNativeTrack(actor, [
    "system.resources.hitPoints",
    "system.resources.hp",
    "system.hitPoints",
    "system.hp"
  ]);

  if (!track) {
    return {
      available: false,
      remaining: null,
      marked: null,
      max: null,
      defeated: false,
      path: null
    };
  }

  const marked = track.isReversed
    ? Math.max(0, Math.min(track.max, track.value))
    : Math.max(0, track.max - track.value);

  const remaining = track.isReversed
    ? Math.max(0, track.max - track.value)
    : Math.max(0, track.value);

  return {
    available: true,
    remaining,
    marked,
    max: track.max,
    defeated: track.max > 0 && remaining <= 0,
    path: track.path,
    isReversed: track.isReversed
  };
}

function getAdversaryStressState(actor) {
  const track = getFirstNativeTrack(actor, [
    "system.resources.stress",
    "system.stress"
  ]);

  if (!track) {
    return {
      available: false,
      marked: null,
      max: null,
      full: false,
      path: null
    };
  }

  // Daggerheart adversaries use a reversed resource track: value is marked
  // Stress. For defensive compatibility, a non-reversed Stress track is still
  // displayed as its native value rather than silently reinterpreted.
  const marked = Math.max(0, Math.min(track.max, track.value));

  return {
    available: true,
    marked,
    max: track.max,
    full: track.max > 0 && marked >= track.max,
    path: track.path,
    isReversed: track.isReversed
  };
}

function getAdversaryArmorState(actor) {
  const track = getFirstNativeTrack(actor, [
    "system.resources.armor",
    "system.resources.armorSlots",
    "system.armorSlots",
    "system.armor"
  ]);

  if (!track) {
    return {
      available: false,
      remaining: null,
      marked: null,
      max: null,
      path: null
    };
  }

  const marked = track.isReversed
    ? Math.max(0, Math.min(track.max, track.value))
    : Math.max(0, track.max - track.value);

  const remaining = track.isReversed
    ? Math.max(0, track.max - track.value)
    : Math.max(0, track.value);

  return {
    available: true,
    remaining,
    marked,
    max: track.max,
    path: track.path,
    isReversed: track.isReversed
  };
}

function getAdversaryThresholdState(actor) {
  const majorRaw = foundry.utils.getProperty(
    actor,
    "system.damageThresholds.major"
  );
  const severeRaw = foundry.utils.getProperty(
    actor,
    "system.damageThresholds.severe"
  );

  const major = Number(majorRaw);
  const severe = Number(severeRaw);

  return {
    major: Number.isFinite(major) ? major : null,
    severe: Number.isFinite(severe) ? severe : null
  };
}

function normalizeEffectStatuses(effect) {
  try {
    if (effect?.statuses instanceof Set) {
      return [...effect.statuses].map(status =>
        String(status).trim().toLowerCase()
      );
    }

    if (Array.isArray(effect?.statuses)) {
      return effect.statuses.map(status =>
        String(status).trim().toLowerCase()
      );
    }

    if (Array.isArray(effect?._source?.statuses)) {
      return effect._source.statuses.map(status =>
        String(status).trim().toLowerCase()
      );
    }
  } catch (_) {
    // Display gracefully even if a custom ActiveEffect exposes statuses oddly.
  }

  return [];
}

function normalizeEffectName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getEffectSourceLabel(effect) {
  const origin = effect?.origin
    ?? effect?._source?.origin
    ?? null;

  if (!origin) return null;

  try {
    if (typeof fromUuidSync === "function") {
      const source = fromUuidSync(origin);
      if (source?.name) return String(source.name);
      if (source?.parent?.name) return String(source.parent.name);
    }
  } catch (error) {
    console.warn(
      "Cybermancy GM QOL | Could not resolve ActiveEffect origin",
      origin,
      error
    );
  }

  return String(origin);
}

function getNativeAdversaryEffects(actor) {
  const effects = [...(actor?.effects ?? [])];

  return effects
    .filter(effect =>
      effect
      && !effect.disabled
      && !effect.isSuppressed
    )
    .map(effect => {
      const statuses = normalizeEffectStatuses(effect);
      const normalizedName = normalizeEffectName(effect.name);
      const statusSet = new Set(statuses);

      const isHidden =
        normalizedName === "hidden"
        || statusSet.has("hidden");

      const isVulnerable =
        normalizedName === "vulnerable"
        || statusSet.has("vulnerable");

      const isRestrained =
        normalizedName === "restrained"
        || statusSet.has("restrained");

      const recognized =
        RECOGNIZED_ADVERSARY_CONDITIONS.has(normalizedName)
        || isHidden
        || isVulnerable
        || isRestrained
        || statuses.length > 0;

      return {
        id: String(effect.id ?? effect._id ?? ""),
        uuid: effect.uuid ?? null,
        name: String(effect.name ?? "Unnamed Effect"),
        statuses,
        sourceLabel: getEffectSourceLabel(effect),
        isHidden,
        isVulnerable,
        isRestrained,
        recognizedCondition: recognized,
        clearMode: isHidden
          ? "direct"
          : recognized
            ? "action"
            : "display"
      };
    })
    .filter(effect => Boolean(effect.id));
}

function getAdversaryCombatState(tokenOrActor) {
  const actor = tokenOrActor?.actor ?? tokenOrActor ?? null;

  if (!actor || !isAdversaryActor(actor)) {
    return {
      available: false,
      defeated: false,
      hp: getAdversaryHpState(null),
      stress: getAdversaryStressState(null),
      armor: getAdversaryArmorState(null),
      thresholds: { major: null, severe: null },
      effects: [],
      vulnerable: false,
      fullStress: false
    };
  }

  const hp = getAdversaryHpState(actor);
  const stress = getAdversaryStressState(actor);
  const armor = getAdversaryArmorState(actor);
  const thresholds = getAdversaryThresholdState(actor);
  const effects = getNativeAdversaryEffects(actor);
  const vulnerable = effects.some(effect => effect.isVulnerable);

  return {
    available: true,
    actorUuid: actor.uuid ?? null,
    hp,
    stress,
    armor,
    thresholds,
    effects,
    defeated: hp.defeated,
    vulnerable,
    fullStress: stress.full
  };
}

function getPcArmorState(actor) {
  // PCs need Armor Slots, not armor score. Reuse the generic native Armor
  // resource resolver so the QOL row follows the actual Daggerheart slot track.
  return getAdversaryArmorState(actor);
}

function getPcEvasionState(actor) {
  const value = Number(
    foundry.utils.getProperty(actor, "system.evasion")
  );

  if (!actor || !Number.isFinite(value)) {
    return {
      available: false,
      value: null,
      path: null
    };
  }

  return {
    available: true,
    value: Math.trunc(value),
    path: "system.evasion"
  };
}

function getPcCombatState(tokenOrActor) {
  const actor = tokenOrActor?.actor ?? tokenOrActor ?? null;

  if (!actor || !isPcActor(actor)) {
    return {
      available: false,
      hp: getAdversaryHpState(null),
      stress: getAdversaryStressState(null),
      armor: getPcArmorState(null),
      thresholds: { major: null, severe: null },
      evasion: getPcEvasionState(null),
      effects: [],
      vulnerable: false,
      fullStress: false
    };
  }

  const hp = getAdversaryHpState(actor);
  const stress = getAdversaryStressState(actor);
  const armor = getPcArmorState(actor);
  const thresholds = getAdversaryThresholdState(actor);
  const evasion = getPcEvasionState(actor);
  const effects = getNativeAdversaryEffects(actor);
  const vulnerable = effects.some(effect => effect.isVulnerable);

  return {
    available: true,
    actorUuid: actor.uuid ?? null,
    hp,
    stress,
    armor,
    thresholds,
    evasion,
    effects,
    vulnerable,
    fullStress: stress.full
  };
}

function isAdversaryDefeated(tokenOrActor) {
  return Boolean(getAdversaryCombatState(tokenOrActor).defeated);
}

function resolveAdversaryToken(tokenId) {
  if (!tokenId) return null;

  return canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? [])
      .find(candidate => String(candidate?.id) === String(tokenId))
    ?? null;
}

function resolveNativeAdversaryEffect(tokenId, effectId) {
  const token = resolveAdversaryToken(tokenId);
  if (!token?.actor || !isAdversaryActor(token.actor)) return null;

  let effect = null;

  if (typeof token.actor.effects?.get === "function") {
    effect = token.actor.effects.get(effectId) ?? null;
  }

  if (!effect) {
    effect = [...(token.actor.effects ?? [])].find(
      candidate =>
        String(candidate?.id ?? candidate?._id ?? "") === String(effectId)
    ) ?? null;
  }

  if (!effect || effect.disabled || effect.isSuppressed) return null;

  return { token, actor: token.actor, effect };
}

async function deleteNativeAdversaryEffect(tokenId, effectId) {
  const resolved = resolveNativeAdversaryEffect(tokenId, effectId);
  if (!resolved) {
    throw new Error("The native condition/effect is no longer active.");
  }

  const { actor, effect } = resolved;

  if (typeof effect.delete === "function") {
    await effect.delete();
    return true;
  }

  if (typeof actor.deleteEmbeddedDocuments === "function") {
    await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    return true;
  }

  throw new Error(
    "The native ActiveEffect does not expose a supported deletion API."
  );
}

function buildConditionClearTransactionPlan(tokenId, effectId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  if (spotlightOwner !== "GM") {
    return {
      valid: false,
      reason: "Take GM Spotlight before clearing a condition as an adversary action."
    };
  }

  const resolved = resolveNativeAdversaryEffect(tokenId, effectId);
  if (!resolved) {
    return {
      valid: false,
      reason: "The intended native condition/effect is no longer active."
    };
  }

  if (isAdversaryDefeated(resolved.token)) {
    return {
      valid: false,
      reason: `${resolved.token.name ?? resolved.actor.name ?? "This adversary"} is defeated and cannot take a clear-condition action.`
    };
  }

  const combatState = getAdversaryCombatState(resolved.token);
  const descriptor = combatState.effects.find(
    effect => String(effect.id) === String(effectId)
  );

  if (!descriptor?.recognizedCondition) {
    return {
      valid: false,
      reason: "This active effect is displayed for reference, but is not confidently classified as a clearable condition."
    };
  }

  if (descriptor.isHidden) {
    return {
      valid: false,
      reason: "Hidden ends by state/fiction and uses REMOVE rather than a GM Move clear action."
    };
  }

  // Same priority as ordinary adversary Actions:
  // exact-token grant > prepared move > acquire a new move.
  const granted = findAvailableGrantedSpotlight(resolved.token.id);
  const prepared = granted ? null : getPreparedGmMove();

  const moveFearCost = granted
    ? 0
    : prepared
      ? 0
      : getNewGmMoveCost();

  if (moveFearCost === null) {
    return {
      valid: false,
      reason: "GM Move cost could not be resolved."
    };
  }

  return {
    valid: true,
    sceneId: canvas.scene.id,
    tokenId: resolved.token.id,
    tokenName: resolved.token.name ?? resolved.actor.name ?? "Adversary",
    actorId: resolved.actor.id,
    actorName: resolved.actor.name ?? "Adversary",
    actionName: `Clear ${descriptor.name}`,
    actionSubtype: "clear-condition",
    effectId: descriptor.id,
    effectName: descriptor.name,

    grantedSpotlight: Boolean(granted),
    grantLedgerIndex: granted?.ledgerIndex ?? null,
    grantIndex: granted?.grantIndex ?? null,

    preparedMove: Boolean(prepared),
    preparedMoveIndex: prepared?.index ?? null,
    preparedMoveFearCost: prepared
      ? Math.max(0, Number(prepared.entry.moveFearCost) || 0)
      : 0,

    moveKind: granted
      ? "granted"
      : prepared
        ? prepared.entry.kind
        : moveFearCost === 0
          ? "base"
          : "additional",

    moveFearCost,
    totalFearCost: moveFearCost,

    // A grant already wrote its TURN/TOTAL entitlement.
    spotlightDelta: granted ? 0 : 1
  };
}

function getConditionClearExecutionRecord(plan) {
  if (plan?.grantedSpotlight) {
    const owner = gmMoveLedger[plan.grantLedgerIndex];
    if (owner?.transactionType !== "action") return null;

    const grants = Array.isArray(owner.grantedSpotlights)
      ? owner.grantedSpotlights
      : [];

    return grants[plan.grantIndex] ?? null;
  }

  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];

    if (
      entry?.transactionType === "action"
      && entry?.actionSubtype === "clear-condition"
      && String(entry?.tokenId ?? "") === String(plan?.tokenId ?? "")
      && String(entry?.effectId ?? "") === String(plan?.effectId ?? "")
    ) {
      return entry;
    }
  }

  return null;
}

function renderConditionClearPreviewContent(plan) {
  const fear = getFearState();
  const currentTurn = getSpotlightUseCount(plan.tokenId);
  const projectedTurn = currentTurn + plan.spotlightDelta;

  const moveText = plan.grantedSpotlight
    ? "GRANTED — existing exact-token Spotlight entitlement"
    : plan.preparedMove
      ? plan.preparedMoveFearCost > 0
        ? `READY — ${plan.preparedMoveFearCost} Fear already paid`
        : "READY — Base Move prepared"
      : plan.moveFearCost === 0
        ? "0 Fear — Base Move will be acquired"
        : `${plan.moveFearCost} Fear — Additional Move will be acquired`;

  const spotlightText = plan.grantedSpotlight
    ? `GRANTED — already recorded in TURN/TOTAL (${currentTurn})`
    : `+1 exact-token Spotlight — projected TURN ${projectedTurn}`;

  return `
    <div class="cmgi-transaction-preview">
      <h3>${escapeHtml(plan.tokenName)} — ${escapeHtml(plan.actionName)}</h3>

      <div class="cmgi-preview-grid">
        <div class="cmgi-preview-label">GM Move</div>
        <div>${escapeHtml(moveText)}</div>

        <div class="cmgi-preview-label">Spotlight</div>
        <div>${escapeHtml(spotlightText)}</div>

        <div class="cmgi-preview-label">Feature Cost</div>
        <div>NONE</div>

        <div class="cmgi-preview-label">Native Effect</div>
        <div>${escapeHtml(plan.effectName)} — remove after bookkeeping commit</div>

        <div class="cmgi-preview-label">Native Fear</div>
        <div>${fear.available ? `${fear.current} / ${fear.max}` : "Unavailable"}</div>
      </div>

      <div class="cmgi-preview-total">
        ${plan.grantedSpotlight || plan.preparedMove
          ? "ADDITIONAL FEAR REQUIRED: 0"
          : `FEAR REQUIRED: ${plan.totalFearCost}`}
      </div>

      <div class="cmgi-preview-note">
        Clearing this temporary condition is an adversary action:
        GM Move + exact adversary Spotlight. The QOL tool will remove the
        native ActiveEffect only after its own bookkeeping is saved.
        Undo GM Move does not restore a native condition already removed.
      </div>
    </div>`;
}

function showConditionClearPreview(tokenId, effectId) {
  const plan = buildConditionClearTransactionPlan(tokenId, effectId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return;
  }

  new Dialog({
    title: "Clear Adversary Condition",
    content: renderConditionClearPreviewContent(plan),
    buttons: {
      commit: {
        icon: '<i class="fa-solid fa-check"></i>',
        label: `COMMIT CLEAR — ${plan.totalFearCost} FEAR`,
        callback: () => commitConditionClearTransaction(
          tokenId,
          effectId
        )
      },
      cancel: { label: "Cancel" }
    },
    default: "cancel"
  }).render(true);
}

async function commitConditionClearTransaction(tokenId, effectId) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const plan = buildConditionClearTransactionPlan(tokenId, effectId);
  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return false;
  }

  if (plan.sceneId !== canvas?.scene?.id) {
    ui.notifications.warn(
      "The active Scene changed before the condition clear could commit."
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const preparedBefore = plan.grantedSpotlight
    ? null
    : getPreparedGmMove();
  const grantBefore = plan.grantedSpotlight
    ? findAvailableGrantedSpotlight(plan.tokenId)
    : null;

  if (plan.grantedSpotlight) {
    if (
      !grantBefore
      || grantBefore.ledgerIndex !== plan.grantLedgerIndex
      || grantBefore.grantIndex !== plan.grantIndex
    ) {
      ui.notifications.warn(
        "The granted Spotlight changed or was consumed before commit. Reopen the condition preview."
      );
      return false;
    }
  } else {
    if (Boolean(preparedBefore) !== Boolean(plan.preparedMove)) {
      ui.notifications.warn(
        "GM Move readiness changed before commit. Reopen the condition preview."
      );
      return false;
    }

    if (
      preparedBefore
      && preparedBefore.index !== plan.preparedMoveIndex
    ) {
      ui.notifications.warn(
        "The prepared GM Move changed before commit. Reopen the condition preview."
      );
      return false;
    }
  }

  const fear = getFearState();
  if (
    plan.moveFearCost > 0
    && (!fear.available || fear.current < plan.moveFearCost)
  ) {
    ui.notifications.warn(
      `Not enough native Daggerheart Fear. Clearing this condition requires ${plan.moveFearCost}.`
    );
    return false;
  }

  let fearSpent = false;

  try {
    conditionTransactionPending = true;
    grantModeLedgerIndex = null;

    if (plan.moveFearCost > 0) {
      fearSpent = await spendNativeFear(
        plan.moveFearCost,
        `clear adversary condition: ${plan.effectName}`
      );
      if (!fearSpent) return false;
    }

    if (plan.grantedSpotlight) {
      const owner = gmMoveLedger[plan.grantLedgerIndex];
      if (owner?.transactionType !== "action") {
        throw new Error(
          "The owning GM Action transaction is no longer available."
        );
      }

      const grants = sanitizeGrantedSpotlights(
        owner.grantedSpotlights
      );
      const grant = grants[plan.grantIndex];

      if (
        !grant
        || grant.status !== "available"
        || String(grant.tokenId) !== String(plan.tokenId)
      ) {
        throw new Error(
          "The granted Spotlight is no longer available."
        );
      }

      grant.status = "used";
      grant.actionName = plan.actionName;
      grant.actionSubtype = "clear-condition";
      grant.effectId = plan.effectId;
      grant.effectName = plan.effectName;
      grant.itemId = null;
      grant.nativeActionId = null;
      grant.executionMode = "native-effect-remove";
      grant.executionStatus = "pending-native";
      grant.expectedNativeFearCost = 0;
      grant.featureFearCost = 0;
      grant.inspectorFearCost = 0;
      grant.eventSequence = allocateGmEventSequence();

      owner.eventSequence = grant.eventSequence;
      owner.grantedSpotlights = grants;
    } else if (preparedBefore) {
      const entry = preparedBefore.entry;

      entry.transactionType = "action";
      entry.actionSubtype = "clear-condition";
      entry.executionMode = "native-effect-remove";
      entry.executionStatus = "pending-native";
      entry.moveStatus = "used";
      entry.tokenId = plan.tokenId;
      entry.environmentUuid = null;
      entry.itemId = null;
      entry.nativeActionId = null;
      entry.actionName = plan.actionName;
      entry.effectId = plan.effectId;
      entry.effectName = plan.effectName;
      entry.featureFearCost = 0;
      entry.expectedNativeFearCost = 0;
      entry.eventSequence = allocateGmEventSequence();
      entry.spotlightDelta = plan.spotlightDelta;
      entry.grantedSpotlights = [];
    } else {
      gmMovesThisTurn += 1;
      gmMoveLedger.push({
        kind: plan.moveKind,
        fearCost: plan.moveFearCost,
        moveFearCost: plan.moveFearCost,
        featureFearCost: 0,
        expectedNativeFearCost: 0,
        transactionType: "action",
        actionSubtype: "clear-condition",
        executionMode: "native-effect-remove",
        executionStatus: "pending-native",
        moveStatus: "used",
        tokenId: plan.tokenId,
        environmentUuid: null,
        itemId: null,
        nativeActionId: null,
        actionName: plan.actionName,
        effectId: plan.effectId,
        effectName: plan.effectName,
        eventSequence: allocateGmEventSequence(),
        spotlightDelta: plan.spotlightDelta,
        grantedSpotlights: []
      });
    }

    if (plan.spotlightDelta > 0) {
      adjustSpotlightCounts(
        plan.tokenId,
        plan.spotlightDelta
      );
    }

    const saved = await persistCombatState();
    if (!saved) {
      restoreCombatStateMemory(before);

      if (fearSpent && plan.moveFearCost > 0) {
        const refunded = await refundNativeFear(
          plan.moveFearCost,
          "failed condition-clear state save"
        );

        if (!refunded) {
          ui.notifications.error(
            "Condition-clear state save failed and the Fear refund also failed. Check native Fear manually."
          );
        }
      }

      return false;
    }

    refreshInspector();

    try {
      await deleteNativeAdversaryEffect(
        plan.tokenId,
        plan.effectId
      );

      const record = getConditionClearExecutionRecord(plan);
      if (record) {
        record.executionStatus = "completed";
        await persistCombatState();
      }

      refreshInspector();

      return {
        committed: true,
        transactionType: "action",
        actionSubtype: "clear-condition",
        nativeEffectRemoved: true,
        grantedSpotlight: plan.grantedSpotlight
      };
    } catch (error) {
      console.error(
        "Cybermancy GM QOL | Native condition removal failed after bookkeeping commit",
        error
      );

      const record = getConditionClearExecutionRecord(plan);
      if (record) {
        record.executionStatus = "failed";
        await persistCombatState();
      }

      refreshInspector();

      ui.notifications.error(
        `Could not remove ${plan.effectName} from ${plan.tokenName}. GM Move and Spotlight bookkeeping remain committed.`
      );

      return {
        committed: true,
        transactionType: "action",
        actionSubtype: "clear-condition",
        nativeEffectRemoved: false,
        error
      };
    }
  } finally {
    conditionTransactionPending = false;
    refreshInspector();
  }
}

async function removeHiddenConditionDirect(tokenId, effectId) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const resolved = resolveNativeAdversaryEffect(tokenId, effectId);
  if (!resolved) {
    ui.notifications.warn(
      "The Hidden effect is no longer active."
    );
    return false;
  }

  const descriptor = getNativeAdversaryEffects(resolved.actor)
    .find(effect => String(effect.id) === String(effectId));

  if (!descriptor?.isHidden) {
    ui.notifications.warn(
      "Direct REMOVE is reserved for Hidden. Other temporary conditions clear through the adversary action economy."
    );
    return false;
  }

  try {
    conditionTransactionPending = true;
    await deleteNativeAdversaryEffect(tokenId, effectId);
    refreshInspector();

    ui.notifications.info(
      `${resolved.token.name ?? resolved.actor.name ?? "Adversary"} is no longer Hidden. No GM Move, Fear, or Spotlight was changed.`
    );
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Failed to remove Hidden",
      error
    );
    ui.notifications.error(
      "The native Hidden effect could not be removed."
    );
    return false;
  } finally {
    conditionTransactionPending = false;
    refreshInspector();
  }
}

function renderCombatStateTrack(label, primary, secondary = null, extraClass = "") {
  return `
    <div class="cmgi-state-row${extraClass ? ` ${extraClass}` : ""}">
      <span class="cmgi-state-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(primary)}</strong>
      ${secondary
        ? `<span class="cmgi-muted">${escapeHtml(secondary)}</span>`
        : ""}
    </div>`;
}

function renderAdversaryEffectRow(token, effect, combatState) {
  const sourceHtml = effect.sourceLabel
    ? `<span class="cmgi-effect-source">Source: ${escapeHtml(effect.sourceLabel)}</span>`
    : "";

  let context = "";
  if (effect.isHidden) {
    context = "Ends when visible, enters line of sight, attacks, or the effect ends.";
  } else if (effect.isVulnerable && combatState.fullStress) {
    context = "FULL STRESS — clear at least 1 Stress to end the full-Stress Vulnerable state.";
  }

  let control = `<span class="cmgi-effect-reference">EFFECT</span>`;

  if (effect.clearMode === "direct") {
    control = `
      <button type="button"
              class="cmgi-condition-button"
              data-action="remove-hidden-condition"
              data-token-id="${escapeHtml(token.id)}"
              data-effect-id="${escapeHtml(effect.id)}"
              ${conditionTransactionPending ? "disabled" : ""}
              title="Record that Hidden has ended. No GM Move, Fear, or Spotlight is changed.">
        REMOVE
      </button>`;
  } else if (effect.clearMode === "action") {
    if (combatState.defeated) {
      control = `
        <button type="button"
                class="cmgi-condition-button"
                disabled
                title="A defeated adversary cannot take an action to clear this condition.">
          DEFEATED
        </button>`;
    } else if (spotlightOwner !== "GM") {
      control = `
        <button type="button"
                class="cmgi-condition-button"
                disabled
                title="Take GM Spotlight before clearing this condition as an adversary action.">
          GM SPOTLIGHT
        </button>`;
    } else {
      const grant = findAvailableGrantedSpotlight(token.id);
      control = `
        <button type="button"
                class="cmgi-condition-button"
                data-action="preview-condition-clear"
                data-token-id="${escapeHtml(token.id)}"
                data-effect-id="${escapeHtml(effect.id)}"
                ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
                title="${grant
                  ? "Clear this condition using the exact token's available granted Spotlight."
                  : "Clear this condition as a GM Move + exact adversary Spotlight."}">
          ${grant ? "CLEAR · GRANTED" : "CLEAR"}
        </button>`;
    }
  }

  return `
    <div class="cmgi-effect-row">
      <div class="cmgi-effect-main">
        <strong>${escapeHtml(effect.name)}</strong>
        ${effect.statuses.length
          ? `<span class="cmgi-effect-statuses">${escapeHtml(effect.statuses.join(", "))}</span>`
          : ""}
        ${sourceHtml}
        ${context
          ? `<span class="cmgi-effect-context">${escapeHtml(context)}</span>`
          : ""}
      </div>
      ${control}
    </div>`;
}

function renderAdversaryCombatStatePanel(token) {
  if (!token?.actor || !isAdversaryActor(token.actor)) return "";

  const state = getAdversaryCombatState(token);

  const hpValue = state.hp.available
    ? `${state.hp.remaining}/${state.hp.max}`
    : "—";

  const stressValue = state.stress.available
    ? `${state.stress.marked}/${state.stress.max}`
    : "—";

  const armorAvailable = state.armor.available;
  const armorValue = armorAvailable
    ? `${state.armor.remaining}/${state.armor.max}`
    : "—";

  const major = state.thresholds.major !== null
    ? String(state.thresholds.major)
    : "—";

  const severe = state.thresholds.severe !== null
    ? String(state.thresholds.severe)
    : "—";

  const coreConditionIds = new Set(
    QOL_DAGGERHEART_CONDITIONS.map(condition => condition.id)
  );

  const otherEffects = state.effects.filter(effect => {
    const normalizedName = normalizeEffectName(effect.name);

    if (coreConditionIds.has(normalizedName)) return false;

    return !QOL_DAGGERHEART_CONDITIONS.some(condition =>
      effect?.[condition.effectKey]
    );
  });

  const otherEffectsHtml = otherEffects.length
    ? `
      <div class="cmgi-other-effects">
        ${otherEffects
          .map(effect => renderAdversaryEffectRow(token, effect, state))
          .join("")}
      </div>`
    : "";

  const fullStressAdvisory =
    state.fullStress && !state.vulnerable
      ? `
        <div class="cmgi-state-advisory">
          <strong>FULL STRESS — SHOULD BE VULNERABLE</strong>
          <span>Advisory only. QOL does not automatically toggle Vulnerable.</span>
        </div>`
      : "";

  const armorHtml = armorAvailable
    ? `
      <span class="cmgi-state-compact-item">
        <span class="cmgi-state-label">ARMOR</span>
        <strong>${escapeHtml(armorValue)}</strong>
      </span>`
    : inspectorDiagnosticsVisible
      ? `
        <span class="cmgi-state-compact-item cmgi-state-diagnostic">
          <span class="cmgi-state-label">ARMOR</span>
          <strong>—</strong>
          <span class="cmgi-muted">native Armor resource unavailable</span>
        </span>`
      : "";

  const writeBusy = isQolNativeWriteBusy();

  const hpControl = state.hp.available
    ? `
      <button type="button"
              class="cmgi-state-resource-button"
              data-action="adjust-qol-resource"
              data-resource="hp"
              data-token-id="${escapeHtml(token.id)}"
              ${writeBusy ? "disabled" : ""}
              title="HP ${escapeHtml(hpValue)}. Left click: −1 remaining HP. Right click: +1 remaining HP.">
        <span class="cmgi-state-label">HP</span>
        <strong>${escapeHtml(hpValue)}</strong>
      </button>`
    : `
      <span class="cmgi-state-compact-item">
        <span class="cmgi-state-label">HP</span>
        <strong>—</strong>
      </span>`;

  const stressControl = state.stress.available
    ? `
      <button type="button"
              class="cmgi-state-resource-button${state.fullStress ? " cmgi-state-warning" : ""}"
              data-action="adjust-qol-resource"
              data-resource="stress"
              data-token-id="${escapeHtml(token.id)}"
              ${writeBusy || !state.stress.isReversed ? "disabled" : ""}
              title="Stress ${escapeHtml(stressValue)}. Left click: −1 marked Stress. Right click: +1 marked Stress.">
        <span class="cmgi-state-label">STRESS</span>
        <strong>${escapeHtml(stressValue)}</strong>
        ${state.fullStress ? `<span class="cmgi-state-flag">FULL</span>` : ""}
      </button>`
    : `
      <span class="cmgi-state-compact-item">
        <span class="cmgi-state-label">STRESS</span>
        <strong>—</strong>
      </span>`;

  return `
    <section class="cmgi-combat-state cmgi-combat-state-compact${state.defeated ? " cmgi-defeated" : ""}">
      <div class="cmgi-state-compact-line">
        ${state.defeated
          ? `<span class="cmgi-defeated-badge">DEFEATED</span>`
          : ""}

        ${hpControl}
        ${stressControl}

        <span class="cmgi-state-compact-item cmgi-thresholds">
          <span class="cmgi-state-label">THRESHOLDS</span>
          <strong>${escapeHtml(`${major}/${severe}`)}</strong>
        </span>

        ${armorHtml}

        <span class="cmgi-condition-inline">
          ${renderQolConditionControls(token, state)}
        </span>
      </div>

      ${fullStressAdvisory}
      ${otherEffectsHtml}
    </section>`;
}

// ===== 68-writeback.js =====
/* -------------------------------------------- */
/*  QOL Direct Native Write-Back                 */
/* -------------------------------------------- */

// These controls are administrative state synchronization, not adversary
// actions. They never create GM Moves, consume Spotlight, or write Inspector
// combat-state bookkeeping.

const QOL_DAGGERHEART_CONDITIONS = Object.freeze([
  {
    id: "vulnerable",
    label: "VULNERABLE",
    effectKey: "isVulnerable",
    ruleText: "All rolls targeting you have advantage."
  },
  {
    id: "restrained",
    label: "RESTRAINED",
    effectKey: "isRestrained",
    ruleText: "You can't move, but you can otherwise act normally."
  },
  {
    id: "hidden",
    label: "HIDDEN",
    effectKey: "isHidden",
    ruleText: "You are out of sight from all enemies and your location is unknown. Rolls targeting you have disadvantage. Hidden ends when you become visible, enter line of sight, attack, or the effect ends."
  }
]);

function isQolNativeWriteBusy() {
  return Boolean(
    nativeQolWritePending
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  );
}

function clampQolInteger(value, min, max) {
  const numeric = Math.trunc(Number(value) || 0);
  return Math.max(min, Math.min(max, numeric));
}

function getQolAdversaryToken(tokenId) {
  const token = resolveAdversaryToken(tokenId);

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return null;
  }

  return token;
}

function getQolPcToken(tokenId) {
  return resolvePcToken(tokenId);
}

async function updateQolNativeResource(actor, trackPath, nativeValue) {
  if (!actor || !trackPath) {
    throw new Error("Native resource path is unavailable.");
  }

  const updatePath = `${trackPath}.value`;
  await actor.update({
    [updatePath]: nativeValue
  });

  return true;
}

async function adjustAdversaryHp(tokenId, displayedDelta) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolAdversaryToken(tokenId);
  if (!token) {
    ui.notifications.warn(
      "The intended adversary token is no longer available."
    );
    return false;
  }

  const state = getAdversaryCombatState(token);
  if (!state.hp.available || !state.hp.path) {
    ui.notifications.warn(
      "This adversary does not expose a supported native HP resource."
    );
    return false;
  }

  const delta = Math.sign(Number(displayedDelta) || 0);
  if (!delta) return false;

  const nextRemaining = clampQolInteger(
    state.hp.remaining + delta,
    0,
    state.hp.max
  );

  if (nextRemaining === state.hp.remaining) return false;

  const nextNativeValue = state.hp.isReversed
    ? state.hp.max - nextRemaining
    : nextRemaining;

  try {
    nativeQolWritePending = true;
    await updateQolNativeResource(
      token.actor,
      state.hp.path,
      nextNativeValue
    );
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Direct HP write failed",
      error
    );
    ui.notifications.error(
      "The adversary HP resource could not be updated."
    );
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function adjustAdversaryStress(tokenId, displayedDelta) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolAdversaryToken(tokenId);
  if (!token) {
    ui.notifications.warn(
      "The intended adversary token is no longer available."
    );
    return false;
  }

  const state = getAdversaryCombatState(token);
  if (!state.stress.available || !state.stress.path) {
    ui.notifications.warn(
      "This adversary does not expose a supported native Stress resource."
    );
    return false;
  }

  // The supported Daggerheart adversary Stress track is reversed and its
  // native value is marked Stress. Do not guess if a different model appears.
  if (!state.stress.isReversed) {
    ui.notifications.warn(
      "This Stress track does not match the supported Daggerheart adversary resource model; no write was made."
    );
    return false;
  }

  const delta = Math.sign(Number(displayedDelta) || 0);
  if (!delta) return false;

  const nextMarked = clampQolInteger(
    state.stress.marked + delta,
    0,
    state.stress.max
  );

  if (nextMarked === state.stress.marked) return false;

  try {
    nativeQolWritePending = true;
    await updateQolNativeResource(
      token.actor,
      state.stress.path,
      nextMarked
    );
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Direct Stress write failed",
      error
    );
    ui.notifications.error(
      "The adversary Stress resource could not be updated."
    );
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function adjustPcHp(tokenId, displayedDelta) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolPcToken(tokenId);
  if (!token) {
    ui.notifications.warn("The intended PC token is no longer available.");
    return false;
  }

  const state = getPcCombatState(token);
  if (!state.hp.available || !state.hp.path) {
    ui.notifications.warn("This PC does not expose a supported native HP resource.");
    return false;
  }

  const delta = Math.sign(Number(displayedDelta) || 0);
  if (!delta) return false;

  const nextRemaining = clampQolInteger(
    state.hp.remaining + delta,
    0,
    state.hp.max
  );

  if (nextRemaining === state.hp.remaining) return false;

  const nextNativeValue = state.hp.isReversed
    ? state.hp.max - nextRemaining
    : nextRemaining;

  try {
    nativeQolWritePending = true;
    await updateQolNativeResource(token.actor, state.hp.path, nextNativeValue);
    return true;
  } catch (error) {
    console.error("Cybermancy GM QOL | Direct PC HP write failed", error);
    ui.notifications.error("The PC HP resource could not be updated.");
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function adjustPcStress(tokenId, displayedDelta) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolPcToken(tokenId);
  if (!token) {
    ui.notifications.warn("The intended PC token is no longer available.");
    return false;
  }

  const state = getPcCombatState(token);
  if (!state.stress.available || !state.stress.path) {
    ui.notifications.warn("This PC does not expose a supported native Stress resource.");
    return false;
  }

  if (!state.stress.isReversed) {
    ui.notifications.warn(
      "This PC Stress track does not match the supported Daggerheart character resource model; no write was made."
    );
    return false;
  }

  const delta = Math.sign(Number(displayedDelta) || 0);
  if (!delta) return false;

  const nextMarked = clampQolInteger(
    state.stress.marked + delta,
    0,
    state.stress.max
  );

  if (nextMarked === state.stress.marked) return false;

  try {
    nativeQolWritePending = true;
    await updateQolNativeResource(token.actor, state.stress.path, nextMarked);
    return true;
  } catch (error) {
    console.error("Cybermancy GM QOL | Direct PC Stress write failed", error);
    ui.notifications.error("The PC Stress resource could not be updated.");
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

function getConfiguredQolCondition(conditionId) {
  const id = String(conditionId ?? "").trim().toLowerCase();

  if (!QOL_DAGGERHEART_CONDITIONS.some(entry => entry.id === id)) {
    return null;
  }

  return (CONFIG.statusEffects ?? []).find(
    effect => String(effect?.id ?? "").toLowerCase() === id
  ) ?? null;
}

function isQolConditionActive(combatState, conditionId) {
  const config = QOL_DAGGERHEART_CONDITIONS.find(
    entry => entry.id === conditionId
  );

  if (!config) return false;

  return (combatState?.effects ?? []).some(
    effect => Boolean(effect?.[config.effectKey])
  );
}

async function setAdversaryCondition(tokenId, conditionId, active) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolAdversaryToken(tokenId);
  if (!token) {
    ui.notifications.warn(
      "The intended adversary token is no longer available."
    );
    return false;
  }

  const configured = getConfiguredQolCondition(conditionId);
  if (!configured) {
    ui.notifications.warn(
      `Daggerheart condition '${String(conditionId)}' is not available in CONFIG.statusEffects.`
    );
    return false;
  }

  if (typeof token.actor.toggleStatusEffect !== "function") {
    ui.notifications.warn(
      "The native Actor does not expose Foundry's status-effect toggle API."
    );
    return false;
  }

  const desired = Boolean(active);
  const current = isQolConditionActive(
    getAdversaryCombatState(token),
    String(conditionId).toLowerCase()
  );

  if (current === desired) return true;

  try {
    nativeQolWritePending = true;

    await token.actor.toggleStatusEffect(
      String(conditionId).toLowerCase(),
      {
        active: desired,
        overlay: false
      }
    );

    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Direct condition write failed",
      {
        tokenId,
        conditionId,
        active: desired,
        error
      }
    );
    ui.notifications.error(
      `The ${String(conditionId)} condition could not be updated.`
    );
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function setPcCondition(tokenId, conditionId, active) {
  if (isQolNativeWriteBusy()) return false;

  const token = getQolPcToken(tokenId);
  if (!token) {
    ui.notifications.warn("The intended PC token is no longer available.");
    return false;
  }

  const configured = getConfiguredQolCondition(conditionId);
  if (!configured) {
    ui.notifications.warn(
      `Daggerheart condition '${String(conditionId)}' is not available in CONFIG.statusEffects.`
    );
    return false;
  }

  if (typeof token.actor.toggleStatusEffect !== "function") {
    ui.notifications.warn(
      "The native Actor does not expose Foundry's status-effect toggle API."
    );
    return false;
  }

  const desired = Boolean(active);
  const current = isQolConditionActive(
    getPcCombatState(token),
    String(conditionId).toLowerCase()
  );

  if (current === desired) return true;

  try {
    nativeQolWritePending = true;
    await token.actor.toggleStatusEffect(
      String(conditionId).toLowerCase(),
      { active: desired, overlay: false }
    );
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Direct PC condition write failed",
      { tokenId, conditionId, active: desired, error }
    );
    ui.notifications.error(
      `The PC ${String(conditionId)} condition could not be updated.`
    );
    return false;
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function togglePcCondition(tokenId, conditionId) {
  const token = getQolPcToken(tokenId);
  if (!token) return false;

  const id = String(conditionId ?? "").trim().toLowerCase();
  const current = isQolConditionActive(getPcCombatState(token), id);

  return setPcCondition(tokenId, id, !current);
}

async function toggleAdversaryCondition(tokenId, conditionId) {
  const token = getQolAdversaryToken(tokenId);
  if (!token) return false;

  const id = String(conditionId ?? "").trim().toLowerCase();
  const current = isQolConditionActive(
    getAdversaryCombatState(token),
    id
  );

  return setAdversaryCondition(
    tokenId,
    id,
    !current
  );
}

function renderQolConditionControls(
  token,
  combatState,
  { scope = "adversary" } = {}
) {
  const busy = isQolNativeWriteBusy();

  return `
    <div class="cmgi-qol-condition-controls">
      ${QOL_DAGGERHEART_CONDITIONS.map(condition => {
        const active = isQolConditionActive(
          combatState,
          condition.id
        );

        const configured = Boolean(
          getConfiguredQolCondition(condition.id)
        );

        return `
          <button type="button"
                  class="cmgi-condition-toggle ${active
                    ? "cmgi-condition-toggle-on"
                    : "cmgi-condition-toggle-off"}"
                  data-action="toggle-qol-condition"
                  data-token-id="${escapeHtml(token.id)}"
                  data-condition-id="${escapeHtml(condition.id)}"
                  data-qol-scope="${escapeHtml(scope)}"
                  aria-pressed="${active ? "true" : "false"}"
                  ${busy || !configured ? "disabled" : ""}
                  title="${configured
                    ? `${condition.ruleText} ${condition.label} is currently ${active ? "ON" : "OFF"}; click to turn it ${active ? "OFF" : "ON"}.`
                    : `${condition.label} is unavailable in native Daggerheart status configuration.`}">
            <span>${escapeHtml(condition.label)}</span>
            <strong>${active ? "ON" : "OFF"}</strong>
          </button>`;
      }).join("")}
    </div>`;
}

// ===== 69-compatibility.js =====
/* -------------------------------------------- */
/*  Compatibility / Metadata Coverage           */
/* -------------------------------------------- */

// Formal sidecar layer. Spotlight limits reuse the existing verified UUID
// registry; feature overrides intentionally ship empty in v0.23 rather than
// inventing metadata for content we have not validated.
const COMPATIBILITY_SIDECAR = Object.freeze({
  spotlightLimits: SPOTLIGHT_LIMIT_COMPATIBILITY.actorSpotlightLimits,
  features: Object.freeze({})
});

const COMPATIBILITY_BUCKETS = Object.freeze([
  "explicit", "native", "sidecar", "ambiguous", "unknown"
]);

function getStableActorCompatibilityKey(actor) {
  if (!actor) return null;

  const sourceKeys = getActorSpotlightLimitSourceKeys(actor);
  if (sourceKeys.length) return sourceKeys[0];

  return String(actor.uuid ?? actor.id ?? "").trim() || null;
}

function getStableFeatureCompatibilityKey(actor, entry) {
  if (!entry) return null;

  const actorKey = getStableActorCompatibilityKey(actor);
  if (actorKey && entry.id) return `${actorKey}.Item.${String(entry.id)}`;
  return null;
}

function getCompatibilityNativeActionTypes(entry) {
  return [...new Set(
    (entry?.nativeActions ?? [])
      .map(action => String(
        action?.type === "attack" ? "attack" : action?.actionType ?? ""
      ).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function getExplicitFeatureCompatibility(entry) {
  if (!entry?.explicit || !entry?.metadata) return null;

  const hasFear = Object.prototype.hasOwnProperty.call(
    entry.metadata, "fearCost"
  );
  const rawFear = hasFear ? Number(entry.metadata.fearCost) : null;

  return {
    actionType: entry.metadata.actionType
      ? String(entry.metadata.actionType).trim().toLowerCase()
      : null,
    usesSpotlight:
      typeof entry.metadata.usesSpotlight === "boolean"
        ? entry.metadata.usesSpotlight
        : null,
    fearCost: hasFear && Number.isFinite(rawFear)
      ? Math.max(0, rawFear)
      : null
  };
}

function getNativeFeatureCompatibility(entry) {
  const nativeActions = entry?.nativeActions ?? [];
  const actionTypes = getCompatibilityNativeActionTypes(entry);

  if (!nativeActions.length) {
    return {
      actionTypes: [],
      actionType: null,
      actionTypeAmbiguous: false,
      fearCost: null,
      fearAmbiguous: false,
      fearReason: null
    };
  }

  const nativeCosts = collectNativeCosts(nativeActions);
  const fear = resolveSingleStructuredCost({ costs: nativeCosts }, "fear");

  return {
    actionTypes,
    actionType: actionTypes.length === 1 ? actionTypes[0] : null,
    actionTypeAmbiguous: actionTypes.length > 1,
    fearCost: fear.ambiguous ? null : Math.max(0, Number(fear.value) || 0),
    fearAmbiguous: Boolean(fear.ambiguous),
    fearReason: fear.reason ?? null
  };
}

function getSidecarFeatureCompatibility(actor, entry) {
  const key = getStableFeatureCompatibilityKey(actor, entry);
  if (!key) return null;
  const value = COMPATIBILITY_SIDECAR.features[key];
  return value && typeof value === "object"
    ? foundry.utils.deepClone(value)
    : null;
}

function applyFeatureSidecarCompatibility(actor, entry) {
  if (!entry || entry.standardAttack || entry.explicit) return entry;

  const native = getNativeFeatureCompatibility(entry);
  if (
    native.actionType
    || native.actionTypeAmbiguous
    || native.fearAmbiguous
  ) {
    return entry;
  }

  const sidecar = getSidecarFeatureCompatibility(actor, entry);
  if (!sidecar) return entry;

  const clone = {
    ...entry,
    compatibilitySource: "sidecar",
    metadata: foundry.utils.deepClone(sidecar)
  };

  if (sidecar.actionType) {
    clone.kind = {
      label: capitalize(String(sidecar.actionType)),
      source: "sidecar"
    };
  }

  clone.costs = applyExplicitMetadataToCosts(
    entry.costs ?? [],
    sidecar
  );

  return clone;
}

function classifyFeatureCompatibility(actor, entry) {
  if (!entry) return {
    bucket: "unknown", source: "UNKNOWN", issue: "feature-unavailable",
    reason: "Feature entry unavailable."
  };

  if (entry.standardAttack) return {
    bucket: "native", source: "NATIVE", issue: null,
    reason: "Standard adversary attack uses structured Daggerheart attack data."
  };

  const explicit = getExplicitFeatureCompatibility(entry);
  const native = getNativeFeatureCompatibility(entry);
  const sidecar = getSidecarFeatureCompatibility(actor, entry);

  // Explicit metadata is highest authority for resolution, but a contradiction
  // with structured native data is unsafe enough to surface as AMBIGUOUS.
  if (explicit) {
    if (explicit.actionType && native.actionType &&
        explicit.actionType !== native.actionType) {
      return {
        bucket: "ambiguous", source: "AMBIGUOUS",
        issue: "action-type-conflict",
        reason: `Explicit actionType '${explicit.actionType}' conflicts with native '${native.actionType}'.`,
        explicit, native, sidecar
      };
    }

    if (explicit.fearCost !== null && native.fearCost !== null &&
        explicit.fearCost !== native.fearCost) {
      return {
        bucket: "ambiguous", source: "AMBIGUOUS",
        issue: "fear-cost-conflict",
        reason: `Explicit Fear ${explicit.fearCost} conflicts with native Fear ${native.fearCost}.`,
        explicit, native, sidecar
      };
    }

    return {
      bucket: "explicit", source: "EXPLICIT", issue: null,
      reason: "Resolved from flags.cybermancy.gmAction.",
      explicit, native, sidecar
    };
  }

  if (native.actionTypeAmbiguous || native.fearAmbiguous) {
    return {
      bucket: "ambiguous", source: "AMBIGUOUS",
      issue: native.actionTypeAmbiguous
        ? "multiple-native-action-types"
        : "ambiguous-native-fear",
      reason: native.actionTypeAmbiguous
        ? "Multiple native Actions expose different action types."
        : native.fearReason ?? "Native Fear metadata is ambiguous.",
      explicit, native, sidecar
    };
  }

  if (native.actionType) {
    return {
      bucket: "native", source: "NATIVE", issue: null,
      reason: "Resolved from structured Daggerheart native Action data.",
      explicit, native, sidecar
    };
  }

  if (sidecar) {
    return {
      bucket: "sidecar", source: "SIDECAR", issue: null,
      reason: "Resolved from QOL compatibility sidecar metadata.",
      explicit, native, sidecar
    };
  }

  return {
    bucket: "unknown", source: "UNKNOWN",
    issue: "insufficient-structured-metadata",
    reason: "No explicit Cybermancy metadata, reliable native Action classification, or sidecar entry is available.",
    explicit, native, sidecar
  };
}

function getSpotlightLimitCompatibility(actor) {
  if (!actor) return {
    limit: 1, source: "DEFAULT", sourceKey: null,
    reason: "Actor unavailable; using advisory base rule."
  };

  const explicit = getExplicitActorSpotlightLimit(actor);
  if (explicit.present) {
    const limit = normalizeSpotlightLimit(explicit.raw);
    if (limit !== null) return {
      limit, source: "CYBERMANCY", sourceKey: null, reason: null
    };

    return {
      limit: 1, source: "DEFAULT", sourceKey: null,
      reason: `Invalid flags.cybermancy.spotlightLimit value: ${String(explicit.raw)}`
    };
  }

  const nativeCandidates = [
    foundry.utils.getProperty(actor, "system.spotlightLimit"),
    foundry.utils.getProperty(actor, "system.resources.spotlightLimit.value")
  ];
  for (const raw of nativeCandidates) {
    const limit = normalizeSpotlightLimit(raw);
    if (limit !== null) return {
      limit, source: "NATIVE", sourceKey: null, reason: null
    };
  }

  for (const sourceKey of getActorSpotlightLimitSourceKeys(actor)) {
    const raw = COMPATIBILITY_SIDECAR.spotlightLimits[sourceKey];
    const limit = normalizeSpotlightLimit(raw);
    if (limit !== null) return {
      limit, source: "SIDECAR", sourceKey, reason: null
    };
  }

  return {
    limit: 1, source: "DEFAULT", sourceKey: null, reason: null
  };
}

function getFeatureCompatibilityDisplay(actor, entry) {
  const result = classifyFeatureCompatibility(actor, entry);
  const details = [];

  if (result.explicit?.actionType)
    details.push(`explicit actionType=${result.explicit.actionType}`);
  if (result.native?.actionType)
    details.push(`native actionType=${result.native.actionType}`);
  if (result.explicit?.fearCost !== null && result.explicit?.fearCost !== undefined)
    details.push(`explicit Fear=${result.explicit.fearCost}`);
  if (result.native?.fearCost !== null && result.native?.fearCost !== undefined)
    details.push(`native Fear=${result.native.fearCost}`);

  return { ...result, detailText: details.join(" · ") };
}

function getCompatibilityReport(scene = canvas?.scene) {
  const empty = {
    sceneId: scene?.id ?? null,
    sceneName: scene?.name ?? null,
    adversaries: 0,
    adversaryGroups: 0,
    environments: 0,
    features: { explicit: 0, native: 0, sidecar: 0, ambiguous: 0, unknown: 0 },
    spotlightLimits: { explicit: 0, native: 0, sidecar: 0, default: 0 },
    issues: []
  };
  if (!scene) return empty;

  const report = foundry.utils.deepClone(empty);
  const groups = getSceneGroups();
  report.adversaryGroups = groups.length;
  report.adversaries = groups.reduce(
    (sum, group) => sum + (group?.tokens?.length ?? 0), 0
  );

  for (const group of groups) {
    const actor = group.actor ?? group?.tokens?.[0]?.actor ?? null;
    if (!actor) continue;

    for (const entry of buildGmActionEntries(actor)) {
      const result = classifyFeatureCompatibility(actor, entry);
      const bucket = COMPATIBILITY_BUCKETS.includes(result.bucket)
        ? result.bucket : "unknown";
      report.features[bucket] += 1;
      if (["ambiguous", "unknown"].includes(bucket)) {
        report.issues.push({
          actor: actor.name ?? "Adversary",
          actorUuid: actor.uuid ?? null,
          feature: entry.name ?? "Feature",
          featureId: entry.id ?? null,
          bucket, issue: result.issue, reason: result.reason
        });
      }
    }

    const limit = getSpotlightLimitCompatibility(actor);
    const key = limit.source === "CYBERMANCY" ? "explicit"
      : limit.source === "NATIVE" ? "native"
        : limit.source === "SIDECAR" ? "sidecar" : "default";
    report.spotlightLimits[key] += 1;
  }

  const discovery = getSceneEnvironments(scene);
  const environments = (discovery.effective ?? [])
    .filter(record => record?.resolved && record?.actor);
  report.environments = environments.length;

  for (const record of environments) {
    const actor = record.actor;
    for (const entry of buildGmActionEntries(actor).filter(e => !e.standardAttack)) {
      const result = classifyFeatureCompatibility(actor, entry);
      const bucket = COMPATIBILITY_BUCKETS.includes(result.bucket)
        ? result.bucket : "unknown";
      report.features[bucket] += 1;
      if (["ambiguous", "unknown"].includes(bucket)) {
        report.issues.push({
          actor: actor.name ?? "Environment",
          actorUuid: actor.uuid ?? null,
          feature: entry.name ?? "Feature",
          featureId: entry.id ?? null,
          bucket, issue: result.issue, reason: result.reason
        });
      }
    }
  }

  return foundry.utils.deepClone(report);
}

// v1.0 compatibility alias for RC-era macros/API consumers.
function getReleaseCandidateDiagnostic(scene = canvas?.scene) {
  return getRuntimeDiagnostic(scene);
}

function toggleInspectorDiagnostics() {
  inspectorDiagnosticsVisible = !inspectorDiagnosticsVisible;
  refreshInspector();
  return inspectorDiagnosticsVisible;
}

function renderCompatibilityDiagnosticForEntry(actor, entry) {
  if (!inspectorDiagnosticsVisible) return "";
  const result = getFeatureCompatibilityDisplay(actor, entry);
  const key = getStableFeatureCompatibilityKey(actor, entry);

  return `
    <div class="cmgi-compatibility-diagnostic">
      <strong>${escapeHtml(result.source)}</strong>
      ${result.reason ? `<span>${escapeHtml(result.reason)}</span>` : ""}
      ${result.detailText ? `<span>${escapeHtml(result.detailText)}</span>` : ""}
      ${key ? `<code>${escapeHtml(key)}</code>` : ""}
    </div>`;
}

function getRuntimeDiagnostic(scene = canvas?.scene) {
  const architecture = getArchitectureDiagnostic();
  const compatibility = getCompatibilityReport(scene);
  const fear = getFearState();
  const spotlight = getSpotlightState();
  const persisted = getPersistedCombatStateDiagnostic(scene);
  const pcEntries = getScenePcEntries();
  const adversaryGroups = getSceneGroups();
  const adversaryTokens = adversaryGroups.flatMap(group => group?.tokens ?? []);
  const environmentDiscovery = scene ? getSceneEnvironments(scene) : { effective: [] };
  const environments = (environmentDiscovery?.effective ?? [])
    .filter(record => record?.resolved && record?.actor);

  const safeRead = (reader, token) => {
    try { return reader(token); }
    catch (error) { return { available: false, error: error?.message ?? String(error) }; }
  };

  const pcStates = pcEntries.map(entry => safeRead(getPcCombatState, entry.token));
  const adversaryStates = adversaryTokens.map(token => safeRead(getAdversaryCombatState, token));
  const combatStates = [...pcStates, ...adversaryStates];

  const resourceStatus = key => {
    if (!combatStates.length) return "NOT EXERCISED";
    return combatStates.every(state => Boolean(state?.[key]?.available)) ? "NATIVE" : "UNKNOWN";
  };

  const configuredConditions = new Set(
    (CONFIG?.statusEffects ?? [])
      .map(effect => String(effect?.id ?? effect?._id ?? "").toLowerCase())
      .filter(Boolean)
  );

  const conditionsStatus = ["vulnerable", "restrained", "hidden"]
    .every(id => configuredConditions.has(id)) ? "NATIVE" : "UNKNOWN";

  const armorStatus = !pcStates.length
    ? "NOT EXERCISED"
    : pcStates.some(state => state?.armor?.available)
      ? "NATIVE"
      : "NATIVE / NONE PRESENT";

  const compatibilityReview = compatibility.features.ambiguous + compatibility.features.unknown;
  const integrity = spotlight.spotlightIntegrity ?? getSpotlightIntegrity();
  const issues = [];

  if (persisted?.parsed?.error) issues.push(`Scene combat-state snapshot: ${persisted.parsed.error}`);
  if (!integrity?.valid) issues.push("Spotlight bookkeeping integrity check failed.");
  for (const issue of compatibility.issues ?? []) {
    issues.push(`${issue.actor} — ${issue.feature}: ${issue.reason ?? issue.issue ?? issue.bucket}`);
  }
  for (const state of combatStates) {
    if (state?.error) issues.push(`Native combat-state read: ${state.error}`);
  }

  return {
    module: { id: MODULE_ID, title: "Cybermancy GM QOL", version: VERSION, combatStateSchema: COMBAT_STATE_SCHEMA_VERSION },
    runtime: {
      foundry: String(game?.version ?? game?.release?.version ?? "unknown"),
      daggerheart: String(game?.system?.version ?? game?.system?.data?.version ?? "unknown")
    },
    scene: {
      id: scene?.id ?? null,
      name: scene?.name ?? null,
      state: persisted?.parsed?.error ? "ERROR" : spotlight.loaded ? "LOADED" : "NOT LOADED",
      revision: spotlight.revision,
      pcs: pcEntries.length,
      adversaryTokens: adversaryTokens.length,
      adversaryGroups: adversaryGroups.length,
      environments: environments.length
    },
    nativeInterfaces: {
      fear: fear.available ? "NATIVE" : "UNKNOWN",
      hp: resourceStatus("hp"),
      stress: resourceStatus("stress"),
      armorSlots: armorStatus,
      evasion: !pcStates.length
        ? "NOT EXERCISED"
        : pcStates.every(state => state?.evasion?.available)
          ? "NATIVE"
          : "UNKNOWN",
      conditions: conditionsStatus,
      embeddedActions: compatibilityReview > 0 ? "REVIEW" : "NATIVE / SAFE",
      opportunityHook: architecture.opportunityRuntime === "daggerheart.postRollDuality" ? "NATIVE" : "UNKNOWN"
    },
    compatibility: foundry.utils.deepClone(compatibility),
    integrity: foundry.utils.deepClone(integrity),
    issues
  };
}

function renderRuntimeDiagnostics() {
  if (!inspectorDiagnosticsVisible) return "";

  const diagnostic = getRuntimeDiagnostic();
  const compatibility = diagnostic.compatibility;
  const labels = {
    fear: "Fear", hp: "HP", stress: "Stress", armorSlots: "Armor Slots",
    evasion: "Evasion", conditions: "Conditions",
    embeddedActions: "Embedded Actions", opportunityHook: "Opportunity Hook"
  };

  const interfaces = Object.entries(diagnostic.nativeInterfaces)
    .map(([key, value]) => `
      <div class="cmgi-runtime-diagnostic-row">
        <span>${escapeHtml(labels[key] ?? key)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`).join("");

  return `
    <section class="cmgi-runtime-diagnostics">
      <div class="cmgi-section-title">QOL DIAGNOSTICS</div>
      <div class="cmgi-runtime-diagnostic-grid">
        <span>Module</span><strong>${escapeHtml(diagnostic.module.version)}</strong>
        <span>Foundry</span><strong>${escapeHtml(diagnostic.runtime.foundry)}</strong>
        <span>Daggerheart</span><strong>${escapeHtml(diagnostic.runtime.daggerheart)}</strong>
        <span>Combat Schema</span><strong>${escapeHtml(diagnostic.module.combatStateSchema)}</strong>
        <span>Scene State</span><strong>${escapeHtml(diagnostic.scene.state)} · rev ${escapeHtml(diagnostic.scene.revision)}</strong>
        <span>Scene</span><strong>${escapeHtml(diagnostic.scene.name ?? "none")}</strong>
        <span>Actors</span><strong>${escapeHtml(`${diagnostic.scene.pcs} PCs · ${diagnostic.scene.adversaryTokens} adversaries · ${diagnostic.scene.environments} environments`)}</strong>
      </div>
      <div class="cmgi-runtime-diagnostic-subtitle">NATIVE INTERFACES</div>
      <div class="cmgi-runtime-interface-grid">${interfaces}</div>
      <div class="cmgi-runtime-diagnostic-subtitle">COMPATIBILITY REPORT</div>
      <div class="cmgi-compatibility-counts">
        <span>EXPLICIT ${compatibility.features.explicit}</span>
        <span>NATIVE ${compatibility.features.native}</span>
        <span>SIDECAR ${compatibility.features.sidecar}</span>
        <span>AMBIGUOUS ${compatibility.features.ambiguous}</span>
        <span>UNKNOWN ${compatibility.features.unknown}</span>
      </div>
      <div class="cmgi-compatibility-counts">
        <span>LIMITS: CYBERMANCY ${compatibility.spotlightLimits.explicit}</span>
        <span>NATIVE ${compatibility.spotlightLimits.native}</span>
        <span>SIDECAR ${compatibility.spotlightLimits.sidecar}</span>
        <span>DEFAULT ${compatibility.spotlightLimits.default}</span>
      </div>
      <div class="cmgi-runtime-diagnostic-subtitle">INTEGRITY</div>
      <div class="cmgi-runtime-integrity${diagnostic.integrity?.valid ? " cmgi-runtime-ok" : " cmgi-runtime-review"}">
        Spotlight bookkeeping: <strong>${diagnostic.integrity?.valid ? "PASS" : "REVIEW"}</strong>
      </div>
      ${diagnostic.issues.length
        ? `<details class="cmgi-runtime-issues"><summary>${diagnostic.issues.length} item(s) need review</summary><ul>${diagnostic.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></details>`
        : `<div class="cmgi-muted">No runtime compatibility or integrity issues detected on this Scene.</div>`}
    </section>`;
}

// ===== 70-rendering.js =====
/* -------------------------------------------- */
/*  Existing Rendering                          */
/* -------------------------------------------- */

function isEnvironmentExpanded(uuid) {
  return Boolean(uuid) && expandedEnvironments.has(String(uuid));
}

function toggleEnvironmentExpanded(uuid) {
  if (!uuid) return false;
  const key = String(uuid);

  if (expandedEnvironments.has(key)) {
    expandedEnvironments.delete(key);
    return false;
  }

  expandedEnvironments.add(key);
  return true;
}

function renderEnvironmentFeatures(actor, environmentUuid) {
  const entries = buildGmActionEntries(actor)
    .filter(entry => !entry.standardAttack);
  const fear = getFearState();

  if (!entries.length) {
    return `
      <div class="cmgi-environment-features">
        <div class="cmgi-section-title">ENVIRONMENT FEATURES</div>
        <div class="cmgi-muted">No embedded feature Items found.</div>
      </div>`;
  }

  const rows = entries.map(entry => `
    <div class="cmgi-action-shell cmgi-environment-action-shell">
      <details class="cmgi-action-entry">
        <summary>
          <span class="cmgi-action-name">${escapeHtml(entry.name)}</span>
          <span class="cmgi-action-badges">${renderActionBadges(entry, fear)}</span>
        </summary>
        <div class="cmgi-action-details">
          ${renderActionDetails(entry)}
          ${renderCompatibilityDiagnosticForEntry(actor, entry)}
        </div>
      </details>
      ${renderEnvironmentActionTransactionControl(
        environmentUuid,
        entry
      )}
    </div>
  `).join("");

  return `
    <div class="cmgi-environment-features">
      <div class="cmgi-section-title">ENVIRONMENT ACTIONS & FEATURES</div>
      ${inspectorDiagnosticsVisible ? `
        <div class="cmgi-action-note cmgi-muted">
          Action/Attack features use the shared GM Move economy.
          Structured Reactions and explicit non-Spotlight features use REACT with
          no GM Move or adversary Spotlight. Passive features remain reference-only.
        </div>
      ` : ""}
      ${rows}
    </div>`;
}

function renderEnvironmentCard(record) {
  const expanded = isEnvironmentExpanded(record.uuid);
  const expandedClass = expanded ? " cmgi-expanded" : "";

  if (!record.resolved || !record.actor) {
    return `
      <section class="cmgi-environment-card cmgi-environment-unresolved${expandedClass}">
        <div class="cmgi-environment-title-row">
          <button type="button"
                  class="cmgi-environment-toggle"
                  data-action="toggle-environment"
                  data-environment-uuid="${escapeHtml(record.uuid)}"
                  aria-expanded="${expanded ? "true" : "false"}"
                  title="${expanded ? "Collapse Environment" : "Expand Environment"}">
            <span class="cmgi-group-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            <span class="cmgi-environment-identity">
              <strong class="cmgi-environment-name">UNRESOLVED ENVIRONMENT</strong>
              <span class="cmgi-environment-source">LINKED</span>
            </span>
          </button>

          <button type="button"
                  class="cmgi-environment-control"
                  data-action="unlink-environment"
                  data-environment-uuid="${escapeHtml(record.uuid)}">
            REMOVE LINK
          </button>
        </div>

        ${expanded ? `
          <div class="cmgi-expanded-content">
            <div class="cmgi-muted"><code>${escapeHtml(record.uuid)}</code></div>
            <div class="cmgi-environment-issue">
              The linked Actor could not be found or is no longer an Environment.
              The Inspector did not alter the Scene link.
            </div>
          </div>
        ` : ""}
      </section>`;
  }

  const actor = record.actor;
  const tier = actor?.system?.tier ?? null;
  const sourceLabel = record.linked
    ? record.tokenDetected
      ? "LINKED · TOKEN PRESENT"
      : "LINKED"
    : "TOKEN-DETECTED";

  const control = record.linked
    ? `
      <button type="button"
              class="cmgi-environment-control"
              data-action="unlink-environment"
              data-environment-uuid="${escapeHtml(record.uuid)}"
              title="Remove only the explicit Scene link. If an Environment token remains on the Scene, it will continue to be shown as TOKEN-DETECTED.">
        UNLINK
      </button>`
    : `
      <button type="button"
              class="cmgi-environment-control"
              data-action="link-environment"
              data-environment-uuid="${escapeHtml(record.uuid)}"
              title="Persist this token-detected Environment on the Scene flag.">
        LINK TO SCENE
      </button>`;

  return `
    <section class="cmgi-environment-card${expandedClass}">
      <div class="cmgi-environment-title-row">
        <button type="button"
                class="cmgi-environment-toggle"
                data-action="toggle-environment"
                data-environment-uuid="${escapeHtml(record.uuid)}"
                aria-expanded="${expanded ? "true" : "false"}"
                title="${expanded ? "Collapse Environment" : "Expand Environment"}">
          ${renderQolActorThumbnail(actor, "cmgi-environment-thumbnail")}
          <span class="cmgi-group-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
          <span class="cmgi-environment-identity">
            <strong class="cmgi-environment-name">${escapeHtml(actor.name ?? "Environment")}</strong>
            ${tier !== null && tier !== undefined
              ? `<span class="cmgi-environment-tier">Tier ${escapeHtml(tier)}</span>`
              : ""}
            <span class="cmgi-environment-source">${escapeHtml(sourceLabel)}</span>
            <span class="cmgi-environment-compact">
              ${getEnvironmentExecutableActionCount(actor)} EXECUTABLE
            </span>
          </span>
        </button>

        ${control}
      </div>

      ${expanded ? `
        <div class="cmgi-expanded-content">
          ${renderFastPlay(actor)}
          ${renderEnvironmentFeatures(actor, record.uuid)}
        </div>
      ` : ""}
    </section>`;
}

function renderEnvironmentSection() {
  const discovery = getSceneEnvironments();
  const effective = discovery.effective ?? [];

  return `
    <section class="cmgi-environments">
      <div class="cmgi-environment-header">
        <div>
          <span class="cmgi-environment-heading">ENVIRONMENTS</span>
          <span class="cmgi-muted">${effective.length} active/detected</span>
        </div>

        <button type="button"
                class="cmgi-environment-control"
                data-action="show-link-environment">
          LINK ENVIRONMENT
        </button>
      </div>

      ${effective.length
        ? effective.map(renderEnvironmentCard).join("")
        : `
          <div class="cmgi-environment-empty cmgi-muted">
            No active Environment is linked or represented by an Environment token.
          </div>
        `}
    </section>`;
}

function renderEnvironmentSectionSafe() {
  try {
    return renderEnvironmentSection();
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Environment section render failed",
      error
    );

    return `
      <section class="cmgi-environments">
        <div class="cmgi-environment-header">
          <div>
            <span class="cmgi-environment-heading">ENVIRONMENTS</span>
          </div>
          <button type="button"
                  class="cmgi-environment-control"
                  data-action="show-link-environment">
            LINK ENVIRONMENT
          </button>
        </div>
        <div class="cmgi-environment-card cmgi-environment-unresolved">
          <strong>ENVIRONMENT DISPLAY ERROR</strong>
          <div class="cmgi-muted">
            Environment reference rendering failed. GM combat state and roll
            opportunity detection remain active. See console for diagnostics.
          </div>
        </div>
      </section>`;
  }
}

function renderFearHeader() {
  const fear = getFearState();
  const slotCount = 12;
  const busy = isQolNativeWriteBusy();

  const dots = Array.from({ length: slotCount }, (_, index) => {
    const slot = index + 1;
    const withinCapacity =
      fear.available
      && slot <= fear.max;

    const filled =
      withinCapacity
      && slot <= fear.current;

    const canGain =
      withinCapacity
      && !filled
      && fear.current < fear.max
      && !busy;

    const canSpend =
      withinCapacity
      && filled
      && fear.current > 0
      && !busy;

    const stateClass = !withinCapacity
      ? "cmgi-fear-dot-disabled"
      : filled
        ? "cmgi-fear-dot-filled"
        : "cmgi-fear-dot-empty";

    const title = !fear.available
      ? "Native Daggerheart Fear is unavailable."
      : !withinCapacity
        ? `Fear slot ${slot} is outside the configured maximum of ${fear.max}.`
        : filled
          ? `Fear slot ${slot}: available. Click to spend 1 Fear manually. This does not create or modify a QOL transaction ledger entry.`
          : `Fear slot ${slot}: empty. Click to gain 1 Fear manually. This does not create or modify a QOL transaction ledger entry.`;

    return `
      <button type="button"
              class="cmgi-fear-dot ${stateClass}"
              ${canSpend
                ? 'data-action="spend-qol-fear"'
                : canGain
                  ? 'data-action="gain-qol-fear"'
                  : ""}
              aria-label="${escapeHtml(title)}"
              title="${escapeHtml(title)}"
              ${canGain || canSpend ? "" : "disabled"}>
        <span aria-hidden="true"></span>
      </button>`;
  }).join("");

  const diagnostic = fear.available
    ? `
      <div><strong>Current:</strong> ${escapeHtml(fear.current)}</div>
      <div><strong>Configured maximum:</strong> ${escapeHtml(fear.max)}</div>
      <div><strong>QOL display:</strong> 12 Fear slots; clicking an empty in-capacity slot gains exactly 1 native Fear, and clicking a filled slot spends exactly 1 native Fear. Manual bubble changes are not added to the QOL combat transaction ledger.</div>
      <div><strong>Current Setting:</strong>
        game.settings.get("${escapeHtml(fear.namespace)}", "${escapeHtml(fear.fearKey)}")
      </div>
      <div><strong>Maximum Setting:</strong>
        game.settings.get("${escapeHtml(fear.namespace)}", "${escapeHtml(fear.homebrewKey)}").maxFear
      </div>`
    : `
      <div><strong>Reason:</strong> ${escapeHtml(fear.reason ?? "Unknown")}</div>
      <div><strong>Safety behavior:</strong> No fallback value is guessed and Fear dots are disabled.</div>`;

  return `
    <div class="cmgi-fear">
      <div class="cmgi-fear-readout">
        <span class="cmgi-fear-label">FEAR</span>
        <div class="cmgi-fear-dots"
             role="group"
             aria-label="${fear.available
               ? `Fear ${escapeHtml(fear.current)} of ${escapeHtml(fear.max)}`
               : "Fear unavailable"}">
          ${dots}
        </div>
        <span class="cmgi-readonly">NATIVE</span>
      </div>

      ${inspectorDiagnosticsVisible ? `
        <details class="cmgi-fear-diagnostics">
          <summary>Fear diagnostics</summary>
          ${diagnostic}
        </details>
      ` : ""}
    </div>`;
}

function getFastPlayUiKey(actor) {
  return String(actor?.uuid ?? actor?.id ?? actor?.name ?? "unknown");
}

function isFastPlayCollapsed(actor) {
  return collapsedFastPlay.has(getFastPlayUiKey(actor));
}

function toggleFastPlayCollapsed(actorKey) {
  if (!actorKey) return false;

  if (collapsedFastPlay.has(actorKey)) {
    collapsedFastPlay.delete(actorKey);
    return false;
  }

  collapsedFastPlay.add(actorKey);
  return true;
}

function renderFastPlay(actor) {
  const fastPlay = getFastPlay(actor);
  const actorKey = getFastPlayUiKey(actor);
  const collapsed = isFastPlayCollapsed(actor);

  if (!fastPlay) {
    return `
      <div class="cmgi-fastplay cmgi-muted">
        Fast Play unavailable for this Actor.
      </div>`;
  }

  const prompts = Array.isArray(fastPlay.prompts) ? fastPlay.prompts : [];
  const promptHtml = prompts.map(prompt => `
    <div class="cmgi-fastplay-row">
      <div class="cmgi-fastplay-label">
        <strong><em>${escapeHtml(prompt.label)}</em></strong>
      </div>
      <div class="cmgi-fastplay-text">${escapeHtml(prompt.text)}</div>
    </div>
  `).join("");

  const goalHtml = fastPlay.goal
    ? `
      <div class="cmgi-fastplay-row cmgi-goal">
        <div class="cmgi-fastplay-label"><strong><em>Goal</em></strong></div>
        <div class="cmgi-fastplay-text">${escapeHtml(fastPlay.goal)}</div>
      </div>`
    : "";

  return `
    <div class="cmgi-fastplay${collapsed ? " cmgi-fastplay-collapsed" : ""}">
      <button type="button"
              class="cmgi-fastplay-toggle"
              data-action="toggle-fastplay"
              data-actor-key="${escapeHtml(actorKey)}"
              aria-expanded="${collapsed ? "false" : "true"}"
              title="${collapsed ? "Expand Fast Play" : "Collapse Fast Play"}">
        <span class="cmgi-group-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
        <span class="cmgi-section-title">FAST PLAY</span>
      </button>

      ${collapsed ? "" : `
        <div class="cmgi-fastplay-content">
          ${promptHtml}
          ${goalHtml}
        </div>
      `}
    </div>`;
}

function renderDiagnostics(actor) {
  if (!inspectorDiagnosticsVisible) return "";

  const features = [...(actor?.items ?? [])];

  if (!features.length) {
    return `
      <details class="cmgi-diagnostics">
        <summary>Actor diagnostics</summary>
        <div class="cmgi-muted">No embedded feature Items.</div>
      </details>`;
  }

  const rows = features.map(item => {
    const meta = getGmActionMetadata(item);

    const status = meta
      ? `<span class="cmgi-explicit"><strong>EXPLICIT</strong> ${escapeHtml(JSON.stringify(meta))}</span>`
      : `<span class="cmgi-muted">No gmAction metadata</span>`;

    return `
      <li>
        <strong>${escapeHtml(item.name)}</strong><br>
        ${status}
      </li>`;
  }).join("");

  return `
    <details class="cmgi-diagnostics">
      <summary>Actor diagnostics</summary>
      <ul>${rows}</ul>
    </details>`;
}

function renderSpotlightHeader() {
  const isGm = spotlightOwner === "GM";
  const fear = getFearState();
  const prepared = getPreparedGmMove();
  const newMoveCost = getNewGmMoveCost();
  const canAffordInterrupt = fear.available && fear.current >= 1 && !fearTransactionPending;
  const canAffordNewMove =
    newMoveCost === 0
    || (fear.available && fear.current >= newMoveCost);
  const entryLabel = gmEntryMode === "interrupt" ? "Interrupt" : "Natural";
  const opportunity = !isGm ? pendingOpportunity : null;
  const rollNotice = !isGm ? pendingRollNotice : null;
  const opportunityCount = opportunity?.observedCount ?? 0;

  const preparedLabel = prepared
    ? prepared.entry.moveFearCost > 0
      ? `MOVE READY — ${prepared.entry.moveFearCost} FEAR PAID`
      : "MOVE READY — BASE MOVE"
    : null;

  return `
    <div class="cmgi-spotlight ${isGm ? "cmgi-spotlight-gm" : "cmgi-spotlight-pc"}">
      <div class="cmgi-spotlight-status">
        <span class="cmgi-spotlight-label">SPOTLIGHT</span>
        <span class="cmgi-spotlight-owner">${isGm ? "GM" : "PCs"}</span>
        ${isGm ? `<span class="cmgi-entry-mode">ENTRY ${escapeHtml(entryLabel)}</span>` : ""}
      </div>

      ${!isGm && rollNotice ? `
        <div class="cmgi-roll-notice">
          <div class="cmgi-roll-notice-summary">
            <span class="cmgi-roll-notice-label">NO RESULT</span>
            <strong>${escapeHtml(rollNotice.actorName)} — RESULT UNRESOLVED</strong>
            <span class="cmgi-roll-notice-text">
              Select a target or set a Difficulty so Daggerheart can determine
              success/failure. No GM Opportunity was created.
            </span>
          </div>

          <button type="button"
                  class="cmgi-opportunity-dismiss"
                  data-action="dismiss-roll-notice"
                  ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
                  title="Dismiss this informational notice without changing Spotlight, Fear, or GM Moves.">
            DISMISS
          </button>
        </div>
      ` : ""}

      ${isGm ? `
        <div class="cmgi-gm-moves">
          <span class="cmgi-gm-move-label">GM MOVES THIS TURN</span>
          <span class="cmgi-gm-move-count">${gmMovesThisTurn}</span>

          ${prepared ? `
            <span class="cmgi-move-ready"
                  title="This GM Move has already been acquired. Using an Attack/Action consumes it without another GM Move Fear charge.">
              ${escapeHtml(preparedLabel)}
            </span>

            <button
              type="button"
              class="cmgi-gm-move-button"
              data-action="complete-manual-gm-move"
              ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
              title="Mark the prepared GM Move as spent on a manual/fictional GM Move that is not represented by a GM Action USE button.">
              COMPLETE MANUAL MOVE
            </button>
          ` : `
            <button
              type="button"
              class="cmgi-gm-move-button"
              data-action="record-gm-move"
              ${canAffordNewMove && !fearTransactionPending && !actionTransactionPending && !reactionTransactionPending && !conditionTransactionPending ? "" : "disabled"}
              title="${newMoveCost === 0
                ? "Prepare the natural handoff's base GM Move. Cost: 0 Fear. The next Action can consume it."
                : `Prepare one additional GM Move. Cost: ${newMoveCost} Fear from the native Daggerheart pool. The next Action can consume it without paying again.`}">
              ${newMoveCost === 0 ? "PREPARE BASE MOVE — 0 FEAR" : "ADD MOVE — 1 FEAR"}
            </button>
          `}

          <button
            type="button"
            class="cmgi-gm-move-undo"
            data-action="undo-gm-move"
            ${gmMoveLedger.length > 0 && !fearTransactionPending && !actionTransactionPending && !reactionTransactionPending && !conditionTransactionPending ? "" : "disabled"}
            title="Undo the most recently prepared/used GM Move. For native Actions, this reverses QOL bookkeeping only; Daggerheart costs/effects are not reversed.">
            ↶
          </button>
        </div>

        <button
          type="button"
          class="cmgi-spotlight-main-button"
          data-action="end-gm-turn"
          ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
          title="End this GM turn. Reset current-turn GM Move and adversary Spotlight counts, preserve cumulative token totals, and return Spotlight to the PCs.">
          END GM TURN
        </button>
      ` : opportunity ? `
        <div class="cmgi-opportunity">
          <div class="cmgi-opportunity-summary">
            <span class="cmgi-opportunity-label">GM OPPORTUNITY</span>
            <strong>${escapeHtml(opportunity.actorName)} — ${escapeHtml(opportunity.outcomeLabel)}</strong>
            <span class="cmgi-opportunity-weight">${escapeHtml(opportunity.moveWeight.toUpperCase())} MOVE</span>
            ${opportunityCount > 1
              ? `<span class="cmgi-opportunity-count">${opportunityCount} qualifying rolls observed</span>`
              : ""}
          </div>

          <div class="cmgi-entry-buttons">
            <button
              type="button"
              class="cmgi-spotlight-main-button"
              data-action="take-natural-spotlight"
              ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
              title="Take this detected natural GM opportunity. No Fear is spent; Daggerheart already owns any Fear generated by the triggering roll.">
              TAKE NATURAL — 0 FEAR
            </button>

            <button
              type="button"
              class="cmgi-spotlight-main-button cmgi-interrupt-button"
              data-action="take-interrupt-spotlight"
              ${canAffordInterrupt && !actionTransactionPending && !reactionTransactionPending && !conditionTransactionPending ? "" : "disabled"}
              title="Ignore the free natural handoff and deliberately interrupt instead. Spend 1 native Daggerheart Fear; the purchase includes one prepared GM Move.">
              INTERRUPT — 1 FEAR
            </button>

            <button
              type="button"
              class="cmgi-opportunity-dismiss"
              data-action="dismiss-opportunity"
              ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
              title="Dismiss this detected opportunity without changing Spotlight, Fear, or GM Moves.">
              DISMISS
            </button>
          </div>
        </div>
      ` : `
        <div class="cmgi-entry-buttons">
          <button
            type="button"
            class="cmgi-spotlight-main-button"
            data-action="take-natural-spotlight"
            ${fearTransactionPending || actionTransactionPending || reactionTransactionPending || conditionTransactionPending ? "disabled" : ""}
            title="Manual natural handoff: take GM Spotlight without spending Fear. Use this for golden opportunities, unavoidable consequences, players looking to the GM, and other fictional handoffs that roll detection cannot determine.">
            NATURAL HANDOFF — 0 FEAR
          </button>

          <button
            type="button"
            class="cmgi-spotlight-main-button cmgi-interrupt-button"
            data-action="take-interrupt-spotlight"
            ${canAffordInterrupt && !actionTransactionPending && !reactionTransactionPending && !conditionTransactionPending ? "" : "disabled"}
            title="Interrupt the PCs: spend 1 native Daggerheart Fear. The purchase includes one prepared GM Move; the next Action consumes it without another GM Move Fear charge.">
            INTERRUPT — 1 FEAR
          </button>
        </div>
      `}
    </div>`;
}

function renderCompactCombatSummary(token) {
  if (!token?.actor || !isAdversaryActor(token.actor)) return "";
  const state = getAdversaryCombatState(token);

  if (state.defeated) {
    return `<span class="cmgi-compact-state cmgi-compact-defeated">DEFEATED</span>`;
  }

  const parts = [];
  if (state.hp.available) parts.push(`HP ${state.hp.remaining}/${state.hp.max}`);
  if (state.stress.available) parts.push(`STRESS ${state.stress.marked}/${state.stress.max}`);
  if (state.armor.available) parts.push(`ARMOR ${state.armor.remaining}/${state.armor.max}`);

  const conditions = state.effects
    .filter(effect => effect.isVulnerable || effect.isRestrained || effect.isHidden)
    .map(effect => effect.name.toUpperCase());
  if (conditions.length) parts.push(conditions.slice(0, 2).join(" · "));

  return parts.length
    ? `<span class="cmgi-compact-state">${escapeHtml(parts.join(" · "))}</span>`
    : "";
}

function renderGroupCollapsedSummary(group) {
  const tokens = group?.tokens ?? [];
  if (!tokens.length) return "";

  const selected = getSelectedTokenForGroup(group) ?? tokens[0];
  const turn = getSpotlightUseCount(getTokenStateKey(selected));
  const prefix = tokens.length > 1
    ? `${selected.name ?? selected.actor?.name ?? "Token"}: `
    : "";

  return `
    <span class="cmgi-group-summary">
      <span>TURN ${turn}</span>
      <span>${escapeHtml(prefix)}</span>
      ${renderCompactCombatSummary(selected)}
    </span>`;
}

function getEnvironmentExecutableActionCount(actor) {
  if (!actor) return 0;
  return buildGmActionEntries(actor)
    .filter(entry => !entry.standardAttack)
    .filter(entry => {
      const compatibility = classifyFeatureCompatibility(actor, entry);
      if (["ambiguous", "unknown"].includes(compatibility.bucket)) return false;
      return resolveReactionTransactionCapability(entry).eligible
        || resolveEnvironmentActionTransactionCapability(entry).eligible;
    })
    .length;
}

function renderTokenInstances(group) {
  const selectedToken = getSelectedToken();
  const instances = getTokenInstanceLabels(group);
  const canRecord = spotlightOwner === "GM";
  const grantTransaction = getGrantModeTransaction();
  const granting = Boolean(grantTransaction);

  const buttons = instances.map(({ token, label }) => {
    const selectedClass = token?.id === selectedToken?.id
      ? " cmgi-token-selected"
      : "";

    const tokenKey = getTokenStateKey(token);
    const combatState = getAdversaryCombatState(token);
    const defeated = combatState.defeated;
    const turnCount = getSpotlightUseCount(tokenKey);
    const linkedCount = getLinkedSpotlightCount(tokenKey);
    const unlinkedCount = getUnlinkedSpotlightCount(tokenKey);
    const totalCount = getSpotlightTotalCount(tokenKey);
    const limitState = getSpotlightLimit(token);
    const usedClass = turnCount > 0 ? " cmgi-spotlight-used" : "";
    const symbol = turnCount > 0 ? "●" : "○";
    const integrityMismatch = linkedCount > turnCount || turnCount > totalCount;

    const limitStatus = limitState.exceeded
      ? `OVER +${limitState.overBy}`
      : limitState.reached
        ? "REACHED"
        : null;

    const limitText = [
      `LIMIT ${limitState.limit}`,
      limitState.sourceLabel,
      limitStatus
    ].filter(Boolean).join(" · ");

    const nextTurn = turnCount + 1;
    const nextOverBy = Math.max(0, nextTurn - limitState.limit);
    const recordTitle = defeated
      ? "This adversary is defeated and cannot receive a new Spotlight."
      : canRecord
        ? nextOverBy > 0
        ? `Record one unlinked Spotlight use for this exact token. This will exceed the resolved Spotlight limit ${limitState.limit} by ${nextOverBy}. Advisory only; recording remains allowed.`
        : `Record one unlinked Spotlight use for this exact token. Resolved Spotlight limit: ${limitState.limit} (${limitState.sourceLabel}). This increments both TURN and TOTAL.`
      : "Take GM Spotlight before recording adversary Spotlight uses.";

    const projectedGrantTurn = turnCount + 1;
    const projectedGrantOverBy = Math.max(0, projectedGrantTurn - limitState.limit);
    const grantTitle = projectedGrantOverBy > 0
      ? `Grant +1 linked Spotlight from the current GM Action transaction. Result: TURN ${projectedGrantTurn} / LIMIT ${limitState.limit} — OVER +${projectedGrantOverBy}. Advisory only; the grant remains allowed.`
      : `Grant +1 linked Spotlight from the current GM Action transaction. Result: TURN ${projectedGrantTurn} / LIMIT ${limitState.limit}. No Fear or additional GM Move is recorded.`;

    const undoEnabled = unlinkedCount > 0;
    const undoTitle = integrityMismatch
      ? "Spotlight bookkeeping is inconsistent for this token. Token Undo is protected; use the integrity diagnostic and GM Move Undo."
      : undoEnabled
        ? `Undo one unlinked/manual/granted Spotlight use. ${linkedCount > 0 ? `${linkedCount} transaction-linked Spotlight(s) will remain protected.` : "This also decrements TOTAL by one."}`
        : linkedCount > 0
          ? "The remaining Spotlight use is linked to a GM Action transaction. Use Undo GM Move to reverse it."
          : "No current-turn Spotlight use is available to undo.";

    const limitTitle = [
      `Resolved Spotlight limit: ${limitState.limit}.`,
      `Source: ${limitState.sourceLabel}.`,
      limitState.reason ? `Fallback reason: ${limitState.reason}.` : "",
      "This limit is advisory in v0.15; the QOL tool does not block additional Spotlights."
    ].filter(Boolean).join(" ");

    return `
      <div class="cmgi-token-instance-row">
        <button type="button" class="cmgi-token-instance${selectedClass}" data-action="focus-token" data-token-id="${escapeHtml(token.id)}" title="Select and pan to this exact token">${escapeHtml(label)}${defeated ? " · DEFEATED" : ""}</button>
        <span class="cmgi-spotlight-metrics">
          <button type="button"
                  class="cmgi-token-spotlight${usedClass}${limitState.exceeded ? " cmgi-limit-over" : limitState.reached ? " cmgi-limit-reached" : ""}"
                  data-action="record-spotlight"
                  data-token-key="${escapeHtml(tokenKey)}"
                  ${canRecord && !defeated && !conditionTransactionPending ? "" : "disabled"}
                  title="${escapeHtml(`${recordTitle} ${limitTitle}`)}">
            <span class="cmgi-token-counter-label">SPOT</span>
            <strong>${turnCount}/${limitState.limit}</strong>
          </button>
          <span class="cmgi-token-linked${integrityMismatch ? " cmgi-integrity-warning" : ""}"
                title="${integrityMismatch ? "Linked Spotlight count does not agree with current-turn/total bookkeeping." : "LINK = current-turn Spotlight uses owned by GM Action transactions. These can only be reversed by Undo GM Move."}">
            <span class="cmgi-token-counter-label">LINK</span><strong>${linkedCount}</strong>
          </span>
          <span class="cmgi-token-total"
                title="TOTAL = cumulative recorded Spotlights for this exact token on this Scene. END GM TURN does not reset it.">
            <span class="cmgi-token-counter-label">TOTAL</span><strong>${totalCount}</strong>
          </span>
        </span>
        ${granting ? `
          <button type="button"
                  class="cmgi-token-grant${projectedGrantOverBy > 0 ? " cmgi-limit-over" : ""}"
                  data-action="grant-spotlight"
                  data-token-id="${escapeHtml(token.id)}"
                  ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending || defeated ? "disabled" : ""}
                  title="${escapeHtml(defeated ? "This adversary is defeated and cannot receive a granted Spotlight." : grantTitle)}">
            GRANT +1
          </button>
        ` : ""}
        <button type="button" class="cmgi-token-undo" data-action="undo-spotlight" data-token-key="${escapeHtml(tokenKey)}" ${undoEnabled && !integrityMismatch ? "" : "disabled"}
          title="${escapeHtml(undoTitle)}">↶</button>
      </div>`;
  }).join("");

  return `
    <div class="cmgi-token-instances">
      <span class="cmgi-token-label"><strong><em>TOKENS</em></strong></span>
      <div class="cmgi-token-buttons">
        ${buttons}
      </div>
    </div>`;
}

function renderQolActorThumbnail(actor, className = "") {
  const src = String(actor?.img ?? "").trim();
  if (!src) return "";

  return `
    <img class="cmgi-header-thumbnail ${escapeHtml(className)}"
         src="${escapeHtml(src)}"
         alt=""
         aria-hidden="true">`;
}

function renderPcRow(entry) {
  const token = entry?.token ?? null;
  const actor = entry?.actor ?? token?.actor ?? null;
  if (!token || !actor) return "";

  const state = getPcCombatState(token);
  const busy = isQolNativeWriteBusy();
  const selectedClass = token.controlled ? " cmgi-token-selected" : "";

  const hpValue = state.hp.available
    ? `${state.hp.remaining}/${state.hp.max}`
    : "—";

  const stressValue = state.stress.available
    ? `${state.stress.marked}/${state.stress.max}`
    : "—";

  const major = state.thresholds.major !== null
    ? String(state.thresholds.major)
    : "—";

  const severe = state.thresholds.severe !== null
    ? String(state.thresholds.severe)
    : "—";

  const img = String(actor.img ?? "").trim();

  const hpControl = state.hp.available
    ? `
      <button type="button"
              class="cmgi-state-resource-button cmgi-pc-resource-button"
              data-action="adjust-qol-resource"
              data-resource="hp"
              data-qol-scope="pc"
              data-token-id="${escapeHtml(token.id)}"
              ${busy ? "disabled" : ""}
              title="HP ${escapeHtml(hpValue)}. Left click: −1 remaining HP. Right click: +1 remaining HP.">
        <span class="cmgi-state-label">HP</span>
        <strong>${escapeHtml(hpValue)}</strong>
      </button>`
    : `
      <span class="cmgi-state-compact-item">
        <span class="cmgi-state-label">HP</span>
        <strong>—</strong>
      </span>`;

  const stressControl = state.stress.available
    ? `
      <button type="button"
              class="cmgi-state-resource-button cmgi-pc-resource-button${state.fullStress ? " cmgi-state-warning" : ""}"
              data-action="adjust-qol-resource"
              data-resource="stress"
              data-qol-scope="pc"
              data-token-id="${escapeHtml(token.id)}"
              ${busy || !state.stress.isReversed ? "disabled" : ""}
              title="Stress ${escapeHtml(stressValue)}. Left click: −1 marked Stress. Right click: +1 marked Stress.">
        <span class="cmgi-state-label">STRESS</span>
        <strong>${escapeHtml(stressValue)}</strong>
        ${state.fullStress ? `<span class="cmgi-state-flag">FULL</span>` : ""}
      </button>`
    : `
      <span class="cmgi-state-compact-item">
        <span class="cmgi-state-label">STRESS</span>
        <strong>—</strong>
      </span>`;

  const armorControl = state.armor.available
    ? `
      <span class="cmgi-state-compact-item cmgi-pc-readonly"
            title="${escapeHtml(`${state.armor.marked} Armor Slot(s) marked; ${state.armor.remaining} remaining of ${state.armor.max}.`)}">
        <span class="cmgi-state-label">ARMOR SLOTS</span>
        <strong>${escapeHtml(`${state.armor.remaining}/${state.armor.max}`)}</strong>
      </span>`
    : "";

  return `
    <div class="cmgi-pc-row" data-pc-key="${escapeHtml(entry.key)}">
      ${img
        ? `<img class="cmgi-pc-thumbnail" src="${escapeHtml(img)}" alt="">`
        : `<span class="cmgi-pc-thumbnail cmgi-pc-thumbnail-empty" aria-hidden="true"></span>`}

      <button type="button"
              class="cmgi-token-instance cmgi-pc-name${selectedClass}"
              data-action="focus-token"
              data-token-id="${escapeHtml(token.id)}"
              title="Select and pan to this PC token">
        ${escapeHtml(actor.name ?? token.name ?? "PC")}
      </button>

      ${hpControl}
      ${stressControl}
      ${armorControl}

      <span class="cmgi-state-compact-item cmgi-pc-readonly">
        <span class="cmgi-state-label">THRESHOLDS</span>
        <strong>${escapeHtml(`${major}/${severe}`)}</strong>
      </span>

      <span class="cmgi-state-compact-item cmgi-pc-readonly">
        <span class="cmgi-state-label">EVASION</span>
        <strong>${state.evasion?.available ? escapeHtml(state.evasion.value) : "—"}</strong>
      </span>

      <span class="cmgi-pc-conditions">
        ${renderQolConditionControls(token, state, { scope: "pc" })}
      </span>
    </div>`;
}

function togglePcSectionCollapsed() {
  pcSectionCollapsed = !pcSectionCollapsed;
  return pcSectionCollapsed;
}

function renderPcSection(entries = getScenePcEntries()) {
  const collapsed = pcSectionCollapsed;

  return `
    <section class="cmgi-pc-section${collapsed ? " cmgi-pc-section-collapsed" : ""}">
      <button type="button"
              class="cmgi-pc-section-toggle"
              data-action="toggle-pc-section"
              aria-expanded="${collapsed ? "false" : "true"}"
              title="${collapsed ? "Expand PC section" : "Collapse PC section"}">
        <span class="cmgi-group-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
        <span class="cmgi-section-title">PCS</span>
        <span class="cmgi-pc-section-count">×${entries.length}</span>
      </button>

      ${collapsed
        ? ""
        : entries.length
          ? `<div class="cmgi-pc-section-body">${entries.map(renderPcRow).join("")}</div>`
          : `<div class="cmgi-empty cmgi-pc-empty">No PC character tokens on this Scene.</div>`}
    </section>`;
}

function renderGroup(group) {
  const actor = group.actor;
  const role = actor?.system?.type ?? actor?.type ?? "adversary";
  const tier = actor?.system?.tier ?? null;

  const selectionClass = group.selected ? " cmgi-selected" : "";
  const expandedClass = group.expanded ? " cmgi-expanded" : "";
  const expanded = group.expanded;

  return `
    <section class="cmgi-card${selectionClass}${expandedClass}" data-group-key="${escapeHtml(group.key)}">
      <button
        type="button"
        class="cmgi-group-toggle"
        data-action="toggle-group"
        data-group-key="${escapeHtml(group.key)}"
        aria-expanded="${expanded ? "true" : "false"}"
        title="${expanded ? "Collapse adversary" : "Expand adversary"}">
        ${renderQolActorThumbnail(actor, "cmgi-adversary-thumbnail")}
        <span class="cmgi-group-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
        <span class="cmgi-adversary-identity">
          <span class="cmgi-actor-name">${escapeHtml(actor?.name ?? "Unknown Adversary")}</span>
          <span class="cmgi-subtitle cmgi-subtitle-inline">
            ${escapeHtml(role)}${tier !== null ? ` · Tier ${escapeHtml(tier)}` : ""}
          </span>
        </span>
        <span class="cmgi-token-count">×${group.tokens.length}</span>
        ${renderGroupCollapsedSummary(group)}
      </button>

      ${expanded ? `
        <div class="cmgi-expanded-content">
          ${renderTokenInstances(group)}
          ${getSelectedTokenForGroup(group)
            ? renderAdversaryCombatStatePanel(getSelectedTokenForGroup(group))
            : ""}
          ${renderFastPlay(actor)}
          ${renderGmActions(actor, group)}
          ${renderDiagnostics(actor)}
        </div>
      ` : ""}
    </section>`;
}

function renderInspectorBody() {
  syncSceneSessionState();
  syncSpotlightSceneState();

  if (!canvas?.ready || !canvas.scene) {
    return `<div class="cmgi-root"><div class="cmgi-empty">No ready canvas scene.</div></div>`;
  }

  const pcs = getScenePcEntries();
  const groups = getSceneGroups();
  const selected = getSelectedToken();
  const totalTokens = groups.reduce((sum, group) => sum + group.tokens.length, 0);

  return `
    <style>
      .cmgi-root {
        width: 100%;
        min-width: 0;
        max-width: none;
        box-sizing: border-box;
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      .cmgi-header {
        margin-bottom: .75rem;
        padding-bottom: .55rem;
        border-bottom: 1px solid rgba(0,0,0,.25);
      }
      .cmgi-header-row {
        display: flex;
        flex-wrap: wrap;
        gap: .35rem .9rem;
        justify-content: space-between;
        align-items: baseline;
      }
      .cmgi-scene-name {
        flex: 1 1 260px;
        min-width: 0;
      }
      .cmgi-scene-count {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .cmgi-muted { opacity: .65; }

      .cmgi-fear {
        margin-bottom: .75rem;
        padding: .55rem .65rem;
        border: 1px solid rgba(0,0,0,.25);
        border-radius: 6px;
      }
      .cmgi-fear-readout {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .45rem;
      }
      .cmgi-fear-label {
        font-weight: 800;
        letter-spacing: .06em;
      }
      .cmgi-fear-value {
        font-size: 1.15rem;
        font-weight: 800;
      }
      .cmgi-fear-dots {
        display: inline-flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: .22rem;
      }
      .cmgi-fear-dot {
        display: inline-flex;
        width: .92rem;
        height: .92rem;
        min-width: .92rem;
        min-height: .92rem;
        padding: 0;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,.35);
        box-sizing: border-box;
      }
      .cmgi-fear-dot-filled {
        background: rgba(58, 122, 82, .92);
        border-color: rgba(38, 92, 59, .95);
        cursor: pointer;
      }
      .cmgi-fear-dot-filled:hover {
        outline: 2px solid rgba(58, 122, 82, .45);
        outline-offset: 1px;
      }
      .cmgi-fear-dot-filled:disabled {
        opacity: 1;
      }
      .cmgi-fear-dot-empty {
        background: rgba(255,255,255,.08);
        cursor: pointer;
      }
      .cmgi-fear-dot-empty:hover {
        outline: 2px solid rgba(58, 122, 82, .45);
        outline-offset: 1px;
      }
      .cmgi-fear-dot-disabled,
      .cmgi-fear-dot-disabled:disabled {
        opacity: .22;
        background: transparent;
      }
      .cmgi-fear-unavailable {
        font-weight: 700;
        opacity: .7;
      }
      .cmgi-readonly {
        margin-left: auto;
        font-size: .7rem;
        font-weight: 700;
        letter-spacing: .05em;
        opacity: .55;
      }
      .cmgi-fear-diagnostics {
        margin-top: .35rem;
        font-size: .86em;
      }

      .cmgi-spotlight {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: .45rem .8rem;
        margin-bottom: .75rem;
        padding: .55rem .65rem;
        border: 1px solid rgba(0,0,0,.25);
        border-radius: 6px;
      }
      .cmgi-spotlight-status {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .4rem;
        min-width: 0;
      }
      .cmgi-spotlight-label {
        font-weight: 800;
        letter-spacing: .06em;
      }
      .cmgi-spotlight-owner {
        font-size: 1.05rem;
        font-weight: 800;
      }
      .cmgi-transient {
        font-size: .68rem;
        font-weight: 700;
        letter-spacing: .05em;
        opacity: .5;
      }
      .cmgi-entry-mode {
        padding: .08rem .32rem;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 999px;
        font-size: .68rem;
        font-weight: 800;
        letter-spacing: .04em;
        white-space: nowrap;
      }
      .cmgi-entry-buttons {
        display: inline-flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: .35rem;
      }
      .cmgi-spotlight-main-button {
        width: auto; flex: 0 0 auto; min-height: 1.8rem; padding: .2rem .6rem; font-size: .78rem; font-weight: 800; white-space: nowrap;
      }
      .cmgi-gm-moves { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .3rem; margin-left: auto; }
      .cmgi-gm-move-label { font-size: .72rem; font-weight: 700; letter-spacing: .03em; opacity: .7; }
      .cmgi-gm-move-count { min-width: 1.35rem; text-align: center; font-size: 1rem; font-weight: 900; }
      .cmgi-move-ready { padding: .12rem .38rem; border: 1px solid rgba(55, 142, 147, .45); border-radius: 4px; font-size: .68rem; font-weight: 900; letter-spacing: .025em; white-space: nowrap; }
      .cmgi-gm-move-button, .cmgi-gm-move-undo { width: auto; min-height: 1.7rem; padding: .14rem .42rem; font-size: .74rem; font-weight: 800; }
      .cmgi-gm-move-undo { min-width: 1.8rem; }
      .cmgi-gm-move-undo:disabled, .cmgi-gm-move-button:disabled, .cmgi-spotlight-main-button:disabled { opacity: .35; cursor: default; }
      .cmgi-interrupt-button { font-weight: 900; }
      .cmgi-roll-notice {
        flex: 1 1 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: .4rem .8rem;
        padding: .42rem .5rem;
        border: 1px dashed rgba(0,0,0,.28);
        border-radius: 5px;
      }
      .cmgi-roll-notice-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .3rem .5rem;
        min-width: 0;
      }
      .cmgi-roll-notice-label {
        font-size: .72rem;
        font-weight: 900;
        letter-spacing: .06em;
      }
      .cmgi-roll-notice-text {
        flex-basis: 100%;
        font-size: .72rem;
        opacity: .72;
      }

      .cmgi-group-summary,
      .cmgi-environment-compact,
      .cmgi-compact-state {
        display: inline-flex;
        flex-wrap: wrap;
        gap: .18rem .35rem;
        font-size: .7rem;
        opacity: .72;
      }
      .cmgi-group-summary {
        margin-left: auto;
        justify-content: flex-end;
      }
      .cmgi-compact-defeated { font-weight: 900; opacity: 1; }
      .cmgi-diagnostic-toggle-row {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: flex-end;
        gap: .35rem;
        margin: .75rem 0 .1rem;
        padding-top: .45rem;
        border-top: 1px solid rgba(0,0,0,.16);
      }
      .cmgi-diagnostic-toggle,
      .cmgi-reset-state {
        width: auto;
        flex: 0 0 auto;
        min-height: 2rem;
        padding: .2rem .55rem;
        font-size: .68rem;
        font-weight: 850;
        line-height: 1;
        letter-spacing: .045em;
      }
      .cmgi-runtime-diagnostics {
        margin: .4rem 0 .65rem;
        padding: .5rem .6rem;
        border: 1px dashed rgba(0,0,0,.28);
        border-radius: 6px;
      }
      .cmgi-runtime-diagnostic-grid {
        display: grid;
        grid-template-columns: minmax(100px, auto) minmax(0, 1fr);
        gap: .22rem .7rem;
        align-items: baseline;
        font-size: .72rem;
      }
      .cmgi-runtime-diagnostic-grid > span,
      .cmgi-runtime-diagnostic-row > span { font-weight: 750; opacity: .72; }
      .cmgi-runtime-diagnostic-subtitle {
        margin: .55rem 0 .28rem;
        padding-top: .4rem;
        border-top: 1px solid rgba(0,0,0,.15);
        font-size: .68rem;
        font-weight: 900;
        letter-spacing: .055em;
      }
      .cmgi-runtime-interface-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: .18rem .7rem;
      }
      .cmgi-runtime-diagnostic-row {
        display: flex;
        justify-content: space-between;
        gap: .4rem;
        font-size: .7rem;
      }
      .cmgi-runtime-integrity { font-size: .72rem; }
      .cmgi-runtime-ok { font-weight: 800; }
      .cmgi-runtime-review { font-weight: 900; text-decoration: underline dotted; }
      .cmgi-runtime-issues { margin-top: .35rem; font-size: .72rem; }
      .cmgi-runtime-issues ul { margin-bottom: 0; padding-left: 1.2rem; }
      .cmgi-compatibility-counts {
        display: flex;
        flex-wrap: wrap;
        gap: .3rem .6rem;
        font-size: .7rem;
        font-weight: 800;
      }
      .cmgi-compatibility-diagnostic {
        display: flex;
        flex-wrap: wrap;
        gap: .18rem .4rem;
        font-size: .68rem;
      }
      .cmgi-compatibility-diagnostic {
        flex-basis: 100%;
        margin-top: .25rem;
        padding-top: .2rem;
        border-top: 1px dotted rgba(0,0,0,.18);
        opacity: .75;
      }
      .cmgi-compatibility-diagnostic code {
        flex-basis: 100%;
        overflow-wrap: anywhere;
      }

      .cmgi-combat-state-compact {
        margin: .3rem 0 .45rem;
        padding: .3rem .4rem;
      }
      .cmgi-state-compact-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .25rem .48rem;
      }
      .cmgi-state-compact-item {
        display: inline-flex;
        align-items: baseline;
        gap: .22rem;
        white-space: nowrap;
      }
      .cmgi-state-compact-item .cmgi-state-label { min-width: 0; }
      .cmgi-state-diagnostic {
        flex-wrap: wrap;
        white-space: normal;
      }
      .cmgi-state-diagnostic .cmgi-muted {
        flex-basis: 100%;
        font-size: .68rem;
      }
      .cmgi-state-flag {
        font-size: .64rem;
        font-weight: 900;
        opacity: .72;
      }
      .cmgi-thresholds { margin-left: 0; }

      .cmgi-combat-state {
        margin: .55rem 0 .65rem;
        padding: .55rem .6rem;
        border: 1px solid rgba(0,0,0,.22);
        border-radius: 6px;
      }
      .cmgi-combat-state.cmgi-defeated {
        border-style: double;
      }
      .cmgi-defeated-badge {
        display: inline-block;
        margin-left: .45rem;
        padding: .08rem .35rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .68rem;
        font-weight: 900;
        letter-spacing: .055em;
      }
      .cmgi-state-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: .25rem .65rem;
        margin-top: .35rem;
      }
      .cmgi-state-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .25rem .4rem;
        min-width: 0;
      }
      .cmgi-state-label {
        min-width: 6.5rem;
        font-size: .7rem;
        font-weight: 850;
        letter-spacing: .045em;
      }
      .cmgi-state-critical,
      .cmgi-state-warning {
        font-weight: 800;
      }
      .cmgi-state-advisory {
        display: flex;
        flex-wrap: wrap;
        gap: .25rem .5rem;
        margin-top: .45rem;
        padding: .35rem .45rem;
        border: 1px dashed currentColor;
        border-radius: 5px;
        font-size: .78rem;
      }
      .cmgi-condition-section {
        margin-top: .55rem;
      }
      .cmgi-condition-heading {
        margin: 0 0 .3rem;
        min-width: 0;
      }
      .cmgi-effect-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: .5rem;
        padding: .3rem 0;
        border-top: 1px solid rgba(0,0,0,.12);
      }
      .cmgi-effect-main {
        display: flex;
        flex-wrap: wrap;
        gap: .18rem .45rem;
        min-width: 0;
      }
      .cmgi-effect-source,
      .cmgi-effect-statuses,
      .cmgi-effect-context {
        flex-basis: 100%;
        font-size: .72rem;
        opacity: .68;
      }
      .cmgi-state-resource-button {
        display: inline-flex;
        width: auto;
        min-width: 0;
        min-height: 1.55rem;
        align-items: baseline;
        gap: .26rem;
        padding: .08rem .3rem;
        border: 1px solid rgba(0,0,0,.22);
        border-radius: 5px;
        background: rgba(255,255,255,.035);
        font: inherit;
        font-weight: 900;
        line-height: 1.1;
        cursor: pointer;
        box-shadow: inset 0 -1px 0 rgba(0,0,0,.08);
      }
      .cmgi-state-resource-button .cmgi-state-label {
        min-width: 0;
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }
      .cmgi-state-resource-button:hover {
        border-color: rgba(55,142,147,.72);
        background: rgba(55,142,147,.08);
        outline: 1px solid rgba(55,142,147,.26);
      }
      .cmgi-state-resource-button:disabled {
        opacity: .55;
        cursor: default;
      }
      .cmgi-condition-inline {
        display: inline-flex;
        flex: 0 1 auto;
        margin-left: auto;
        min-width: 0;
      }
      .cmgi-qol-condition-controls {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: .22rem;
        margin: 0;
      }
      .cmgi-condition-toggle {
        display: inline-flex;
        width: auto;
        min-height: 1.55rem;
        align-items: center;
        gap: .28rem;
        padding: .08rem .32rem;
        border-radius: 5px;
        font-size: .66rem;
        font-weight: 800;
        white-space: nowrap;
      }
      .cmgi-condition-toggle strong {
        font-size: .62rem;
        letter-spacing: .035em;
      }
      .cmgi-condition-toggle-on {
        outline: 2px solid rgba(55, 142, 147, .58);
        background: rgba(55, 142, 147, .12);
      }
      .cmgi-condition-toggle-off {
        opacity: .68;
        background: transparent;
      }
      .cmgi-condition-toggle-off:hover {
        opacity: 1;
      }
      .cmgi-other-effects {
        margin-top: .22rem;
      }

      .cmgi-condition-button {
        flex: 0 0 auto;
        font-size: .7rem;
        font-weight: 800;
      }
      .cmgi-effect-reference {
        flex: 0 0 auto;
        font-size: .68rem;
        font-weight: 800;
        opacity: .55;
      }

      .cmgi-reaction-use {
        font-weight: 900;
        letter-spacing: .025em;
        border-style: dashed;
      }

      .cmgi-opportunity {
        flex: 1 1 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: .4rem .8rem;
        padding-top: .4rem;
        border-top: 1px dashed rgba(0,0,0,.28);
      }
      .cmgi-opportunity-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .3rem .5rem;
        min-width: 0;
      }
      .cmgi-opportunity-label {
        font-size: .7rem;
        font-weight: 900;
        letter-spacing: .055em;
      }
      .cmgi-opportunity-weight,
      .cmgi-opportunity-count {
        font-size: .68rem;
        font-weight: 800;
        opacity: .65;
      }
      .cmgi-opportunity-dismiss {
        width: auto;
        min-height: 1.8rem;
        padding: .2rem .5rem;
        font-size: .72rem;
        font-weight: 800;
      }
      .cmgi-opportunity-dismiss:disabled {
        opacity: .35;
        cursor: default;
      }

      .cmgi-environments {
        margin-bottom: .8rem;
      }
      .cmgi-environment-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: .35rem .7rem;
        margin-bottom: .4rem;
        padding-bottom: .3rem;
        border-bottom: 1px solid rgba(0,0,0,.2);
      }
      .cmgi-environment-heading {
        margin-right: .45rem;
        font-size: .78rem;
        font-weight: 900;
        letter-spacing: .065em;
      }
      .cmgi-environment-card {
        margin: .45rem 0;
        padding: .55rem .65rem;
        border: 1px solid rgba(0,0,0,.24);
        border-radius: 6px;
        background: rgba(255,255,255,.025);
      }
      .cmgi-environment-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .35rem .55rem;
      }
      .cmgi-environment-toggle {
        position: relative;
        flex: 1 1 260px;
        width: auto;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: .35rem;
        padding: .1rem 0 .1rem 2.15rem;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .cmgi-environment-toggle .cmgi-group-chevron {
        flex: 0 0 1rem;
      }
      .cmgi-environment-identity {
        display: inline-flex;
        flex: 1 1 220px;
        align-items: baseline;
        gap: .4rem;
        min-width: 0;
      }
      .cmgi-environment-name {
        font-size: 1rem;
        overflow-wrap: anywhere;
      }
      .cmgi-environment-tier,
      .cmgi-environment-source,
      .cmgi-environment-readonly {
        font-size: .66rem;
        font-weight: 800;
        letter-spacing: .035em;
        opacity: .68;
        white-space: nowrap;
      }
      .cmgi-environment-source,
      .cmgi-environment-readonly {
        padding: .08rem .28rem;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 999px;
      }
      .cmgi-environment-control {
        width: auto;
        min-height: 1.55rem;
        padding: .12rem .38rem;
        font-size: .7rem;
        font-weight: 800;
      }
      .cmgi-environment-empty,
      .cmgi-environment-issue {
        padding: .35rem .15rem;
      }
      .cmgi-environment-unresolved {
        border-style: dashed;
      }
      .cmgi-environment-action-shell {
        align-items: center;
      }
      .cmgi-environment-readonly {
        flex: 0 0 auto;
        margin: .3rem .1rem .3rem 0;
      }

      .cmgi-last-action {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .35rem .55rem;
        margin: -.35rem 0 .75rem;
        padding: .35rem .55rem;
        border-left: 3px solid rgba(55, 142, 147, .65);
        font-size: .82rem;
      }
      .cmgi-last-action-label {
        font-size: .68rem;
        font-weight: 800;
        letter-spacing: .05em;
        opacity: .58;
      }
      .cmgi-last-action-status {
        font-size: .65rem;
        font-weight: 800;
        letter-spacing: .04em;
        opacity: .55;
      }
      .cmgi-grant-count {
        font-size: .68rem;
        font-weight: 900;
        letter-spacing: .04em;
        opacity: .72;
      }
      .cmgi-grant-list {
        display: inline-flex;
        flex-wrap: wrap;
        gap: .25rem;
      }
      .cmgi-grant-available {
        width: auto;
        min-height: 1.25rem;
        padding: .02rem .25rem;
        border: 1px solid rgba(0,0,0,.2);
        border-radius: 999px;
        background: transparent;
        font-size: .64rem;
        font-weight: 900;
        cursor: pointer;
      }

      .cmgi-grant-chip {
        display: inline-flex;
        align-items: center;
        gap: .18rem;
        padding: .08rem .26rem;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 999px;
        font-size: .7rem;
      }
      .cmgi-grant-remove {
        width: auto;
        min-width: 1.15rem;
        min-height: 1.15rem;
        padding: 0 .18rem;
        font-size: .68rem;
        line-height: 1;
      }
      .cmgi-grant-mode-button {
        width: auto;
        min-height: 1.5rem;
        padding: .12rem .38rem;
        font-size: .7rem;
        font-weight: 900;
      }
      .cmgi-grant-mode-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .3rem .55rem;
        margin: -.45rem 0 .75rem;
        padding: .35rem .55rem;
        border: 1px dashed rgba(0,0,0,.3);
        border-radius: 5px;
        font-size: .78rem;
      }

      .cmgi-pc-section {
        margin: .55rem 0 .75rem;
      }
      .cmgi-pc-section-toggle {
        display: flex;
        width: 100%;
        min-width: 0;
        align-items: center;
        justify-content: flex-start;
        gap: .35rem;
        padding: .12rem .2rem;
        border: 0;
        border-bottom: 1px solid rgba(0,0,0,.16);
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .cmgi-pc-section-toggle .cmgi-section-title {
        flex: 0 0 auto;
        margin: .18rem 0;
      }
      .cmgi-pc-section-count {
        flex: 0 0 auto;
        margin-left: .15rem;
        font-size: .7rem;
        font-weight: 800;
        opacity: .6;
      }
      .cmgi-pc-section-body {
        min-width: 0;
      }
      .cmgi-pc-section-collapsed {
        margin-bottom: .45rem;
      }
      .cmgi-pc-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .22rem .38rem;
        min-width: 0;
        margin: .25rem 0;
        padding: .18rem .28rem;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 6px;
        box-sizing: border-box;
      }
      .cmgi-pc-thumbnail {
        flex: 0 0 1.7rem;
        width: 1.7rem;
        height: 1.7rem;
        object-fit: cover;
        object-position: center;
        border: 1px solid rgba(0,0,0,.25);
        border-radius: 4px;
        box-sizing: border-box;
      }
      .cmgi-pc-thumbnail-empty {
        background: rgba(0,0,0,.06);
      }
      .cmgi-pc-name {
        flex: 0 1 125px;
        min-width: 70px;
        overflow-wrap: anywhere;
        text-align: left;
      }
      .cmgi-pc-resource-button,
      .cmgi-pc-readonly {
        flex: 0 0 auto;
      }
      .cmgi-pc-conditions {
        display: inline-flex;
        flex: 0 1 auto;
        margin-left: auto;
        min-width: 0;
      }
      .cmgi-pc-conditions .cmgi-qol-condition-controls {
        flex-wrap: nowrap;
      }
      .cmgi-pc-empty {
        margin-top: .2rem;
      }

      .cmgi-card {
        box-sizing: border-box;
        padding: .65rem .7rem;
        margin: .55rem 0;
        border: 1px solid rgba(0,0,0,.25);
        border-radius: 6px;
        background: rgba(255,255,255,.04);
        min-width: 0;
      }
      .cmgi-card.cmgi-selected {
        outline: 2px solid rgba(55, 142, 147, .8);
        outline-offset: 1px;
      }
      .cmgi-group-toggle {
        position: relative;
        width: 100%;
        max-width: 100%;
        display: flex;
        align-items: center;
        gap: .4rem .55rem;
        border: 0;
        padding: .12rem 0 .12rem 2.15rem;
        background: transparent;
        text-align: left;
        cursor: pointer;
        min-width: 0;
      }
      .cmgi-header-thumbnail {
        position: absolute;
        left: 0;
        top: 50%;
        width: 1.7rem;
        height: 1.7rem;
        min-width: 1.7rem;
        min-height: 1.7rem;
        transform: translateY(-50%);
        object-fit: cover;
        object-position: center;
        border: 1px solid rgba(0,0,0,.25);
        border-radius: 4px;
        box-sizing: border-box;
        pointer-events: none;
      }
      .cmgi-group-chevron {
        flex: 0 0 1rem;
        width: 1rem;
        text-align: center;
        opacity: .72;
      }
      .cmgi-adversary-identity {
        display: inline-flex;
        flex: 1 1 260px;
        min-width: 0;
        flex-wrap: wrap;
        align-items: baseline;
        gap: .16rem .4rem;
      }
      .cmgi-actor-name {
        flex: 0 1 auto;
        min-width: 0;
        font-size: 1.08rem;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .cmgi-token-count {
        flex: 0 0 auto;
        font-weight: 700;
        opacity: .75;
        white-space: nowrap;
      }
      .cmgi-expanded-content {
        margin-top: .35rem;
      }
      .cmgi-token-instances {
        display: grid;
        grid-template-columns: minmax(72px, 108px) minmax(0, 1fr);
        gap: .5rem;
        align-items: start;
        margin: .3rem 0 .45rem;
      }
      .cmgi-token-label {
        text-align: right;
      }
      .cmgi-token-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: .35rem .45rem;
        min-width: 0;
      }
      .cmgi-token-instance-row {
        display: inline-flex;
        align-items: stretch;
        gap: .18rem;
        min-width: 0;
      }
      .cmgi-token-instance {
        width: auto;
        flex: 0 1 auto;
        min-height: 1.65rem;
        padding: .12rem .42rem;
        border: 1px solid rgba(0,0,0,.24);
        border-radius: 999px;
        background: rgba(255,255,255,.04);
        font-size: .78rem;
        line-height: 1.25;
        cursor: pointer;
      }
      .cmgi-token-instance.cmgi-token-selected {
        font-weight: 800;
        outline: 2px solid rgba(55, 142, 147, .8);
        outline-offset: 1px;
      }
      .cmgi-token-spotlight, .cmgi-token-undo, .cmgi-token-grant { width: auto; flex: 0 0 auto; min-height: 1.65rem; padding: .08rem .3rem; border: 1px solid rgba(0,0,0,.24); border-radius: 5px; font-size: .76rem; line-height: 1.2; cursor: pointer; }
      .cmgi-token-grant { font-weight: 900; white-space: nowrap; }
      .cmgi-token-grant.cmgi-limit-over { text-decoration: underline dotted; }
      .cmgi-token-spotlight { display: inline-flex; align-items: center; justify-content: center; gap: .2rem; min-width: 4.7rem; font-weight: 700; }
      .cmgi-token-spotlight.cmgi-spotlight-used { font-weight: 900; outline: 1px solid rgba(55, 142, 147, .55); }
      .cmgi-token-total { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: .22rem; min-width: 4.4rem; min-height: 1.65rem; padding: .08rem .34rem; border: 1px solid rgba(0,0,0,.16); border-radius: 5px; font-size: .76rem; line-height: 1.2; white-space: nowrap; }
      .cmgi-token-counter-label { font-size: .64rem; font-weight: 700; letter-spacing: .03em; opacity: .58; }
      .cmgi-token-undo { min-width: 1.8rem; opacity: .78; }
      .cmgi-token-spotlight:disabled, .cmgi-token-undo:disabled, .cmgi-token-grant:disabled, .cmgi-grant-mode-button:disabled, .cmgi-grant-remove:disabled { cursor: default; opacity: .35; }
      .cmgi-subtitle {
        margin-top: .15rem;
        margin-bottom: .5rem;
        opacity: .68;
        text-transform: capitalize;
      }
      .cmgi-subtitle-inline {
        flex: 0 0 auto;
        margin: 0;
        min-width: 0;
        white-space: normal;
      }
      .cmgi-token-limit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 7.2rem;
        padding: .1rem .28rem;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 4px;
        font-size: .68rem;
        font-weight: 800;
        letter-spacing: .02em;
        opacity: .76;
        white-space: nowrap;
      }
      .cmgi-token-limit.cmgi-limit-reached {
        font-weight: 900;
        opacity: .9;
      }
      .cmgi-token-limit.cmgi-limit-over {
        font-weight: 900;
        opacity: 1;
        text-decoration: underline dotted;
      }

      .cmgi-token-linked {
        display: inline-flex;
        align-items: center;
        gap: .22rem;
        min-width: 4.5rem;
        justify-content: center;
        opacity: .78;
        font-size: .72rem;
      }
      .cmgi-token-linked.cmgi-integrity-warning {
        font-weight: 900;
        text-decoration: underline dotted;
      }
      .cmgi-spotlight-metrics {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: stretch;
        gap: .14rem;
        white-space: nowrap;
      }
      .cmgi-spotlight-metrics .cmgi-token-spotlight {
        min-width: 0;
        min-height: 1.65rem;
        padding: .08rem .3rem;
      }
      .cmgi-spotlight-metrics .cmgi-token-linked,
      .cmgi-spotlight-metrics .cmgi-token-total {
        min-width: 0;
        min-height: 1.65rem;
        padding: .08rem .28rem;
        border: 1px solid rgba(0,0,0,.16);
        border-radius: 5px;
        font-size: .7rem;
      }
      .cmgi-token-spotlight.cmgi-limit-reached {
        font-weight: 900;
        outline: 1px solid rgba(55, 142, 147, .55);
      }
      .cmgi-token-spotlight.cmgi-limit-over {
        font-weight: 900;
        text-decoration: underline dotted;
      }
      .cmgi-section-title {
        margin: .55rem 0 .35rem;
        font-size: .82rem;
        font-weight: 800;
        letter-spacing: .06em;
      }

      .cmgi-fastplay-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: .3rem;
        padding: .08rem 0;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .cmgi-fastplay-toggle .cmgi-section-title { margin: .25rem 0; }
      .cmgi-fastplay-content { min-width: 0; }

      .cmgi-fastplay {
        margin-top: .35rem;
        min-width: 0;
      }
      .cmgi-fastplay-row {
        display: grid;
        grid-template-columns: minmax(72px, 108px) minmax(0, 1fr);
        gap: .5rem;
        margin: .24rem 0;
        align-items: start;
      }
      .cmgi-fastplay-label { text-align: right; }
      .cmgi-fastplay-text {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .cmgi-goal {
        margin-top: .4rem;
        padding-top: .35rem;
        border-top: 1px solid rgba(0,0,0,.16);
      }

      .cmgi-section-title-with-info {
        display: flex;
        align-items: center;
        gap: .35rem;
      }
      .cmgi-info-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1rem;
        height: 1rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .7rem;
        line-height: 1;
        cursor: help;
        opacity: .65;
      }
      .cmgi-info-icon:hover,
      .cmgi-info-icon:focus { opacity: 1; }

      .cmgi-actions {
        margin-top: .55rem;
        padding-top: .15rem;
      }
      .cmgi-action-note {
        margin-bottom: .35rem;
        font-size: .82rem;
      }
      .cmgi-action-shell {
        display: flex;
        align-items: flex-start;
        gap: .4rem;
        border-top: 1px solid rgba(0,0,0,.12);
      }
      .cmgi-action-shell:last-child {
        border-bottom: 1px solid rgba(0,0,0,.12);
      }
      .cmgi-action-entry {
        flex: 1 1 auto;
        min-width: 0;
        margin: .22rem 0;
        border: 0;
      }
      .cmgi-action-entry > summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .3rem .5rem;
        padding: .38rem .15rem;
        cursor: pointer;
        list-style-position: inside;
      }
      .cmgi-action-name {
        flex: 1 1 220px;
        min-width: 0;
        font-weight: 700;
      }
      .cmgi-action-badges {
        display: inline-flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: .22rem;
      }
      .cmgi-action-badge {
        display: inline-block;
        padding: .08rem .32rem;
        border: 1px solid rgba(0,0,0,.22);
        border-radius: 999px;
        font-size: .72rem;
        line-height: 1.25;
        white-space: nowrap;
      }
      .cmgi-kind { font-weight: 700; }
      .cmgi-range { opacity: .78; }
      .cmgi-cost-fear { font-weight: 700; }
      .cmgi-fear-available { outline: 1px solid rgba(50,120,90,.35); }
      .cmgi-fear-insufficient { text-decoration: line-through; opacity: .62; }
      .cmgi-fear-unknown { opacity: .68; }
      .cmgi-cost-stress, .cmgi-cost-other { opacity: .82; }
      .cmgi-fastplay-ref {
        font-weight: 700;
        opacity: .78;
      }
      .cmgi-explicit-badge {
        font-weight: 700;
        color: #277b7f;
      }
      .cmgi-action-control {
        flex: 0 0 auto;
        padding-top: .28rem;
      }
      .cmgi-action-use {
        width: auto;
        min-width: 4.9rem;
        min-height: 1.6rem;
        padding: .1rem .38rem;
        font-size: .7rem;
        font-weight: 800;
        white-space: nowrap;
      }
      .cmgi-action-use:disabled {
        opacity: .42;
        cursor: default;
      }
      .cmgi-action-manual {
        display: inline-block;
        min-width: 4.9rem;
        padding: .2rem .32rem;
        text-align: center;
        font-size: .66rem;
        font-weight: 800;
        letter-spacing: .03em;
        opacity: .5;
      }
      .cmgi-action-details {
        margin: .1rem .4rem .55rem 1.15rem;
        padding: .45rem .55rem;
        border-left: 2px solid rgba(0,0,0,.18);
      }
      .cmgi-action-details p:first-child { margin-top: 0; }
      .cmgi-action-details p:last-child { margin-bottom: 0; }
      .cmgi-feature-description ul,
      .cmgi-feature-description ol {
        margin-top: .25rem;
        margin-bottom: .25rem;
      }
      .cmgi-inline-meta {
        margin-top: .45rem;
        font-size: .82rem;
        opacity: .75;
      }
      .cmgi-inline-meta code {
        display: block;
        margin-top: .2rem;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .cmgi-diagnostics {
        margin-top: .55rem;
      }
      .cmgi-fear-diagnostics summary,
      .cmgi-diagnostics summary,
      .cmgi-inline-meta summary {
        cursor: pointer;
        opacity: .7;
      }
      .cmgi-diagnostics ul {
        margin-bottom: 0;
        padding-left: 1.4rem;
      }
      .cmgi-diagnostics li { margin: .35rem 0; }
      .cmgi-explicit { color: #277b7f; }
      .cmgi-empty {
        padding: 1rem 0;
        opacity: .7;
      }
      .cmgi-recovery {
        margin-top: .8rem;
        padding-top: .45rem;
        border-top: 1px solid rgba(0,0,0,.16);
        font-size: .86rem;
      }
      .cmgi-recovery > summary {
        cursor: pointer;
        opacity: .65;
      }
      .cmgi-recovery-body {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .5rem .8rem;
        padding: .45rem .2rem .15rem;
      }
      .cmgi-recovery-body > div {
        flex: 1 1 320px;
        min-width: 0;
      }
      .cmgi-reset-state {
        width: auto;
        flex: 0 0 auto;
      }

      @media (max-width: 540px) {
        .cmgi-fastplay-row {
          grid-template-columns: 1fr;
          gap: .08rem;
        }
        .cmgi-fastplay-label { text-align: left; }
        .cmgi-token-instances {
          grid-template-columns: 1fr;
          gap: .12rem;
        }
        .cmgi-token-label { text-align: left; }
        .cmgi-readonly { margin-left: 0; }
        .cmgi-action-badges {
          flex-basis: 100%;
          justify-content: flex-start;
          padding-left: .9rem;
        }
        .cmgi-action-shell {
          flex-wrap: wrap;
        }
        .cmgi-action-control {
          flex-basis: 100%;
          padding: 0 0 .3rem 1rem;
        }
      }
    </style>

    <div class="cmgi-root">
      ${renderFearHeader()}
      ${renderSpotlightHeader()}
      ${renderLastActionSummary()}

      <div class="cmgi-header">
        <div class="cmgi-header-row">
          <strong class="cmgi-scene-name">${escapeHtml(canvas.scene.name)}</strong>
          <span class="cmgi-scene-count">${pcs.length} PC(s) · ${totalTokens} adversary token(s)</span>
        </div>
        <div class="cmgi-muted">
          Selected token: ${escapeHtml(selected?.name ?? "none")}
        </div>
      </div>

      ${renderPcSection(pcs)}

      <section class="cmgi-adversary-section">
        <div class="cmgi-section-title">ADVERSARIES</div>
        ${groups.map(renderGroup).join("") || `
          <div class="cmgi-empty">
            No adversary tokens found in the current scene.
          </div>`}
      </section>

      ${renderEnvironmentSectionSafe()}

      ${renderRuntimeDiagnostics()}

      <div class="cmgi-diagnostic-toggle-row">
        <button type="button"
                class="cmgi-reset-state"
                data-action="reset-combat-state"
                title="Reset only the QOL Scene combat-state snapshot. Native Daggerheart Fear is not changed or refunded.">
          RESET QOL COMBAT STATE
        </button>

        <button type="button"
                class="cmgi-diagnostic-toggle"
                data-action="toggle-diagnostics"
                title="Show/hide compatibility provenance, native resource diagnostics, and Actor diagnostics. Presentation only.">
          ${inspectorDiagnosticsVisible ? "HIDE DIAGNOSTICS" : "SHOW DIAGNOSTICS"}
        </button>
      </div>
    </div>`;
}

// ===== 80-window.js =====
/* -------------------------------------------- */
/*  Window Interaction                          */
/* -------------------------------------------- */

function getInspectorRootElement() {
  return document.querySelector(
    '.dialog-app .window-content .cmgi-root, .app.dialog .window-content .cmgi-root'
  );
}

function captureOpenDetails(root) {
  const open = new Set();
  if (!root) return open;

  for (const details of root.querySelectorAll("details[open]")) {
    const entry = details.closest(".cmgi-action-entry");
    const card = details.closest(".cmgi-card");
    const actionName = entry?.querySelector(".cmgi-action-name")?.textContent ?? "";
    const groupKey = card?.dataset?.groupKey ?? "";
    const summary = details.querySelector(":scope > summary")?.textContent ?? "";

    open.add(`${groupKey}|${actionName}|${summary}`);
  }

  return open;
}

function restoreOpenDetails(root, openKeys) {
  if (!root || !openKeys?.size) return;

  for (const details of root.querySelectorAll("details")) {
    const entry = details.closest(".cmgi-action-entry");
    const card = details.closest(".cmgi-card");
    const actionName = entry?.querySelector(".cmgi-action-name")?.textContent ?? "";
    const groupKey = card?.dataset?.groupKey ?? "";
    const summary = details.querySelector(":scope > summary")?.textContent ?? "";
    const key = `${groupKey}|${actionName}|${summary}`;

    if (openKeys.has(key)) details.open = true;
  }
}

function installInspectorClickHandler(rootOrHtml) {
  const root = rootOrHtml?.matches?.(".cmgi-root")
    ? rootOrHtml
    : rootOrHtml?.[0]?.querySelector?.(".cmgi-root")
      ?? rootOrHtml?.querySelector?.(".cmgi-root")
      ?? null;

  if (!root || root.dataset.cmgiBound === "true") return;
  root.dataset.cmgiBound = "true";

  root.addEventListener("click", event => {
    const fearGainButton =
      event.target.closest('[data-action="gain-qol-fear"]');

    if (fearGainButton) {
      event.preventDefault();
      gainQolFear();
      return;
    }

    const fearSpendButton =
      event.target.closest('[data-action="spend-qol-fear"]');

    if (fearSpendButton) {
      event.preventDefault();
      spendQolFear();
      return;
    }

    const nativeResourceButton =
      event.target.closest('[data-action="adjust-qol-resource"]');

    if (nativeResourceButton) {
      event.preventDefault();

      const tokenId = nativeResourceButton.dataset.tokenId;
      const resource = nativeResourceButton.dataset.resource;
      const scope = nativeResourceButton.dataset.qolScope ?? "adversary";

      if (tokenId && resource === "hp") {
        if (scope === "pc") adjustPcHp(tokenId, -1);
        else adjustAdversaryHp(tokenId, -1);
      } else if (tokenId && resource === "stress") {
        if (scope === "pc") adjustPcStress(tokenId, -1);
        else adjustAdversaryStress(tokenId, -1);
      }
      return;
    }

    const conditionToggleButton =
      event.target.closest('[data-action="toggle-qol-condition"]');

    if (conditionToggleButton) {
      event.preventDefault();

      const tokenId = conditionToggleButton.dataset.tokenId;
      const conditionId = conditionToggleButton.dataset.conditionId;
      const scope = conditionToggleButton.dataset.qolScope ?? "adversary";

      if (tokenId && conditionId) {
        if (scope === "pc") togglePcCondition(tokenId, conditionId);
        else toggleAdversaryCondition(tokenId, conditionId);
      }
      return;
    }

    const pcSectionButton =
      event.target.closest('[data-action="toggle-pc-section"]');

    if (pcSectionButton) {
      event.preventDefault();
      togglePcSectionCollapsed();
      refreshInspector();
      return;
    }

    const fastPlayButton =
      event.target.closest('[data-action="toggle-fastplay"]');

    if (fastPlayButton) {
      event.preventDefault();
      const actorKey = fastPlayButton.dataset.actorKey;
      if (actorKey) {
        toggleFastPlayCollapsed(actorKey);
        refreshInspector();
      }
      return;
    }

    const diagnosticsButton =
      event.target.closest('[data-action="toggle-diagnostics"]');

    if (diagnosticsButton) {
      event.preventDefault();
      toggleInspectorDiagnostics();
      return;
    }

    const toggleEnvironmentButton = event.target.closest('[data-action="toggle-environment"]');
    if (toggleEnvironmentButton) {
      event.preventDefault();
      const uuid = toggleEnvironmentButton.dataset.environmentUuid;
      if (uuid) {
        toggleEnvironmentExpanded(uuid);
        refreshInspector();
      }
      return;
    }

    const showLinkEnvironmentButton = event.target.closest('[data-action="show-link-environment"]');
    if (showLinkEnvironmentButton) {
      event.preventDefault();
      showLinkEnvironmentDialog();
      return;
    }

    const linkEnvironmentButton = event.target.closest('[data-action="link-environment"]');
    if (linkEnvironmentButton) {
      event.preventDefault();
      const uuid = linkEnvironmentButton.dataset.environmentUuid;
      linkEnvironmentUuid(uuid);
      return;
    }

    const unlinkEnvironmentButton = event.target.closest('[data-action="unlink-environment"]');
    if (unlinkEnvironmentButton) {
      event.preventDefault();
      const uuid = unlinkEnvironmentButton.dataset.environmentUuid;
      unlinkEnvironmentUuid(uuid);
      return;
    }

    const groupButton = event.target.closest('[data-action="toggle-group"]');
    if (groupButton) {
      event.preventDefault();

      const groupKey = groupButton.dataset.groupKey;
      if (!groupKey) return;

      if (expandedGroups.has(groupKey)) expandedGroups.delete(groupKey);
      else expandedGroups.add(groupKey);

      refreshInspector();
      return;
    }

    const dismissRollNoticeButton = event.target.closest('[data-action="dismiss-roll-notice"]');
    if (dismissRollNoticeButton) {
      event.preventDefault();
      dismissPendingRollNotice();
      return;
    }

    const dismissOpportunityButton = event.target.closest('[data-action="dismiss-opportunity"]');
    if (dismissOpportunityButton) {
      event.preventDefault();
      dismissPendingOpportunity().then(changed => {
        if (changed) refreshInspector();
      });
      return;
    }

    const naturalButton = event.target.closest('[data-action="take-natural-spotlight"]');
    if (naturalButton) {
      event.preventDefault();
      takeNaturalGmSpotlight().then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const interruptButton = event.target.closest('[data-action="take-interrupt-spotlight"]');
    if (interruptButton) {
      event.preventDefault();
      takeInterruptGmSpotlight().then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const moveButton = event.target.closest('[data-action="record-gm-move"]');
    if (moveButton) {
      event.preventDefault();
      recordGmMove().then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const completeManualMoveButton = event.target.closest('[data-action="complete-manual-gm-move"]');
    if (completeManualMoveButton) {
      event.preventDefault();
      completePreparedGmMoveManually().then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const undoMoveButton = event.target.closest('[data-action="undo-gm-move"]');
    if (undoMoveButton) {
      event.preventDefault();
      undoGmMove().then(changed => { if (changed) refreshInspector(); });
      return;
    }
    const endButton = event.target.closest('[data-action="end-gm-turn"]');
    if (endButton) {
      event.preventDefault();
      endGmTurn().then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const recordButton = event.target.closest('[data-action="record-spotlight"]');
    if (recordButton) {
      event.preventDefault();

      const tokenKey = recordButton.dataset.tokenKey;
      recordSpotlightUse(tokenKey).then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const undoButton = event.target.closest('[data-action="undo-spotlight"]');
    if (undoButton) {
      event.preventDefault();

      const tokenKey = undoButton.dataset.tokenKey;
      undoSpotlightUse(tokenKey).then(changed => { if (changed) refreshInspector(); });
      return;
    }

    const startGrantButton = event.target.closest('[data-action="start-grant-mode"]');
    if (startGrantButton) {
      event.preventDefault();
      if (startGrantSpotlightMode()) refreshInspector();
      return;
    }

    const stopGrantButton = event.target.closest('[data-action="stop-grant-mode"]');
    if (stopGrantButton) {
      event.preventDefault();
      if (stopGrantSpotlightMode()) refreshInspector();
      return;
    }

    const grantButton = event.target.closest('[data-action="grant-spotlight"]');
    if (grantButton) {
      event.preventDefault();
      const tokenId = grantButton.dataset.tokenId;
      grantSpotlightToToken(tokenId).then(changed => {
        if (changed) refreshInspector();
      });
      return;
    }

    const removeGrantButton = event.target.closest('[data-action="remove-granted-spotlight"]');
    if (removeGrantButton) {
      event.preventDefault();
      const ledgerIndex = removeGrantButton.dataset.ledgerIndex;
      const grantIndex = removeGrantButton.dataset.grantIndex;
      removeGrantedSpotlight(ledgerIndex, grantIndex).then(changed => {
        if (changed) refreshInspector();
      });
      return;
    }

    const resetButton = event.target.closest('[data-action="reset-combat-state"]');
    if (resetButton) {
      event.preventDefault();
      confirmResetInspectorCombatState();
      return;
    }

    const removeHiddenButton =
      event.target.closest('[data-action="remove-hidden-condition"]');

    if (removeHiddenButton) {
      event.preventDefault();
      const tokenId = removeHiddenButton.dataset.tokenId;
      const effectId = removeHiddenButton.dataset.effectId;

      if (tokenId && effectId) {
        removeHiddenConditionDirect(tokenId, effectId);
      }
      return;
    }

    const clearConditionButton =
      event.target.closest('[data-action="preview-condition-clear"]');

    if (clearConditionButton) {
      event.preventDefault();
      const tokenId = clearConditionButton.dataset.tokenId;
      const effectId = clearConditionButton.dataset.effectId;

      if (tokenId && effectId) {
        showConditionClearPreview(tokenId, effectId);
      }
      return;
    }

    const undoReactionButton =
      event.target.closest('[data-action="undo-reaction"]');

    if (undoReactionButton) {
      event.preventDefault();
      undoLastReaction();
      return;
    }

    const reactionTransactionButton =
      event.target.closest('[data-action="preview-reaction-transaction"]');

    if (reactionTransactionButton) {
      event.preventDefault();

      const sourceType = reactionTransactionButton.dataset.sourceType;
      const tokenId = reactionTransactionButton.dataset.tokenId ?? null;
      const environmentUuid =
        reactionTransactionButton.dataset.environmentUuid ?? null;
      const entryId = reactionTransactionButton.dataset.entryId;

      if (sourceType && entryId) {
        showReactionTransactionPreview({
          sourceType,
          tokenId,
          environmentUuid,
          entryId
        });
      }
      return;
    }

    const environmentActionTransactionButton =
      event.target.closest('[data-action="preview-environment-action-transaction"]');

    if (environmentActionTransactionButton) {
      event.preventDefault();

      const environmentUuid =
        environmentActionTransactionButton.dataset.environmentUuid;
      const entryId =
        environmentActionTransactionButton.dataset.entryId;

      if (environmentUuid && entryId) {
        showEnvironmentActionTransactionPreview(environmentUuid, entryId);
      }
      return;
    }

    const actionTransactionButton = event.target.closest('[data-action="preview-action-transaction"]');
    if (actionTransactionButton) {
      event.preventDefault();

      const tokenId = actionTransactionButton.dataset.tokenId;
      const entryId = actionTransactionButton.dataset.entryId;

      if (tokenId && entryId) {
        showActionTransactionPreview(tokenId, entryId);
      }
      return;
    }

    const tokenButton = event.target.closest('[data-action="focus-token"]');
    if (tokenButton) {
      event.preventDefault();

      const tokenId = tokenButton.dataset.tokenId;
      if (tokenId) focusToken(tokenId);
    }
  });

  root.addEventListener("contextmenu", event => {
    const nativeResourceButton =
      event.target.closest('[data-action="adjust-qol-resource"]');

    if (!nativeResourceButton) return;

    event.preventDefault();
    event.stopPropagation();

    const tokenId = nativeResourceButton.dataset.tokenId;
    const resource = nativeResourceButton.dataset.resource;
    const scope = nativeResourceButton.dataset.qolScope ?? "adversary";

    if (tokenId && resource === "hp") {
      if (scope === "pc") adjustPcHp(tokenId, 1);
      else adjustAdversaryHp(tokenId, 1);
    } else if (tokenId && resource === "stress") {
      if (scope === "pc") adjustPcStress(tokenId, 1);
      else adjustAdversaryStress(tokenId, 1);
    }
  });
}

function refreshInspector() {
  if (!inspectorDialog?.rendered) return;

  const currentRoot = getInspectorRootElement();
  if (!currentRoot) return;

  const openDetails = captureOpenDetails(currentRoot);

  try {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderInspectorBody();

    const newRoot = wrapper.querySelector(".cmgi-root");
    if (!newRoot) {
      console.error(
        "Cybermancy GM QOL | refresh produced no .cmgi-root element"
      );
      return;
    }

    currentRoot.replaceWith(newRoot);
    installInspectorClickHandler(newRoot);
    restoreOpenDetails(newRoot, openDetails);
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Inspector refresh failed",
      error,
      {
        pendingOpportunity: getPendingOpportunity(),
        pendingRollNotice: getPendingRollNotice(),
        selectedCombatState: (() => {
          try {
            const token = getSelectedToken();
            return token && isAdversaryActor(token.actor)
              ? getAdversaryCombatState(token)
              : null;
          } catch (_) {
            return { error: "Combat-state discovery failed." };
          }
        })(),
        environments: (() => {
          try { return getSceneEnvironments(); }
          catch (_) { return { error: "Environment discovery also failed." }; }
        })()
      }
    );
  }
}

async function focusToken(tokenId) {
  const token = canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(entry => entry.id === tokenId)
    ?? null;

  if (!token) {
    return ui.notifications.warn("That token is no longer available on the current scene.");
  }

  try {
    setSelectedGroupExpanded(token);
    token.control({ releaseOthers: true });

    if (token.center) {
      await canvas.animatePan({
        x: token.center.x,
        y: token.center.y
      });
    }

    refreshInspector();
  } catch (error) {
    console.error("Cybermancy GM QOL | Failed to focus exact token", error);
    ui.notifications.error("Could not select/pan to that token.");
  }
}

async function openInspector() {
  if (!game.user?.isGM) {
    return ui.notifications.warn("Cybermancy GM QOL is GM-only.");
  }

  if (!canvas?.ready || !canvas.scene) {
    return ui.notifications.warn("No ready canvas scene is currently available.");
  }

  if (inspectorDialog?.rendered) {
    refreshInspector();
    inspectorDialog.bringToTop?.();
    return;
  }

  // A newly opened Inspector session starts with every group collapsed.
  resetInspectorSessionState();

  inspectorDialog = new Dialog(
    {
      title: "Cybermancy GM QOL",
      content: renderInspectorBody(),
      buttons: {
        close: { label: "Close" }
      },
      default: "close",
      render: html => installInspectorClickHandler(html),
      close: () => {
        inspectorDialog = null;
      }
    },
    {
      width: 700,
      height: 700,
      resizable: true
    }
  );

  inspectorDialog.render(true);
}

// ===== 90-hooks.js =====
/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log(`Cybermancy GM QOL | init hook fired | v${VERSION}`);
});

Hooks.once("ready", () => {
  console.log(`Cybermancy GM QOL | ready hook fired | v${VERSION}`);

  const dualityHookName = `${CONFIG.DH.id}.postRollDuality`;
  Hooks.on(dualityHookName, config => {
    processNativeDualityOpportunity(config).catch(error => {
      console.error(
        "Cybermancy GM QOL | native postRollDuality opportunity detection failed",
        error
      );
    });
  });

  console.log(
    "Cybermancy GM QOL | listening for structured PC roll opportunities on",
    dualityHookName
  );

  const qolApi = {
    open: openInspector,
    refresh: refreshInspector,
    getFearState,
    buildGmActionEntries,
    getSceneGroups,
    getScenePcEntries,
    togglePcSectionCollapsed,
    getSceneEnvironments,
    getEnvironmentLinks,
    linkEnvironmentUuid,
    unlinkEnvironmentUuid,
    showLinkEnvironmentDialog,
    getSpotlightState,
    getArchitectureDiagnostic,
    getSpotlightIntegrity,
    getPendingOpportunity,
    getPendingRollNotice,
    dismissPendingRollNotice,
    inspectNativeDualityOpportunity,
    processNativeDualityOpportunity,
    inspectRollOpportunity,
    enrichPendingOpportunityFromMessage,
    dismissPendingOpportunity,
    processRollOpportunity,
    getGrantModeTransaction,
    findAvailableGrantedSpotlight,
    startGrantSpotlightMode,
    stopGrantSpotlightMode,
    grantSpotlightToToken,
    removeGrantedSpotlight,
    getSpotlightLimit,
    getNextGmMoveCost,
    getNewGmMoveCost,
    getPreparedGmMove,
    completePreparedGmMoveManually,
    loadCombatStateFromScene,
    resetInspectorCombatState,
    classifyFeatureCompatibility,
    getSpotlightLimitCompatibility,
    getCompatibilityReport,
    getRuntimeDiagnostic,
    getReleaseCandidateDiagnostic,
    toggleInspectorDiagnostics,
    gainQolFear,
    spendQolFear,
    adjustAdversaryHp,
    adjustAdversaryStress,
    setAdversaryCondition,
    toggleAdversaryCondition,
    adjustPcHp,
    adjustPcStress,
    setPcCondition,
    togglePcCondition,
    getPcCombatState,
    getAdversaryCombatState,
    getNativeAdversaryEffects,
    isAdversaryDefeated,
    buildConditionClearTransactionPlan,
    showConditionClearPreview,
    commitConditionClearTransaction,
    removeHiddenConditionDirect,
    resolveReactionTransactionCapability,
    buildAdversaryReactionTransactionPlan,
    buildEnvironmentReactionTransactionPlan,
    resolveNativeReactionCapability,
    invokeNativeReaction,
    showReactionTransactionPreview,
    commitReactionTransaction,
    undoLastReaction,
    getLatestReactionWithIndex,
    resolveEnvironmentActionTransactionCapability,
    buildEnvironmentActionTransactionPlan,
    resolveNativeEnvironmentActionCapability,
    invokeNativeEnvironmentAction,
    showEnvironmentActionTransactionPreview,
    commitEnvironmentActionTransaction,
    resolveActionTransactionCapability,
    buildActionTransactionPlan,
    getPersistedCombatStateDiagnostic,
    resolveNativeStandardAttackCapability,
    invokeNativeStandardAttack,
    resolveNativeEmbeddedActionCapability,
    invokeNativeEmbeddedAction
  };

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = qolApi;
  }

  // Canonical v1 public API.
  game.cybermancyGMQOL = qolApi;

  // Backward-compatible alias for v0.x/RC macros and console workflows.
  game.cybermancyGMInspector = qolApi;

  if (game.user?.isGM) {
    const fear = getFearState();
    const fearText = fear.available
      ? ` Native Fear detected: ${fear.current}/${fear.max}.`
      : " Native Fear unavailable; no value will be guessed.";

    ui.notifications.info(
      `Cybermancy GM QOL v${VERSION} loaded.${fearText}`
    );
  }
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM) return;

  const tokenControl = controls.tokens
    ?? Object.values(controls).find(control => control?.name === "tokens");

  if (!tokenControl?.tools) {
    console.warn(
      "Cybermancy GM QOL | Token scene control not found",
      controls
    );
    return;
  }

  tokenControl.tools.cybermancyGMQOL = {
    name: "cybermancyGMQOL",
    title: "Cybermancy GM QOL",
    icon: "fa-solid fa-eye",
    order: Object.keys(tokenControl.tools).length,
    button: true,
    visible: true,
    onChange: () => openInspector()
  };
});

// Native postRollDuality remains the only automatic opportunity creator.
// ChatMessage hooks may only enrich an already-pending native opportunity with
// real message/Scene provenance; they never create a second opportunity.
Hooks.on("createChatMessage", message => {
  enrichPendingOpportunityFromMessage(message).catch(error => {
    console.error(
      "Cybermancy GM QOL | pending opportunity ChatMessage enrichment failed",
      error
    );
  });
});

Hooks.on("updateChatMessage", message => {
  enrichPendingOpportunityFromMessage(message).catch(error => {
    console.error(
      "Cybermancy GM QOL | pending opportunity ChatMessage enrichment failed",
      error
    );
  });
});

Hooks.on("controlToken", (token, controlled) => {
  if (controlled) setSelectedGroupExpanded(token);
  refreshInspector();
});
Hooks.on("createToken", () => refreshInspector());
Hooks.on("updateActor", actor => {
  if (
    isEnvironmentActor(actor)
    || isAdversaryActor(actor)
    || isPcActor(actor)
  ) {
    refreshInspector();
  }
});
Hooks.on("createItem", item => {
  const actor = item?.parent ?? null;
  if (isPcActor(actor)) refreshInspector();
});
Hooks.on("updateItem", item => {
  const actor = item?.parent ?? null;
  if (isPcActor(actor)) refreshInspector();
});
Hooks.on("deleteItem", item => {
  const actor = item?.parent ?? null;
  if (isPcActor(actor)) refreshInspector();
});

Hooks.on("createActiveEffect", effect => {
  const actor = effect?.parent ?? null;
  if (isAdversaryActor(actor) || isPcActor(actor)) refreshInspector();
});
Hooks.on("updateActiveEffect", effect => {
  const actor = effect?.parent ?? null;
  if (isAdversaryActor(actor) || isPcActor(actor)) refreshInspector();
});
Hooks.on("deleteActiveEffect", effect => {
  const actor = effect?.parent ?? null;
  if (isAdversaryActor(actor) || isPcActor(actor)) refreshInspector();
});

Hooks.on("deleteToken", tokenDocument => {
  removeSpotlightTokenState(tokenDocument).then(() => refreshInspector());
});
Hooks.on("updateToken", () => refreshInspector());
Hooks.on("canvasReady", async canvas => {
  syncSceneSessionState();

  const scene = canvas?.scene ?? globalThis.canvas?.scene ?? null;
  if (!scene) {
    resetCombatStateInMemory(null);
    refreshInspector();
    return;
  }

  // Prevent state from the previous Scene flashing into the newly viewed Scene.
  resetCombatStateInMemory(scene.id);
  await loadCombatStateFromScene(scene);

  console.log(
    "Cybermancy GM QOL | restored Scene combat state",
    scene.name,
    getSpotlightState()
  );

  refreshInspector();
});

Hooks.on("updateScene", async scene => {
  if (scene?.id !== canvas?.scene?.id) return;

  const raw = scene.getFlag(MODULE_ID, COMBAT_STATE_FLAG);
  const parsed = parsePersistedCombatState(raw);

  if (!parsed.state || parsed.error) return;

  const incomingRevision = Math.max(
    0,
    Math.trunc(Number(parsed.state.revision) || 0)
  );

  // Never replace newer local memory with an older or equal Scene echo.
  if (incomingRevision <= combatStateRevision) {
    if (combatStateWritePending) refreshInspector();
    return;
  }

  restoreCombatStateMemory(parsed.state, scene.id);
  refreshInspector();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene?.id !== canvas?.scene?.id) return;

  try {
    const flattenedChanges = foundry.utils.flattenObject(changes ?? {});
    const environmentLinkChanged = Object.keys(flattenedChanges).some(key =>
      key.includes(
        `flags.${ENVIRONMENT_FLAG_NAMESPACE}.${ENVIRONMENT_FLAG_KEY}`
      )
      || key.includes(
        `flags.${ENVIRONMENT_FLAG_NAMESPACE}.-=${ENVIRONMENT_FLAG_KEY}`
      )
    );

    if (environmentLinkChanged) refreshInspector();
  } catch (error) {
    // Environment refresh is intentionally isolated from the combat-state
    // persistence path used by PC roll opportunity detection.
    console.error(
      "Cybermancy GM QOL | Environment Scene-link refresh failed",
      error
    );
  }
});

Hooks.on("updateSetting", setting => {
  if (isFearRelatedSetting(setting)) {
    console.log(
      "Cybermancy GM QOL | observed native Daggerheart Fear-related Setting update",
      setting.key
    );
    refreshInspector();
  }
});
