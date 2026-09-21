# Cybermancy GM QOL v1.0.1

Target runtime: Foundry v13 / Daggerheart 1.2.7.

## v1.0.1 — Legacy Flag Scope Hotfix

Foundry v13 validates `Document#getFlag` and `Document#unsetFlag` scopes against
active packages. After the v1 package rename, the disabled pre-v1 module is not
a valid scope for those methods.

v1.0.1 therefore:

- reads legacy pre-v1 `combatState` only from serialized Scene flag data;
- never calls `getFlag` or `unsetFlag` with `cybermancy-gm-inspector`;
- records `legacyCombatStateMigrated = true` under the valid
  `cybermancy-gm-qol` namespace after migration;
- writes that marker before Reset removes the v1 combat-state snapshot, so
  stale pre-v1 state cannot reappear;
- leaves inactive legacy flag data untouched rather than invoking an invalid
  package scope.

This fixes **Reset QOL Combat State** and **Show Diagnostics** without changing
combat-state schema 14 or any rules/transaction behavior.

## v1.0.0 — Release Promotion & Package Identity

The production package is now consistently named **Cybermancy GM QOL**.

Canonical v1 identity:

```text
Foundry module ID     cybermancy-gm-qol
Package folder        cybermancy-gm-qol
Global API            game.cybermancyGMQOL
Scene flag namespace  flags.cybermancy-gm-qol
```

Backward compatibility is deliberate:

- `flags.cybermancy-gm-inspector.combatState` is detected when no v1 flag is
  present, restored, rewritten under the v1 namespace, and then removed after
  a successful migration;
- `game.cybermancyGMInspector` remains an alias of `game.cybermancyGMQOL` for
  old macros and console workflows;
- the RC-era `getReleaseCandidateDiagnostic()` API remains an alias of the
  canonical `getRuntimeDiagnostic()` API.

The module's combat-state schema remains **14**. No rules or transaction
semantics changed in the v1 promotion.

### Upgrading from a pre-v1 package

Because Foundry uses the manifest module ID as installation identity,
`cybermancy-gm-qol` is a new canonical package identity. Disable/remove the old
`cybermancy-gm-inspector` package after installing and enabling v1.0. The v1
module itself handles migration of Scene combat-state flags when each Scene is
loaded.

The release package includes `tools/validate-release.mjs`.

## v1.0.0-rc3 — PC Evasion Render Regression Fix

Focused bug-fix release candidate.

The rc2 Evasion patch accidentally placed the `evasion` property in the
adversary combat-state return object while omitting it from the successful PC
combat-state return object. As a result, `renderPcRow()` could attempt to read
`state.evasion.available` when `state.evasion` was undefined and prevent the
entire QOL window from opening.

rc3 corrects the state model:

- adversary combat state no longer references PC Evasion;
- PC combat state returns the resolved native Evasion state;
- PC rendering uses `state.evasion?.available`, so an absent optional field
  renders `—` instead of throwing.

The rc2 bidirectional manual Fear controls remain unchanged.

Combat-state schema remains **14** and the native write surface is unchanged.

## v1.0.0-rc2 — Manual Fear Spend & PC Evasion

Two focused functional additions on the release-candidate baseline.

### Bidirectional manual Fear control

Fear bubbles at the top of the QOL window are now bidirectional administrative
controls:

- click an empty in-capacity bubble → gain exactly 1 native Fear;
- click a filled bubble → spend exactly 1 native Fear.

These manual bubble changes write only the native Daggerheart Fear setting.
They do **not** create or modify a QOL GM Move, Spotlight, grant, Reaction, or
Action ledger entry. This makes the filled bubbles appropriate for feature
costs that the GM is resolving manually.

Manual Fear bubble changes are disabled while another QOL native write or
transaction is pending.

### PC Evasion

Each PC roster row now shows the current read-only **EVASION** value immediately
to the right of **THRESHOLDS**. The value is read from the prepared native
Daggerheart character `system.evasion` value and therefore benefits from the
existing Actor/Item/ActiveEffect refresh paths.

### Release-candidate invariants

Combat-state schema remains **14**. The RC1 transaction-isolation, persistence,
compatibility, diagnostics, and native write-surface gates remain in force.

## v1.0.0-rc1 — Stabilization & Hardening

This release candidate freezes the v0.26.3 GM workflow and focuses on release confidence rather than new automation.

