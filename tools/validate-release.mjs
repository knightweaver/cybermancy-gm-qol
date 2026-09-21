import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const s = {
  preamble: read("scripts/src/00-preamble.js"),
  state: read("scripts/src/20-state.js"),
  fear: read("scripts/src/10-fear.js"),
  combat: read("scripts/src/68-combat-state.js"),
  compatibility: read("scripts/src/69-compatibility.js"),
  rendering: read("scripts/src/70-rendering.js"),
  hooks: read("scripts/src/90-hooks.js"),
  bundle: read("scripts/bundle.js")
};

const req = (text, needle, label) => {
  if (!text.includes(needle)) throw new Error(`Release gate failed: ${label}`);
};
const forbid = (text, needle, label) => {
  if (text.includes(needle)) throw new Error(`Release gate failed: ${label}`);
};

req(s.preamble, 'const MODULE_ID = "cybermancy-gm-qol";', "canonical module id");
req(s.preamble, 'const LEGACY_MODULE_ID = "cybermancy-gm-inspector";', "legacy id constant");
req(s.preamble, 'const VERSION = "1.0.1";', "version");
req(s.preamble, "const COMBAT_STATE_SCHEMA_VERSION = 14;", "schema");
req(s.preamble, 'const LEGACY_MIGRATION_FLAG = "legacyCombatStateMigrated";', "migration marker");

req(s.state, "function getStoredDocumentFlagRaw(", "legacy raw read");
req(s.state, "document.toObject(false)", "serialized Scene read");
req(s.state, "function getCombatStateFlagRecord(", "flag resolver");
req(s.state, "function markLegacyCombatStateMigrationComplete(", "migration tombstone");
req(s.state, "if (migrationComplete)", "legacy resurrection guard");
req(s.state, "markLegacyCombatStateMigrationComplete(scene)", "reset/migration marker use");

forbid(s.state, "scene.getFlag(LEGACY_MODULE_ID", "inactive legacy getFlag");
forbid(s.state, "scene.unsetFlag(LEGACY_MODULE_ID", "inactive legacy unsetFlag");
forbid(s.state, ".getFlag(LEGACY_MODULE_ID", "inactive legacy getFlag any receiver");
forbid(s.state, ".unsetFlag(LEGACY_MODULE_ID", "inactive legacy unsetFlag any receiver");

req(s.hooks, "game.cybermancyGMQOL = qolApi;", "canonical API");
req(s.hooks, "game.cybermancyGMInspector = qolApi;", "legacy API alias");
req(s.compatibility, "function getRuntimeDiagnostic(", "runtime diagnostics");
req(s.rendering, "${renderRuntimeDiagnostics()}", "diagnostics UI");

// rc3 functional fixes remain.
req(s.fear, 'changeNativeFear(-1, "QOL manual Fear control")', "manual Fear spend");
req(s.combat, 'foundry.utils.getProperty(actor, "system.evasion")', "PC Evasion");
req(s.rendering, "state.evasion?.available", "safe PC Evasion");

// Expected v1.0.1 write surface:
// +1 valid canonical setFlag for migration tombstone,
// -1 invalid legacy unsetFlag call.
const counts = {
  settings: s.bundle.split("game.settings.set(").length - 1,
  setFlag: s.bundle.split(".setFlag(").length - 1,
  unsetFlag: s.bundle.split(".unsetFlag(").length - 1,
  chat: s.bundle.split("ChatMessage.create(").length - 1,
  updateEmbedded: s.bundle.split(".updateEmbeddedDocuments(").length - 1,
  deleteEmbedded: s.bundle.split(".deleteEmbeddedDocuments(").length - 1,
  actorUpdate: s.bundle.split("actor.update(").length - 1,
  toggleStatus: s.bundle.split(".toggleStatusEffect(").length - 1
};
const expected = {
  settings: 1,
  setFlag: 4,
  unsetFlag: 2,
  chat: 0,
  updateEmbedded: 0,
  deleteEmbedded: 1,
  actorUpdate: 1,
  toggleStatus: 2
};
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected write surface: ${JSON.stringify(counts)}`);
}

console.log("Cybermancy GM QOL v1.0.1 release validation: PASS");
console.log(JSON.stringify(counts));
