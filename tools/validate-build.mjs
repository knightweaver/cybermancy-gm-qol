import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = fs.readFileSync(path.join(root, "scripts", "bundle.js"), "utf8");
const fixtures = JSON.parse(fs.readFileSync(
  path.join(root, "tests", "regression-fixtures.json"),
  "utf8"
));

function requireText(text, label) {
  if (!bundle.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText('const VERSION = "1.0.1";', "version");
requireText('const MODULE_ID = "cybermancy-gm-qol";', "canonical module id");
requireText('const LEGACY_MODULE_ID = "cybermancy-gm-inspector";', "legacy module id");
requireText("const COMBAT_STATE_SCHEMA_VERSION = 14;", "schema");
requireText("function classifyOpportunityOutcome(", "canonical classifier");
requireText("function inspectNativeDualityOpportunity(", "native inspector");
requireText("function inspectRollOpportunity(", "chat diagnostic");
requireText("function enrichPendingOpportunityFromMessage(", "chat enrichment");
requireText("NO RESULT — Duality Roll has no structured success/target-hit evidence.", "no-result diagnostic");
requireText("let pendingRollNotice = null;", "roll notice state");
requireText("function sanitizePendingRollNotice(", "roll notice sanitizer");
requireText("function setPendingRollNoticeFromDiagnostic(", "roll notice runtime");
requireText('data-action="dismiss-roll-notice"', "roll notice UI");
requireText("RESULT UNRESOLVED", "roll notice text");
requireText("const expandedEnvironments = new Set();", "Environment collapse state");
requireText('data-action="toggle-environment"', "Environment collapse control");
requireText('USE · GRANTED', "granted Spotlight behavior");
requireText("function getSceneEnvironments(", "Environment discovery");
requireText("const collapsedFastPlay = new Set();", "Fast Play collapse state");
requireText("function toggleFastPlayCollapsed(", "Fast Play toggle");
requireText('data-action="toggle-fastplay"', "Fast Play UI toggle");
requireText("cmgi-info-icon", "GM Actions information icon");
requireText("cmgi-grant-available", "clickable available grant chip");
requireText("Cybermancy GM QOL", "visible QOL branding");
requireText("cmgi-subtitle-inline", "inline adversary role/Tier");
requireText("cmgi-adversary-identity", "adjacent adversary identity group");
requireText("RESET QOL COMBAT STATE", "bottom reset control");
requireText("flex-wrap: nowrap;", "single-line bottom controls");
requireText("let nativeQolWritePending = false;", "native QOL write lock");
requireText("async function gainQolFear(", "Fear direct write");
requireText("async function spendQolFear(", "manual Fear spend");
requireText("async function adjustAdversaryHp(", "HP direct write");
requireText("async function adjustAdversaryStress(", "Stress direct write");
requireText("async function setAdversaryCondition(", "condition direct write");
requireText("async function toggleAdversaryCondition(", "condition toggle");
requireText("function renderQolConditionControls(", "condition toggle UI");
requireText('data-action="gain-qol-fear"', "Fear gain gesture");
requireText('data-action="spend-qol-fear"', "Fear spend gesture");
requireText('data-action="adjust-qol-resource"', "HP/Stress gesture");
requireText('data-action="toggle-qol-condition"', "condition toggle gesture");
requireText("cmgi-fear-dot-filled", "Fear filled slot UI");
requireText("cmgi-condition-toggle-on", "condition ON UI");
requireText("All rolls targeting you have advantage.", "Vulnerable hover reminder");
requireText("You can't move, but you can otherwise act normally.", "Restrained hover reminder");
requireText("cmgi-spotlight-metrics", "compact Spotlight metrics");
requireText("function renderStandardAttackCompactPreviewContent(", "compact standard attack dialog");
requireText("function buildStandardAttackImplementationDetails(", "standard attack info tooltip");
requireText("function configureStandardAttackDialogButtons(", "standard attack button tooltips");
requireText("BOOKKEEPING ONLY", "compact bookkeeping button");
requireText("TOTAL FEAR:", "compact Fear total");
requireText("cmgi-transaction-info-popover", "formatted transaction info hover");
requireText("cmgi-state-resource-button", "clickable HP Stress controls");
requireText("cmgi-condition-inline", "inline condition controls");
requireText('button.style.height = "2rem"', "equal-height transaction buttons");
requireText("width: 620", "standard transaction default width");
requireText("height: 300", "standard transaction default height");
requireText("resizable: true", "resizable transaction dialog");
requireText("function renderQolActorThumbnail(", "actor thumbnail renderer");
requireText("cmgi-header-thumbnail", "fixed header thumbnail");
requireText("cancel.title = cancelTitle", "Cancel hover summary");
requireText("Close this transaction without spending Fear", "Cancel hover text");
requireText("function getScenePcEntries(", "Scene PC roster");
requireText("function getPcCombatState(", "PC combat state");
requireText("async function adjustPcHp(", "PC HP writeback");
requireText("async function adjustPcStress(", "PC Stress writeback");
requireText("async function setPcCondition(", "PC condition writeback");
requireText("function renderPcSection(", "PC roster UI");
requireText("function renderQolCompactTransactionContent(", "shared compact transaction UI");
requireText("function configureQolCompactTransactionButtons(", "compact transaction buttons");
requireText("function buildEnvironmentCompactPreview(", "Environment compact preview");
requireText("function buildReactionCompactPreview(", "Reaction compact preview");
requireText("let pcSectionCollapsed = false;", "PC section collapse state");
requireText("function togglePcSectionCollapsed(", "PC section collapse toggle");
requireText('data-action="toggle-pc-section"', "PC section collapse UI");
requireText("ARMOR SLOTS", "PC Armor Slots readout");
requireText("EVASION", "PC Evasion readout");
requireText('foundry.utils.getProperty(actor, "system.evasion")', "native PC Evasion source");
requireText("const evasion = getPcEvasionState(actor);", "PC Evasion resolver");
requireText("state.evasion?.available", "optional-safe PC Evasion rendering");
requireText('Hooks.on("updateItem"', "PC Item update refresh hook");
requireText('Hooks.on("createItem"', "PC Item create refresh hook");
requireText('Hooks.on("deleteItem"', "PC Item delete refresh hook");
requireText('class="cmgi-token-instance cmgi-pc-name${selectedClass}"', "clickable PC name");
requireText('data-action="focus-token"', "PC name focus-token action");
requireText('title="Select and pan to this PC token"', "PC name focus tooltip");
requireText("cmgi-condition-heading", "compact Conditions/Effects heading");
requireText("ENVIRONMENT ACTIONS & FEATURES", "Environment feature heading");
requireText("function classifyFeatureCompatibility(", "feature compatibility classifier");
requireText("function applyFeatureSidecarCompatibility(", "feature sidecar application");
requireText("function getSpotlightLimitCompatibility(", "Spotlight-limit compatibility");
requireText("function getCompatibilityReport(", "compatibility report");
requireText("function toggleInspectorDiagnostics(", "diagnostics toggle");
requireText("const COMPATIBILITY_SIDECAR", "compatibility sidecar registry");
requireText('data-action="toggle-diagnostics"', "diagnostic display toggle");
requireText("COMPATIBILITY REPORT", "compatibility summary UI");
requireText("function getAdversaryCombatState(", "native combat-state reader");
requireText("function getNativeAdversaryEffects(", "native ActiveEffect discovery");
requireText("function isAdversaryDefeated(", "defeated-state reader");
requireText("function buildConditionClearTransactionPlan(", "condition-clear planner");
requireText("async function commitConditionClearTransaction(", "condition-clear commit");
requireText("async function removeHiddenConditionDirect(", "Hidden direct remove");
requireText('actionSubtype: "clear-condition"', "condition-clear ledger subtype");
requireText("FULL STRESS — SHOULD BE VULNERABLE", "full-Stress advisory");
requireText("THRESHOLDS", "compact threshold UI");
requireText('data-action="preview-condition-clear"', "condition CLEAR control");
requireText('data-action="remove-hidden-condition"', "Hidden REMOVE control");
requireText("const reactionLedger = [];", "Reaction ledger");
requireText("function sanitizeReactionLedger(", "Reaction ledger sanitizer");
requireText("function resolveReactionTransactionCapability(", "Reaction capability");
requireText("function buildAdversaryReactionTransactionPlan(", "adversary Reaction planner");
requireText("function buildEnvironmentReactionTransactionPlan(", "Environment Reaction planner");
requireText("function resolveNativeReactionCapability(", "native Reaction capability");
requireText("async function invokeNativeReaction(", "native Reaction invocation");
requireText("async function commitReactionTransaction(", "Reaction commit");
requireText("async function undoLastReaction(", "Reaction undo");
requireText('data-action="preview-reaction-transaction"', "REACT control");
requireText("NO GM MOVE · NO SPOTLIGHT", "Reaction latest-event semantics");
requireText("function buildEnvironmentActionTransactionPlan(", "Environment transaction planner");
requireText("function resolveEnvironmentActionTransactionCapability(", "Environment transaction capability");
requireText("function resolveNativeEnvironmentActionCapability(", "Environment native capability");
requireText("async function invokeNativeEnvironmentAction(", "Environment native invocation");
requireText("async function commitEnvironmentActionTransaction(", "Environment transaction commit");
requireText('transactionType: "environment-action"', "Environment ledger type");
requireText("environmentUuid:", "Environment ledger UUID");
requireText('["Adversary Spotlight", "NONE"]', "Environment no-Spotlight compact preview");
requireText('data-action="preview-environment-action-transaction"', "Environment USE control");

if (fixtures.opportunities.length < 9) {
  throw new Error("Opportunity fixture coverage is incomplete.");
}
if (fixtures.environment.length < 5) {
  throw new Error("Environment fixture coverage is incomplete.");
}
if ((fixtures.environmentActions ?? []).length < 10) {
  throw new Error("Environment Action fixture coverage is incomplete.");
}
if ((fixtures.reactions ?? []).length < 12) {
  throw new Error("Reaction fixture coverage is incomplete.");
}
if ((fixtures.combatStateHud ?? []).length < 12) {
  throw new Error("Combat State HUD fixture coverage is incomplete.");
}
if ((fixtures.compatibility ?? []).length < 15) {
  throw new Error("Compatibility fixture coverage is incomplete.");
}
if ((fixtures.qolUi ?? []).length < 15) {
  throw new Error("QOL UI fixture coverage is incomplete.");
}
requireText("function getRuntimeDiagnostic(", "runtime diagnostic API");
requireText("function getCombatStateFlagRecord(", "flag namespace resolver");
requireText("function getStoredDocumentFlagRaw(", "legacy raw flag read");
requireText("function markLegacyCombatStateMigrationComplete(", "migration tombstone");
requireText("game.cybermancyGMQOL = qolApi;", "canonical global API");
requireText("game.cybermancyGMInspector = qolApi;", "legacy global API alias");
requireText("tokenControl.tools.cybermancyGMQOL", "canonical Scene control");
requireText("function getReleaseCandidateDiagnostic(", "legacy RC diagnostic API alias");
requireText("function renderRuntimeDiagnostics(", "runtime diagnostic UI");
if ((fixtures.qolUiPatch0241 ?? []).length < 7) {
  throw new Error("v0.24.1 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0242 ?? []).length < 6) {
  throw new Error("v0.24.2 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0243 ?? []).length < 5) {
  throw new Error("v0.24.3 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.directWriteback ?? []).length < 15) {
  throw new Error("v0.25 direct write-back fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0251 ?? []).length < 15) {
  throw new Error("v0.25.1 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0252 ?? []).length < 12) {
  throw new Error("v0.25.2 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0253 ?? []).length < 10) {
  throw new Error("v0.25.3 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0254 ?? []).length < 7) {
  throw new Error("v0.25.4 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.pcRoster ?? []).length < 16) {
  throw new Error("v0.26 PC roster fixture coverage is incomplete.");
}
if ((fixtures.transactionDialogs026 ?? []).length < 12) {
  throw new Error("v0.26 transaction dialog fixture coverage is incomplete.");
}
if ((fixtures.qolUiPatch0261 ?? []).length < 10) {
  throw new Error("v0.26.1 QOL patch fixture coverage is incomplete.");
}
if ((fixtures.qolPatch0262 ?? []).length < 8) {
  throw new Error("v0.26.2 patch fixture coverage is incomplete.");
}
if ((fixtures.qolPatch0263 ?? []).length < 8) {
  throw new Error("v0.26.3 patch fixture coverage is incomplete.");
}
if ((fixtures.releaseCandidateRc1 ?? []).length < 20) {
  throw new Error("v1.0.0-rc1 release-candidate fixture coverage is incomplete.");
}
if ((fixtures.releaseCandidateRc2 ?? []).length < 15) {
  throw new Error("v1.0.0-rc2 release-candidate fixture coverage is incomplete.");
}
if ((fixtures.releaseCandidateRc3 ?? []).length < 8) {
  throw new Error("v1.0.0-rc3 release-candidate fixture coverage is incomplete.");
}
if ((fixtures.v1Release ?? []).length < 15) {
  throw new Error("v1.0 release fixture coverage is incomplete.");
}
if ((fixtures.v101LegacyScopeHotfix ?? []).length < 9) {
  throw new Error("v1.0.1 legacy-scope hotfix fixture coverage is incomplete.");
}
if (fixtures.grants.length < 3) {
  throw new Error("Grant fixture coverage is incomplete.");
}
if (fixtures.fear.length < 3) {
  throw new Error("Fear fixture coverage is incomplete.");
}

console.log("Cybermancy GM QOL v1.0.1 source regression validator: PASS");
