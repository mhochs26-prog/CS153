const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const TOKENS_PATH = path.join(DATA_DIR, "tokens.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TOKENS_PATH)) fs.writeFileSync(TOKENS_PATH, JSON.stringify({}), "utf8");
}

function readAll() {
  ensureDataDir();
  const raw = fs.readFileSync(TOKENS_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(obj) {
  ensureDataDir();
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function getUserTokens(discordUserId) {
  const all = readAll();
  return all[discordUserId] ?? null;
}

function setUserTokens(discordUserId, tokens) {
  const all = readAll();
  all[discordUserId] = tokens;
  writeAll(all);
}

function clearUserTokens(discordUserId) {
  const all = readAll();
  delete all[discordUserId];
  writeAll(all);
}

module.exports = { getUserTokens, setUserTokens, clearUserTokens };

