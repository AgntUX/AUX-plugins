import { test } from "node:test";
import assert from "node:assert/strict";

import {
  trialExpired,
  lapsed,
  subscriptionCanceled,
  noSession,
  deviceLimit,
  expiredRestart,
  noCacheNoNetwork,
  invalidSession,
  info,
  err,
} from "../lib/ui.mjs";

test("trialExpired: includes provided URL", () => {
  const m = trialExpired("https://example.com/upgrade");
  assert.match(m, /https:\/\/example\.com\/upgrade/);
  assert.match(m, /trial has ended/i);
});

test("trialExpired: falls back to default URL", () => {
  const m = trialExpired();
  assert.match(m, /https:\/\/app\.agntux\.ai\/upgrade/);
});

test("lapsed: includes URL", () => {
  const m = lapsed("https://x/billing");
  assert.match(m, /billing failed/i);
  assert.match(m, /https:\/\/x\/billing/);
});

test("subscriptionCanceled: default URL", () => {
  assert.match(subscriptionCanceled(), /agntux\.ai\/billing/);
});

test("noSession: mentions connect URL", () => {
  assert.match(noSession(), /connect/);
});

test("deviceLimit: mentions devices URL", () => {
  assert.match(deviceLimit(), /devices/);
});

test("expiredRestart: mentions restart", () => {
  assert.match(expiredRestart(), /restart/i);
});

test("noCacheNoNetwork: includes reason", () => {
  assert.match(noCacheNoNetwork("ECONNREFUSED"), /ECONNREFUSED/);
});

test("invalidSession: mentions re-auth", () => {
  assert.match(invalidSession(), /re-authenticate/i);
});

test("info / err: write to stderr without throwing", () => {
  // Capture stderr
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try {
    info("hello");
    err("oops");
    assert.match(captured, /hello/);
    assert.match(captured, /oops/);
  } finally {
    process.stderr.write = original;
  }
});