- Diagnostics ON now shows one consolidated runtime snapshot with module, Foundry, Daggerheart, schema, Scene-state, Scene counts, native-interface status, compatibility buckets, and Spotlight-integrity status.
- Combat-state schema remains **14** and legacy/current Scene snapshot parsing/migration are retained.
- PC administrative writes remain isolated from GM Move, Fear, Spotlight, and QOL ledgers.
- Reactions remain isolated from GM Move and adversary Spotlight.
- Environment Actions remain isolated from adversary Spotlight.
- Transaction active-Scene guards and PC Armor Item refresh hooks remain in place.
- Three unreachable verbose transaction renderers were removed; public plans, commit/undo APIs, compact dialogs, and native execution paths remain.
- `tools/validate-rc.mjs` adds a release-gate source audit for RC invariants and the native write surface.

## v0.26.3 — Clickable PC Names

Focused PC-roster interaction patch.

- Each PC name is now a clickable exact-token control.
- Clicking the name uses the same `focus-token` path as adversary token buttons:
  it selects the corresponding Scene token, releases other token selections,
  pans the canvas to the token, and refreshes the QOL display.
- The selected PC name uses the same selected-token visual treatment as the
  adversary token control.
- No PC resource, transaction, GM Move, Fear, Spotlight, or persistence
  semantics change.
- Combat-state schema remains 14.

## v0.26.2 — Armor Slot Refresh & Toggle Alignment

Focused UI/refresh patch.

- PC Armor Slot changes made on the native character sheet now refresh the QOL
  roster when the change is delivered through an embedded Item update.
- QOL listens for PC-owned `createItem`, `updateItem`, and `deleteItem` events
  in addition to the existing Actor and ActiveEffect refresh hooks.
- The `PCS` expand/collapse control explicitly left-aligns its flex contents.
- The `FAST PLAY` expand/collapse control explicitly left-aligns its flex
  contents to match the other disclosure controls.
- No native resource semantics, transactions, write-back behavior, or
  persistence fields change.
- Combat-state schema remains 14.

## v0.26.1 — PC Armor Slots & Section Collapse

Focused PC-roster patch.

- PC rows now display native **Armor Slots** immediately after Stress.
- The readout is `remaining/max` and is read-only.
- The Armor Slot resolver uses the same supported native resource paths already
  used by the QOL combat-state layer; it no longer displays character armor
  score in this position.
- The entire `PCS` section is independently collapsible.
- Individual PC rows remain non-collapsible.
- The PC section defaults to expanded when the QOL window/session or Scene
  changes; its collapsed state is UI-session-only and is never persisted.
- No transaction, GM Move, Fear, Spotlight, native write-back, or persistence
  semantics change.
- Combat-state schema remains 14.

## v0.26 — PC Scene Roster & Transaction Dialog Completion

A new `PCS` section appears before `ADVERSARIES`. It lists Daggerheart
`character` Actors represented on the current Scene. Linked duplicate tokens
for the same Actor collapse to one row; unlinked token Actors remain distinct.

Each PC row shows thumbnail, name, editable HP, editable Stress, Armor when
available, current Major/Severe thresholds, and Vulnerable/Restrained/Hidden
ON/OFF buttons. PC edits are direct native state synchronization and do not
create GM Moves, consume Spotlight, spend Fear, or create QOL ledger entries.

The compact 620×300 resizable transaction pattern now also applies to embedded
adversary Actions, Environment Actions, and adversary/Environment Reactions.
Implementation details live in the formatted `ⓘ` panel and all operational
buttons have hover summaries.

Standard attacks retain the v0.25.4 transaction behavior.

Combat-state schema remains **14**.

## v0.25.4 — Transaction Height & Button Guidance

UI-only patch.

- Standard GM Action transaction dialogs now open at 620×300.
- The dialog remains resizable.
- `Commit & Roll` hover text summarizes the bookkeeping + native roll behavior.
- `Bookkeeping Only` hover text summarizes bookkeeping without invoking the roll.
- `Cancel` hover text explicitly states that no Fear, GM Move, Spotlight, or
  attack roll is committed.
- No mechanics, write-back semantics, or persistence changes.
- Combat-state schema remains 14.

## v0.25.3 — Resizable Transaction Dialog & Header Thumbnails

UI-only patch.

