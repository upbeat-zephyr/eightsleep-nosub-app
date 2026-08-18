import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithAuth, setHeatingLevel } from "./eight";
import type { Token } from "./types";

const token: Token = {
  eightAccessToken: "access-token",
  eightRefreshToken: "refresh-token",
  eightExpiresAtPosix: Date.now() + 60_000,
  eightUserId: "user-1",
};

void test("fetchWithAuth treats empty 200 bodies as success", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("", {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const { z } = await import("zod");
  await assert.doesNotReject(() =>
    fetchWithAuth(
      "https://app-api.8slp.net/v1/users/user-1/temperature",
      token,
      z.object({}),
    ),
  );
});

void test("fetchWithAuth treats non-JSON 200 bodies as success for empty schemas", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

  const { z } = await import("zod");
  await assert.doesNotReject(() =>
    fetchWithAuth(
      "https://app-api.8slp.net/v1/users/user-1/temperature",
      token,
      z.object({}),
    ),
  );
});

void test("setHeatingLevel turns the side on and sets level in one PUT", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let captured: { url: string; method?: string; body: string } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = {
      url: String(input),
      method: init?.method,
      body: String(init?.body),
    };
    return new Response("", { status: 200 });
  };

  await setHeatingLevel(token, "user-1", 50, 1800);
  assert.equal(
    captured?.url,
    "https://app-api.8slp.net/v1/users/user-1/temperature",
  );
  assert.equal(captured?.method, "PUT");
  assert.deepEqual(JSON.parse(captured?.body ?? "{}"), {
    currentState: { type: "smart" },
    currentLevel: 50,
    timeBased: { level: 50, durationSeconds: 1800 },
  });
});
