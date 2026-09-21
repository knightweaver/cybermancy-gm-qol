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