- Standard GM Action transaction dialogs now open at 620×390 and are resizable.
- The default window is large enough for the formatted transaction-information
  hover panel to remain inside the dialog footprint under normal use.
- Each resolved adversary header displays the Actor image as a small thumbnail.
- Each resolved Environment header displays the Environment Actor image as a
  small thumbnail.
- Header thumbnails are absolutely positioned at a fixed 1.7rem square and do
  not participate in flex-row height calculation, so the thumbnail itself does
  not increase collapsed section height.
- No mechanics, write-back semantics, or persistence changes.
- Combat-state schema remains 14.

## v0.25.2 — Compact State Strip & Transaction Dialog Polish

UI-only patch.

- Standard attack transaction buttons are single-line and equal height.
- Transaction implementation details use a formatted label/value hover panel.
- Reset and Diagnostics bottom controls use identical geometry.
- Selected adversary state is one compact strip: HP, Stress, Thresholds,
  optional Armor, and the three core condition toggles.
- The Conditions / Effects heading is removed.
- HP and Stress label+value controls have an explicit interactive visual cue.
- Custom non-core effects remain below the compact strip.
- No mechanics, write-back semantics, or persistence changes.
- Combat-state schema remains 14.

## v0.25.1 — QOL Density & Standard-Attack Dialog Cleanup

UI-only patch on v0.25.

- Vulnerable, Restrained, and Hidden buttons provide condition-rule reminders
  in hover text.
- Exact-token Spotlight counters are condensed to
  `SPOT current/limit · LINK n · TOTAL n`.
- The SPOT current/limit control remains the exact-token record-Spotlight button.
- Standard attack GM Action dialogs display only Actor — Action, TOTAL FEAR,
  and COMMIT & ROLL / BOOKKEEPING ONLY / CANCEL.
- Implementation details move to an `ⓘ` hover control.
- COMMIT & ROLL and BOOKKEEPING ONLY descriptions move to button hover text.
- CANCEL receives the same flex sizing as the other two standard-attack buttons.
- Embedded-feature GM Action dialogs remain unchanged in this first dialog pass.
- No mechanics, write-back semantics, or persistence changes.
- Combat-state schema remains 14.

## v0.25 — Direct Native Write-Back

v0.25 introduces the approved administrative QOL write-back layer.

These controls synchronize native Foundry/Daggerheart state directly and are
**not GM Actions**:

```text
direct QOL write
= no GM Move
+ no Spotlight
+ no Inspector ledger entry
```

### Fear

The Fear readout is now a 12-slot dot display.

- Filled dot = that Fear is currently available.
- Empty in-capacity dot = available slot.
- Disabled/dim dot = outside the configured native maximum.
- Clicking any empty in-capacity dot gains exactly 1 native Fear.
- Fear is never gained automatically by this module.

Existing GM Move/Reaction/Environment Fear spending remains unchanged.

### Adversary HP

The selected adversary compact state displays the native remaining HP value as
an interactive control.

```text
left click  -> remaining HP -1
right click -> remaining HP +1
```

The adapter converts the displayed remaining-HP gesture into the native
Daggerheart reversed-resource value when required and clamps to `0..max`.

### Adversary Stress

Stress uses the same compact gesture:

```text
left click  -> marked Stress -1
right click -> marked Stress +1
```

For safety, direct Stress editing is enabled only for the supported reversed
Daggerheart adversary Stress resource model.

### Core Daggerheart conditions

The three core conditions are always visible as ON/OFF controls:

```text
[VULNERABLE OFF] [RESTRAINED ON] [HIDDEN OFF]
```

Clicking a button toggles the native configured status directly.

This is administrative state editing. Toggling a condition does not spend a GM
Move, consume Spotlight, or create Inspector bookkeeping.

Other/custom native effects continue to render below the three core controls.

### Compatibility

The older transactional clear-condition APIs remain compiled for backwards API
compatibility, but the compact QOL interface uses direct condition toggles for
Vulnerable, Restrained, and Hidden.

### Persistence

No new Inspector persistence is required. HP, Stress, conditions, and Fear are
native state.

Combat-state schema therefore remains **14**.

## v0.24.3 — Bottom Control Alignment

UI-only patch.

- `RESET QOL COMBAT STATE` and `SHOW/HIDE DIAGNOSTICS` now render as compact,
  auto-width controls on the same right-aligned bottom row.
