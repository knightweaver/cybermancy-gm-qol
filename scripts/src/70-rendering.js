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
