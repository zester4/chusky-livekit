# Chusky LiveKit voice runtime

This is an optional LiveKit Agents 1.x worker for Chusky. It is deliberately a
separate process from the Chusky HTTP service:

```text
LiveKit SIP / room
        |
        v
LiveKit AgentSession (audio, VAD, turn-taking, STT, LLM, TTS)
        |
        v
Signed Chusky brain bridge
        |
        v
Chusky memory, JEV, native tools, Composio, Treg, Monid, approvals, receipts
```

The worker never reads Chusky Redis, Neon, or provider credentials directly.
It receives an opaque call session and calls the Chusky brain bridge with a
short-lived request signature. Chusky remains responsible for authorization,
memory isolation, tool selection, approvals, durable call state, and verified
outcomes.

## Runtime

The worker targets the official `@livekit/agents` Node.js distribution and
LiveKit Inference model descriptors. It uses explicit dispatch through
`LIVEKIT_AGENT_NAME`; automatic dispatch is intentionally not used for
production calls.

The initial implementation exposes one scoped `consult_chusky` function to the
LiveKit model. This avoids copying the entire Chusky tool catalogue into a
voice worker and prevents a second, unscoped memory/tool system from forming.
The function uses LiveKit's non-blocking tool update protocol: it immediately
acknowledges the work, lets the caller continue speaking, and delivers the
Chusky result later as a deferred update. Chusky can return a verified answer,
a provider receipt, an approval pause, or a bounded failure. The worker speaks
only the returned caller-safe answer.

The default LLM is `google/gemma-4-31b-it`, LiveKit's documented
latency-optimized voice default. It remains an environment override so staging
can benchmark tool-call accuracy against another model.

## Local checks

From this directory:

```sh
npm install
npm run typecheck
npm run build
```

The worker will fail closed until all required credentials and the Chusky brain
secret are configured. No real call is placed by the build or typecheck.

## Telephony rollout

`src/controlPlane.ts` contains the server-side adapter for the telephony step.
The intended lifecycle is:

1. Chusky creates a durable `lvc_*` call record and validates the owner,
   destination, profile, purpose, and approval boundary.
2. `LiveKitControlPlane.startOutboundCall()` explicitly dispatches the named
   worker, then starts the SIP participant. Retries reuse the same call ID and
   room name; the adapter removes a dispatch if dialing fails.
3. For inbound calls, the control plane resolves the called number to the
   correct account before creating a call record, then calls
   `dispatchInboundCall()` for that room. Caller verification remains a
   Chusky policy decision; it is never inferred from SIP metadata.
4. Call completion updates the Chusky call record and schedules the existing
   outcome/follow-up pipeline. The LiveKit worker does not own durable state.

This is intentionally not enabled by the scaffold alone. The remaining
activation work is the Chusky native-call adapter and the LiveKit SIP trunk/
dispatch-rule provisioning for each environment. Twilio and Bland remain
independent providers throughout rollout.
