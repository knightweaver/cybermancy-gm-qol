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
