#!/usr/bin/env node
// @ts-nocheck
import fs from "fs";
import path from "path";
import process from "process";

const CONFIG_PATH =
  process.env.ONOFF_CONFIG_PATH ??
  path.join(process.cwd(), "config", "onoff-config.json");
const SERVICE_URL =
  process.env.SERVICE_URL ?? "http://localhost:3000/api/temperatureCron";
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error("CRON_SECRET is required to call the API.");
  process.exit(1);
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

async function tick() {
  // Keep config validation behavior for local setups that still use this file.
  loadConfig();

  try {
    const res = await fetch(
      `${SERVICE_URL}?testTime=${Math.floor(Date.now() / 1000)}`,
      {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("Failed to run scheduler ping:", res.status, body);
    } else {
      const body = await res.text();
      console.log(`[${new Date().toISOString()}] scheduler ping ok: ${body}`);
    }
  } catch (error) {
    console.error("Error calling scheduler endpoint:", error);
  }
}

console.log(
  `Starting on/off service; using config at ${CONFIG_PATH} and scheduler endpoint ${SERVICE_URL}`,
);
tick();
setInterval(tick, 60 * 1000);