- No mechanics, persistence, or native write behavior changes.
- Combat-state schema remains 14.

## v0.24.2 — Minor Layout Cleanup

UI-only patch.

- Adversary role/type and Tier are grouped directly beside the adversary name.
- The `… Recovery` disclosure is removed.
- `RESET QOL COMBAT STATE` now sits beside the Diagnostics control at the bottom.
- Reset semantics are unchanged.
- Combat-state schema remains 14.
- No transaction, metadata, or native write behavior changes.

## v0.24.1 — Compact Header & Diagnostic Cleanup

UI-only patch on the v0.24 layout baseline.

- Adversary role/type and Tier now render inline with the adversary name so
  they remain visible while the adversary card is collapsed.
- The prior expanded-body role/Tier line is removed to avoid duplication.
- The existing role/Tier typography is preserved; only inline layout spacing
  is overridden.
- `CONDITIONS / EFFECTS` now reuses the same state-label typography as
  `HP`, `STRESS`, `ARMOR`, and `THRESHOLDS`.
- The explanatory paragraph beneath `ENVIRONMENT ACTIONS & FEATURES` renders
  only while the master Diagnostics mode is enabled.
- No transaction, persistence, metadata, or native write behavior changes.
- Combat-state schema remains 14.

## v0.24 — QOL Layout & Compact UI

v0.24 is presentation/navigation-only. The visible Foundry product is now
**Cybermancy GM QOL**. That release still used the legacy technical module ID `cybermancy-gm-inspector`; v1.0 migrates that namespace to `cybermancy-gm-qol`.

- Environments render below adversaries.
- `SCENE-PERSISTED` is removed from the Spotlight header.
- Global diagnostics toggle moves to the bottom.
- Compatibility, Fear, Actor, and unavailable-Armor diagnostics are master-gated.
- Selected adversary state is compact: HP, STRESS, optional ARMOR, THRESHOLDS.
- Fast Play is independently collapsible per Actor for the current session.
- GM Actions explanatory prose moves to an ⓘ tooltip.
- AVAILABLE granted-Spotlight chips select/focus their exact token.
- No new Fear/HP/Stress/condition write-back is introduced.
- Combat-state schema remains 14.

## v0.23 — Compatibility, Metadata Coverage & HUD Completion

v0.23 is the feature-completion increment before the v1.0 stabilization pass.
It adds no new action-economy subsystem and changes no intended GM Move,
Environment, Reaction, condition, Fear, Spotlight, or opportunity rules.

### Compatibility resolution

Every displayed feature can now be classified as:

```text
EXPLICIT  — flags.cybermancy.gmAction
NATIVE    — reliable structured Daggerheart data
SIDECAR   — Inspector compatibility registry
AMBIGUOUS — structured sources conflict or native data is internally ambiguous
UNKNOWN   — insufficient structured information
```

No feature name, description, or rendered prose is parsed.

The feature sidecar ships empty rather than inventing overrides. Spotlight-limit
sidecar support uses the existing verified stable-UUID registry.

### Safety / precedence

Resolution order is explicit -> native -> sidecar -> unknown. If explicit and
native structured data directly conflict on action type or Fear cost, the
feature is shown as AMBIGUOUS and is not made executable by the Inspector.

### Spotlight-limit provenance

The HUD now identifies the resolved limit source as CYBERMANCY, NATIVE,
SIDECAR, or DEFAULT. The advisory default remains 1.

### Compatibility report

```js
game.cybermancyGMQOL.getCompatibilityReport()
```

returns current-Scene counts for adversaries, Environments, feature metadata
buckets, Spotlight-limit sources, and explicit issue records for AMBIGUOUS and
UNKNOWN features.

### Diagnostic display

`SHOW DIAGNOSTICS` is session-local and presentation-only. It exposes feature
provenance, conflict/unknown reasons, stable keys, and a Scene compatibility
summary without changing persisted Scene state.

### Compact collapsed summaries

Collapsed adversary groups now surface TURN plus native HP/Stress/Armor and
major named conditions for the selected/representative exact token; defeated
adversaries show DEFEATED. Environment cards show how many structured features
are currently executable by the Inspector.

### Persistence

No new persisted combat-state fields are added. Schema remains **14**.

### Regression requirements

