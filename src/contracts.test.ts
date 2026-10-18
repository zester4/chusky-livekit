import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";
import { signForTest } from "./brainClient.js";
import { createLiveKitTools } from "./tools.js";
import type { LiveKitToolState } from "./tools.js";
import { parseCallMetadata } from "./types.js";

test("LiveKit is disabled by default and does not require credentials", () => {
  const names = [
    "LIVEKIT_ENABLED", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_BRAIN_SECRET",
    "LIVEKIT_MODEL_LLM", "LIVEKIT_TURN_MIN_DELAY_MS", "LIVEKIT_TURN_MAX_DELAY_MS",
    "LIVEKIT_PREEMPTIVE_TTS",
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    const config = loadConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.agentName, "chusky-voice");
    assert.equal(config.llmModel, "google/gemma-4-31b-it");
    assert.equal(config.turnMinDelayMs, 300);
    assert.equal(config.turnMaxDelayMs, 2_000);
    assert.equal(config.preemptiveTts, false);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("enabled LiveKit configuration fails closed without credentials", () => {
  const saved = process.env.LIVEKIT_ENABLED;
  process.env.LIVEKIT_ENABLED = "true";
  try { assert.throws(() => loadConfig(), /LIVEKIT_API_KEY/); }
  finally {
    if (saved === undefined) delete process.env.LIVEKIT_ENABLED;
    else process.env.LIVEKIT_ENABLED = saved;
  }
});

test("call metadata is strict and excludes secrets", () => {
  const metadata = parseCallMetadata(JSON.stringify({
    version: 1,
    callId: "lvc_12345678",
    userId: 7906015891,
    direction: "outbound",
    purpose: "Confirm the repair appointment",
    callProfile: "business",
    participantIdentity: "contact-lvc_12345678",
    contactName: "Collins",
    organization: "Example Ltd",
  }));
  assert.equal(metadata.callId, "lvc_12345678");
  assert.equal("secret" in metadata, false);
  assert.throws(() => parseCallMetadata(JSON.stringify({ ...metadata, callId: "bad" })), /callId/);
  assert.throws(() => parseCallMetadata(JSON.stringify({ ...metadata, userId: 0 })), /userId/);
});

test("brain signatures are deterministic over timestamp, nonce, and raw body", () => {
  const first = signForTest("a".repeat(32), "1700000000000", "nonce_1", '{"question":"hello"}');
  const second = signForTest("a".repeat(32), "1700000000000", "nonce_1", '{"question":"hello"}');
  const changedBody = signForTest("a".repeat(32), "1700000000000", "nonce_1", '{"question":"goodbye"}');
  assert.equal(first, second);
  assert.notEqual(first, changedBody);
  assert.match(first, /^sha256=[0-9a-f]{64}$/);
});

test("consult tool emits progress before the Chusky brain request", async () => {
  const events: string[] = [];
  const state = {
    config: loadConfig(),
    turns: 0,
    toolCalls: 0,
    brain: {
      ask: async () => {
        events.push("brain");
        return { answer: "The action is complete.", approvalRequired: false, endCall: false };
      },
    },
  } as unknown as LiveKitToolState;
  const [consult] = createLiveKitTools(state);
  const result = await consult.execute(
    { question: "Check the appointment." },
    {
      ctx: {
        update: async (message: unknown) => {
          assert.equal(message, "I’m checking that now.");
          events.push("progress");
        },
      } as never,
      toolCallId: "tool_1",
      abortSignal: new AbortController().signal,
    },
  );
  assert.deepEqual(events, ["progress", "brain"]);
  assert.equal(result.answer, "The action is complete.");
});

