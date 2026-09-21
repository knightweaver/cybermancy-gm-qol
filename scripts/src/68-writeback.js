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