- explicit/native/sidecar/ambiguous/unknown classification;
- no prose/name inference;
- Spotlight-limit provenance and default 1;
- diagnostic toggle changes presentation only;
- compact adversary/Environment summaries;
- adversary Action, Environment Action, Reaction, condition CLEAR, Hidden
  REMOVE, GM Opportunity, NO RESULT, grants, prepared moves, and persistence
  remain behaviorally unchanged.

## v0.22 — Combat State HUD & Condition Management

v0.22 adds native adversary state awareness without creating a second
character sheet or duplicate HP/Stress/Armor model.

### Selected adversary state

When an exact adversary token is selected, its expanded card reads native
Daggerheart state and shows:

```text
COMBAT STATE

HP              3 / 4 remaining · 1 marked
STRESS          2 / 3 marked
ARMOR           1 / 2 remaining
CURRENT MAJOR   8
CURRENT SEVERE  14

CONDITIONS / EFFECTS
Vulnerable
Restrained — Source: Mono-Wire Snare
```

HP, Stress, Armor, and thresholds are display-only.

Cybermancy does not independently recompute armor degradation thresholds; it
shows the Actor's current native `damageThresholds.major` and `.severe`.

### Native Daggerheart adversary resource model

Current Daggerheart adversary exports use reversed HP/Stress resources such as:

```json
"resources": {
  "hitPoints": { "value": 1, "max": 4, "isReversed": true },
  "stress": { "value": 2, "max": 3, "isReversed": true }
}
```

For HP, the HUD displays remaining HP and marked HP separately. For Stress it
displays marked Stress.

If a native Armor resource is absent, the HUD explicitly shows Armor as
unavailable rather than guessing.

### Effects / conditions

The HUD reads enabled, non-suppressed native ActiveEffects from the selected
Actor. Recognized `Vulnerable`, `Restrained`, and `Hidden` conditions are
shown, as are other named active effects.

Unknown effects remain visible by name but are reference-only unless native
status data confidently marks them as a condition.

When an ActiveEffect origin can be resolved, its source name is displayed.

### Clear temporary condition

Normal temporary conditions use the existing adversary action economy:

```text
CLEAR CONDITION
= GM Move
+ exact adversary Spotlight
+ native ActiveEffect removal
```

Priority remains:

```text
exact-token granted Spotlight
> prepared GM Move
> acquire new GM Move
```

A granted Spotlight already owns its TURN/TOTAL mark, so condition clearing
does not double-count it.

Condition removal is persisted as an Action transaction with:

```json
{
  "transactionType": "action",
  "actionSubtype": "clear-condition",
  "executionMode": "native-effect-remove",
  "effectId": "...",
  "effectName": "Vulnerable"
}
```

Combat-state schema is now **14**.

Inspector Undo can reverse GM Move/Fear/Spotlight bookkeeping, but it does not
recreate a native ActiveEffect already removed.

### Hidden

Hidden is different because its ending is state/fiction, not an adversary
clear action.

```text
HIDDEN
Ends when visible, enters line of sight, attacks, or the effect ends.
[REMOVE]
```

REMOVE changes:

```text
GM Move    NONE
Fear       NONE
Spotlight  NONE
```

The Inspector does not attempt line-of-sight inference.

### Defeated adversaries

An adversary whose native HP track has no remaining HP is marked:

```text
DEFEATED
```

The Inspector blocks:

- new manual Spotlight;
- granted Spotlight assignment;
- ordinary Action USE;
- Reaction REACT;
- clear-condition Actions.

It still permits selection, inspection, Fast Play/reference display, existing
ledger Undo, and direct state cleanup such as Hidden removal.

### Full Stress

If native Stress is full:

```text
FULL STRESS
```

If Vulnerable is also present, the HUD identifies the full-Stress context.

If Vulnerable is missing:

```text
FULL STRESS — SHOULD BE VULNERABLE
```

This is advisory only. v0.22 deliberately does not silently create/remove the
native Vulnerable effect.

### Live refresh

The Inspector refreshes on:

- Actor updates;
- ActiveEffect create;
- ActiveEffect update;
- ActiveEffect delete.

No polling/timers are added.

### Required runtime regression

