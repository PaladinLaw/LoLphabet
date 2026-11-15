// Lists every account (id, name, email) straight from the database. Handy for finding the id to put in ADMIN_USER_IDS.
//   docker compose run --rm lol-tracker node --disable-warning=ExperimentalWarning list-users.js
"use strict";
const path = require("path"), { DatabaseSync } = require("node:sqlite");
const dir = process.env.DATA_DIR || (process.env.DATA_FILE ? path.dirname(process.env.DATA_FILE) : path.join(__dirname, "data"));
const db = new DatabaseSync(path.join(dir, "lolphabet.db"), { readOnly: true });
for (const r of db.prepare("SELECT id,name,email FROM users ORDER BY name").all()) console.log(String(r.id).padEnd(26) + String(r.name || "").padEnd(26) + (r.email || ""));
