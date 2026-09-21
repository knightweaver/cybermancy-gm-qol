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
