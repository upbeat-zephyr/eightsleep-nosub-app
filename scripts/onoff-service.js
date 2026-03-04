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

function formatTime(date) {
  return date.toISOString().slice(11, 16);
}

function localNow(config) {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: config.timezone ?? "UTC" }),
  );
}

function shouldRun(config, now) {
  const hhmm = formatTime(now);
  if (hhmm === config.off_time) return "off";
  if (hhmm === config.on_time) return "on";
  return null;
}

let lastAction = null;

async function tick() {
  const config = loadConfig();
  const now = localNow(config);
  const action = shouldRun(config, now);
  if (!action || lastAction === `${action}-${formatTime(now)}`) {
    return;
  }

  try {
    const res = await fetch(
      `${SERVICE_URL}?action=${action}&testTime=${Math.floor(Date.now() / 1000)}`,
      {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`Failed to run ${action}:`, res.status, body);
    } else {
      console.log(`[${new Date().toISOString()}] ran ${action}`);
      lastAction = `${action}-${formatTime(now)}`;
    }
  } catch (error) {
    console.error(`Error calling ${action}:`, error);
  }
}

console.log(
  `Starting on/off service; using config at ${CONFIG_PATH} and endpoint ${SERVICE_URL}`,
);
tick();
setInterval(tick, 60 * 1000);
