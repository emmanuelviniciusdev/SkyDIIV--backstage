#!/usr/bin/env node
"use strict";

const fs = require("fs");

const header = process.env.TOML_SECTION;
if (!header) {
  console.error("TOML_SECTION is required");
  process.exit(1);
}

const keys = process.argv.slice(2);
const overlay = {};
for (const key of keys) {
  const value = process.env[key];
  if (typeof value === "string" && value.length > 0) overlay[key] = value;
}
if (!Object.keys(overlay).length) process.exit(0);

const toLine = (key, value) => `${key} = ${JSON.stringify(String(value))}`;
const tomlPath = "wrangler.toml";
const toml = fs.readFileSync(tomlPath, "utf8");
const rows = toml.split("\n");
const start = rows.findIndex((line) => line.trim() === header);

if (start < 0) {
  const lines = Object.entries(overlay).map(([key, value]) => toLine(key, value));
  fs.writeFileSync(tomlPath, `${toml.trimEnd()}\n\n${header}\n${lines.join("\n")}\n`);
  process.exit(0);
}

let end = start + 1;
while (end < rows.length && !/^\s*\[/.test(rows[end])) end += 1;

const pending = { ...overlay };
for (let i = start + 1; i < end; i += 1) {
  const match = rows[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!match || !Object.prototype.hasOwnProperty.call(pending, match[1])) continue;
  rows[i] = toLine(match[1], pending[match[1]]);
  delete pending[match[1]];
}

const inserts = Object.entries(pending).map(([key, value]) => toLine(key, value));
if (inserts.length) rows.splice(start + 1, 0, ...inserts);
fs.writeFileSync(tomlPath, rows.join("\n"));
