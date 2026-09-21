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
