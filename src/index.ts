import { fileURLToPath } from "node:url";
import { cli, WorkerOptions } from "@livekit/agents";
import agent from "./agent.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

if (!config.enabled) {
  console.log(JSON.stringify({ level: "info", event: "livekit_disabled", agentName: config.agentName }));
} else {
  // LiveKit Agents reads the deployment label from its own environment
  // variable when it registers the worker. Keep Chusky's public configuration
  // name (`LIVEKIT_DEPLOYMENT`) while explicitly forwarding it to the SDK;
  // otherwise a staging worker registers with an empty deployment and staging
  // dispatches never reach it.
  process.env.LIVEKIT_AGENT_DEPLOYMENT = config.deployment;
  // Explicit agentName enables deterministic dispatch. The worker must be
  // assigned by the Chusky control plane; it never auto-joins arbitrary rooms.
  await cli.runApp(new WorkerOptions({
    agent: fileURLToPath(new URL("./agent.js", import.meta.url)),
    agentName: config.agentName,
    wsURL: config.url,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    logLevel: config.logLevel,
    production: config.deployment === "production",
  }));
}

