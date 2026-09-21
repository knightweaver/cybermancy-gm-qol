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