1. Select adversary: HP/Stress/Armor/threshold display matches native sheet.
2. Change HP/Stress externally: Inspector refreshes.
3. Apply Vulnerable externally: condition appears.
4. CLEAR Vulnerable: consumes GM Move + exact Spotlight and removes effect.
5. Prepared move + CLEAR: no second GM Move Fear.
6. Granted Spotlight + CLEAR: no new GM Move and no duplicate TURN/TOTAL.
7. Hidden REMOVE: no GM Move/Fear/Spotlight changes.
8. Defeated adversary: USE/REACT/new Spotlight disabled.
9. Existing Undo remains available after defeat.
10. Full Stress advisory behaves correctly.
11. Unknown active effect remains visible.
12. Environment Action, Reaction, GM Opportunity, and NO RESULT regressions pass.

## v0.21 — Reaction & Non-Spotlight Features

v0.21 adds a third GM-side execution semantic:

```text
Adversary Action
= GM Move + adversary Spotlight

Environment Action
= GM Move + NO adversary Spotlight

Reaction / explicit non-Spotlight feature
= NO GM Move + NO adversary Spotlight + NO Spotlight handoff
```

### Classification

Reaction resolution uses structured data only.

Priority:

1. explicit `flags.cybermancy.gmAction.actionType = "reaction"`;
2. native Daggerheart Action with structured `actionType = "reaction"`;
3. explicit `usesSpotlight:false` plus an unambiguous non-passive
   `gmAction.actionType`.

No prose or feature-name parsing is used.

### UI

Eligible features display:

```text
[REACT]
```

during either PC or GM Spotlight.

An adversary Reaction still requires selecting the exact adversary token so the
native Daggerheart speaker/workflow comes from the intended Actor. Environment
Reactions require no Environment token when the Environment is explicitly
linked.

### Reaction preview

```text
GM Move                    NONE
Feature Cost               Daggerheart or Inspector, by ownership
Spotlight                  NONE — owner unchanged
Adversary TURN/LINKED/TOTAL UNCHANGED
```

The Inspector never decides whether the fictional Reaction trigger is legal.
The GM decides and clicks REACT.

### Native ownership

If exactly one safe native Daggerheart Reaction is available:

```text
Inspector   -> orchestration only
Daggerheart -> native Fear/Stress/other costs, dialogs, rolls, targets, effects
```

Explicit `usesSpotlight:false` Action metadata can also use the native path when
the single native Action is consistently structured as `action`.

If safe native execution is unavailable, structured bookkeeping-only Reaction
Fear can remain Inspector-owned.

### Independent Reaction ledger — schema v13

Reactions are **not** stored in `gmMoveLedger`.

```json
{
  "transactionType": "reaction",
  "sourceType": "adversary",
  "tokenId": "...",
  "actionName": "Counterfire",
  "inspectorFearCost": 0,
  "expectedNativeFearCost": 1,
  "executionMode": "native-embedded",
  "executionStatus": "completed",
  "eventSequence": 7
}
```

Environment Reactions use `environmentUuid` instead of `tokenId`.

The Reaction ledger is current-cycle bookkeeping and clears on `END GM TURN`.

### Event ordering

GM Action transactions, Environment Actions, granted Action executions, and
Reactions now receive an internal event sequence. The dialog can therefore
display a later Reaction as:

```text
LAST GM EVENT
Threshold Cougar — Counterfire
REACTION · COMPLETED
NO GM MOVE · NO SPOTLIGHT
[UNDO REACTION]
```

A later normal GM Action replaces it as the latest event.

### Reaction Undo

`UNDO REACTION`:

- removes Reaction bookkeeping;
- refunds Inspector-owned Reaction Fear only;
- changes no GM Move;
- changes no prepared move;
- changes no adversary TURN/LINKED/TOTAL;
- changes no Spotlight owner;
- does not reverse native Daggerheart costs, rolls, chat, damage, uses, or
  effects.

### Required regressions

1. Native adversary Reaction during PC Spotlight: owner remains PCs; GM Moves
   and adversary counters unchanged.
2. Reaction during GM Spotlight: prepared move remains ready.
3. Environment Reaction: no GM Move or adversary Spotlight.
4. Native Reaction Fear remains Daggerheart-owned.
5. Bookkeeping Reaction structured Fear remains Inspector-owned.
6. ADD MOVE -> REACT leaves ADD MOVE prepared.
7. Available granted Spotlight -> REACT leaves grant available.
8. Reaction Undo does not touch GM Move ledger.
9. Ordinary adversary Action still uses GM Move + Spotlight.
10. Environment Action still uses GM Move + no Spotlight.
11. v0.19.1 GM Opportunity / NO RESULT behavior remains unchanged.
12. Reaction ledger and latest-event display restore after reload.

