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
