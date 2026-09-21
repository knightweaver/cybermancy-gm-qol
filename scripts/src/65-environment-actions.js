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
