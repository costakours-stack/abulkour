// Writes server/seed/seed.json.gz from the local database (price history + active models).
// Run after training locally:  npm run export-seed
import { mkdirSync } from "node:fs";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { exportSeed } from "../src/db/seed.js";
import { HistoryStore } from "../src/history/HistoryStore.js";
import { ModelRegistry } from "../src/ml/ModelRegistry.js";

const db = openDatabase(config.databasePath);
new HistoryStore(db, null, null); // ensure tables exist
new ModelRegistry(db);
mkdirSync("seed", { recursive: true });
const out = exportSeed(db, "seed/seed.json.gz");
console.log(`Exported ${out.bars} daily bars and ${out.models} active models to seed/seed.json.gz`);