## v0.20 — Environment Action Transactions

v0.20 makes active Environment Actions first-class GM Move transactions.

```text
Environment Action
= GM Move
+ Environment feature
+ NO adversary Spotlight
```

Environment Actions reuse the existing base/additional/prepared/interrupt GM
Move lifecycle. No Environment TURN/LINKED/TOTAL counter is introduced.

Expanded Environment cards now give safely classified Action/Attack features a
`USE` control. Passive and Reaction features remain reference-only.

An explicitly linked Environment does not require a token. A token-detected
Environment may use an Action while present.

For native features, the ownership split remains:

```text
Inspector   -> GM Move Fear
Daggerheart -> native feature costs, dialogs, rolls and effects
```

The preview explicitly displays `Adversary Spotlight: NONE`.

Environment ledger records use schema **12** and
`transactionType: "environment-action"` with `environmentUuid`.

Undo removes the GM Move and refunds only Inspector-owned Fear. It changes no
adversary Spotlight counters and does not reverse native Daggerheart effects.

A committed Environment Action also prevents grant mode from reaching backward
through it to attach a new grant to an older adversary/Leader transaction.

Primary regression tests:

1. Natural handoff -> Environment USE: 0 GM Move Fear, GM Moves +1.
2. Additional Environment USE: exactly 1 GM Move Fear.
3. Prepared ADD MOVE -> Environment USE: no second GM Move Fear.
4. INTERRUPT -> Environment USE: included prepared move is consumed.
5. All Environment Actions leave adversary TURN/LINKED/TOTAL unchanged.
6. Native Environment feature Fear is Daggerheart-owned.
7. Linked Environment with no token can execute.
8. Token-detected Environment can execute while present.
9. BOOKKEEP ONLY follows structured cost ownership and still uses no Spotlight.
10. Undo changes no adversary Spotlight.
11. Environment collapse remains independent.
12. v0.19.1 GM Opportunity and NO RESULT behavior remains unchanged.
13. Granted adversary Spotlight USE remains 0 extra GM Move Fear.

## v0.19.1 — Visible NO RESULT State

v0.19 returned `NO RESULT` through the diagnostic API, but runtime processing
discarded the non-qualifying diagnostic before the dialog could render it.

v0.19.1 adds a separate informational PC-roll notice. It is **not** a GM
Opportunity.

```text
NO RESULT
<PC> — RESULT UNRESOLVED
Select a target or set a Difficulty so Daggerheart can determine
success/failure. No GM Opportunity was created.
[DISMISS]
```

The notice spends no Fear, changes no Spotlight, creates no GM Move, and leaves
the normal NATURAL HANDOFF / INTERRUPT controls available. It clears when a
later roll has a resolved result and is Scene-persisted. Combat-state schema is
now **11**.

## v0.19 — Architecture & Opportunity Hardening

v0.19 is intentionally a maintenance/hardening increment. It does not add new
GM Move, Fear, Spotlight, or Environment Action semantics.

The one requested UI addition is included: **each Environment card now collapses
and expands independently, using the same default-collapsed interaction pattern
as adversaries.**

## Runtime architecture

Foundry still executes one shared ES-module scope.

```text
scripts/main.js
    -> imports scripts/bundle.js
```

`bundle.js` is generated from focused source modules:

```text
scripts/src/
  00-preamble.js
  10-fear.js
  20-state.js
  30-opportunities.js
  40-environments.js
  50-adversaries.js
  60-actions.js
  70-rendering.js
  80-window.js
  90-hooks.js
```

This is deliberate. Splitting the live code into independently scoped ES modules
would change JavaScript binding semantics and create unnecessary runtime risk.
The source is separated for maintainability, while the generated bundle
preserves the working single-scope behavior from v0.18.2.

Rebuild with:

```text
node tools/build-bundle.mjs
```

Validate the packaged source with:

```text
node tools/validate-build.mjs
```

## Canonical GM Opportunity classifier

Both:

- the live Daggerheart `postRollDuality` path; and
- ChatMessage diagnostic inspection

now call the same:

