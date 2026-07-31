"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

const VERSION_DATE_PATTERN = /\+(\d{8})(?:$|[^0-9])/;

function safeVersionName(version) {
  return String(version || "").replace(/[^a-z0-9._+-]/gi, "_");
}

function versionDate(name) {
  const match = String(name || "").match(VERSION_DATE_PATTERN);
  return match ? match[1] : "";
}

async function pruneMtgjsonCache(cacheRoot, activeVersion, options = {}) {
  const keepVersions = Math.max(1, Math.floor(Number(options.keepVersions) || 2));
  const activeName = safeVersionName(activeVersion);
  if (!versionDate(activeName)) return { kept: [], removed: [] };
  let entries;
  try {
    entries = await fsp.readdir(cacheRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return { kept: [], removed: [] };
    throw error;
  }
  const versions = entries
    .filter((entry) => entry.isDirectory() && versionDate(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => versionDate(b).localeCompare(versionDate(a)) || b.localeCompare(a));
  const kept = [activeName, ...versions.filter((name) => name !== activeName)].slice(0, keepVersions);
  const keepSet = new Set(kept);
  const removed = versions.filter((name) => !keepSet.has(name));
  for (const name of removed) {
    await fsp.rm(path.join(cacheRoot, name), { recursive: true, force: true });
  }
  return { kept: versions.filter((name) => keepSet.has(name)), removed };
}

module.exports = { pruneMtgjsonCache, safeVersionName, versionDate };
