import "dotenv/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LiveKitConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  apiSecret: string;
  agentName: string;
  deployment: string;
  brainUrl: string;
  brainSecret: string;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  brainTimeoutMs: number;
  turnMinDelayMs: number;
  turnMaxDelayMs: number;
  interruptionMinDurationMs: number;
  preemptiveTts: boolean;
  maxTurns: number;
  maxToolCalls: number;
  recordTraces: boolean;
  logLevel: LogLevel;
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = env(name);
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boundedIdentifier(name: string, fallback: string): string {
  const value = env(name, fallback);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${name} must be a bounded identifier`);
  return value;
}

function endpoint(name: string, fallback: string, protocols: readonly string[]): string {
  const value = env(name, fallback);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must be a clean ${protocols.join(" or ")} URL`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requiredWhenEnabled(name: string, enabled: boolean): string {
  const value = env(name);
  if (enabled && !value) throw new Error(`${name} is required when LIVEKIT_ENABLED=true`);
  return value;
}

export function loadConfig(): LiveKitConfig {
  const enabled = booleanEnv("LIVEKIT_ENABLED", false);
  const url = endpoint("LIVEKIT_URL", "wss://localhost", ["ws:", "wss:"]);
  const brainUrl = endpoint("LIVEKIT_BRAIN_URL", "http://localhost:3000/internal/livekit/brain", ["http:", "https:"]);
  const config: LiveKitConfig = {
    enabled,
    url,
    apiKey: requiredWhenEnabled("LIVEKIT_API_KEY", enabled),
    apiSecret: requiredWhenEnabled("LIVEKIT_API_SECRET", enabled),
    agentName: boundedIdentifier("LIVEKIT_AGENT_NAME", "chusky-voice"),
    deployment: boundedIdentifier("LIVEKIT_DEPLOYMENT", "production"),
    brainUrl,
    brainSecret: requiredWhenEnabled("LIVEKIT_BRAIN_SECRET", enabled),
    sttModel: env("LIVEKIT_MODEL_STT", "deepgram/nova-3"),
    // LiveKit documents Gemma 4 31B as its latency-optimized voice default.
    // Keep this configurable so a deployment can benchmark another model.
    llmModel: env("LIVEKIT_MODEL_LLM", "google/gemma-4-31b-it"),
    ttsModel: env("LIVEKIT_MODEL_TTS", "cartesia/sonic-3"),
    ttsVoice: env("LIVEKIT_TTS_VOICE", "9626c31c-bec5-4cca-b8aa-f8ba9e84c8bc"),
    brainTimeoutMs: boundedInt("LIVEKIT_BRAIN_TIMEOUT_MS", 12_000, 1_000, 30_000),
    turnMinDelayMs: boundedInt("LIVEKIT_TURN_MIN_DELAY_MS", 300, 100, 1_500),
    turnMaxDelayMs: boundedInt("LIVEKIT_TURN_MAX_DELAY_MS", 2_000, 500, 5_000),
    interruptionMinDurationMs: boundedInt("LIVEKIT_INTERRUPTION_MIN_DURATION_MS", 250, 100, 1_000),
    preemptiveTts: booleanEnv("LIVEKIT_PREEMPTIVE_TTS", false),
    maxTurns: boundedInt("LIVEKIT_MAX_TURNS", 120, 1, 600),
    maxToolCalls: boundedInt("LIVEKIT_MAX_TOOL_CALLS", 24, 1, 120),
    recordTraces: booleanEnv("LIVEKIT_RECORD_TRACES", false),
    logLevel: (() => {
      const level = env("LIVEKIT_LOG_LEVEL", "info");
      if (!["debug", "info", "warn", "error"].includes(level)) throw new Error("LIVEKIT_LOG_LEVEL must be debug, info, warn, or error");
      return level as LogLevel;
    })(),
  };
  return config;
}