```js
classifyOpportunityOutcome(...)
```

There is one definition of:

- Success with Hope
- Success with Fear
- Failure with Hope
- Failure with Fear
- Critical Success

The live runtime signal remains Daggerheart's structured
`postRollDuality` hook, which passed v0.18.2 runtime testing.

## No-result diagnostics

A Duality Roll with no structured success evidence is still ignored.

The diagnostic is now explicit:

```text
NO RESULT — Duality Roll has no structured success/target-hit evidence.
Select a target or supply a difficulty so Daggerheart can determine success/failure.
```

This is particularly useful when testing attack rolls without selecting a
target.

## ChatMessage enrichment only

ChatMessage create/update hooks do **not** create GM Opportunities.

They may only enrich an already-pending native opportunity with:

- the real ChatMessage ID;
- speaker Scene ID;
- a stable source key where available.

This does not increment the qualifying-roll count or create a second
opportunity.

## Reroll correlation

The native path now prefers:

```text
Actor UUID + Item ID + Action ID
```

when Daggerheart supplies those values.

Actor-only correlation remains a fallback for roll types without Item/Action
identity.

## Pending-opportunity schema v10

The Scene combat-state schema advances from 9 to **10** to preserve optional
provenance:

```json
{
  "sourceKey": "Actor...|Item...|Action...",
  "speakerSceneId": "...",
  "detectionSource": "native+chat"
}
```

v9 state migrates safely; missing fields are optional.

## Collapsible Environments

Environment cards now default collapsed:

```text
▸ Seattle Underflow Grid    Tier 1    LINKED    [UNLINK]
```

Expand:

```text
▾ Seattle Underflow Grid    Tier 1    LINKED    [UNLINK]

FAST PLAY
...

ENVIRONMENT FEATURES
...
```

Each Environment has independent UI-session expansion state. Expansion state is
not written to the Scene, matching adversary-card behavior.

Broken/unresolved Environment cards are collapsible as well.

## Regression fixtures

The package now includes:

```text
tests/regression-fixtures.json
```

covering:

- four normal Duality outcomes;
- critical success;
- no-target/no-result;
- reactions;
- adversary-side rolls;
- rerolls;
- Environment linkage/deduplication/collapse;
- granted Spotlight consumption;
- Fear ownership;
- Scene/pending-opportunity persistence.

## Acceptance tests

### A. Behavior-preserving combat regression

1. Natural Handoff remains 0 Fear.
2. Interrupt remains exactly 1 Fear and includes its prepared move.
3. Additional GM Move remains 1 Fear.
4. Standard adversary USE follows existing transaction behavior.
5. Granted Spotlight USE remains 0 GM Move Fear and does not double-count TURN.

### B. Opportunity regression

With a target/difficulty that allows Daggerheart to determine success:

- Success/Hope -> no opportunity
- Success/Fear -> Minor
- Failure/Hope -> Minor
- Failure/Fear -> Major
- Critical -> no opportunity

A targetless/no-difficulty roll should produce no opportunity and the diagnostic
API should report `NO RESULT`.

### C. Chat enrichment

After a native opportunity appears, inspect:

```js
game.cybermancyGMQOL.getPendingOpportunity()
```

Once the ChatMessage is created, its `messageId` should be a real Foundry
message ID and `detectionSource` should become `native+chat` when correlation is
confident.

### D. Environment collapse

1. Link one or more Environments.
2. Each card should initially be collapsed.
3. Expand one card.
4. Other Environment cards remain independently collapsed.
5. Collapse/expand must not change Scene flags, Fear, GM Moves, or combat state.

### E. Environment regression

- explicit linking/unlinking works;
- token-only detection works;
- linked+token Actor appears once;
- unresolved link remains until explicitly removed;
- Environment features remain READ ONLY in v0.19.

## Diagnostics

Architecture:

```js
game.cybermancyGMQOL.getArchitectureDiagnostic()
```

Pending opportunity:

```js
game.cybermancyGMQOL.getPendingOpportunity()
```

Native roll inspector:

```js
game.cybermancyGMQOL.inspectNativeDualityOpportunity(config)
```

Chat diagnostic:

```js
game.cybermancyGMQOL.inspectRollOpportunity("<messageId>")
```

Environment discovery:

```js
game.cybermancyGMQOL.getSceneEnvironments()
```
