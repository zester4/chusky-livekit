import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import type { LiveKitConfig } from "./config.js";
import { parseCallMetadata, type LiveKitCallMetadata } from "./types.js";

const E164 = /^\+[1-9]\d{7,14}$/;

function apiHost(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString().replace(/\/$/, "");
}

function roomName(callId: string): string {
  if (!/^lvc_[A-Za-z0-9_-]{8,128}$/.test(callId)) throw new Error("Invalid LiveKit call ID");
  return `chusky-${callId}`;
}

/**
 * Server-side LiveKit control plane. Chusky should create its durable
 * PhoneCallRecord before invoking this adapter, then persist the returned room,
 * dispatch, and SIP participant IDs. Every retry must reuse the same call ID.
 */
export class LiveKitControlPlane {
  private readonly dispatch: AgentDispatchClient;
  private readonly sip: SipClient;
  private readonly rooms: RoomServiceClient;

  constructor(private readonly config: LiveKitConfig) {
    if (!config.enabled) throw new Error("LiveKit is disabled");
    const host = apiHost(config.url);
    this.dispatch = new AgentDispatchClient(host, config.apiKey, config.apiSecret);
    this.sip = new SipClient(host, config.apiKey, config.apiSecret);
    this.rooms = new RoomServiceClient(host, config.apiKey, config.apiSecret);
  }

  async startOutboundCall(input: { metadata: LiveKitCallMetadata; destination: string; trunkId: string; fromNumber?: string }): Promise<{ roomName: string; dispatchId: string; participantIdentity: string; sipParticipantId: string }> {
    if (!E164.test(input.destination)) throw new Error("LiveKit destination must be an E.164 number");
    if (!input.trunkId.trim()) throw new Error("A LiveKit outbound SIP trunk is required");
    const metadata = parseCallMetadata(JSON.stringify(input.metadata));
    const room = roomName(metadata.callId);
    const participantIdentity = `contact-${metadata.callId}`;
    const dispatch = await this.dispatch.createDispatch(room, this.config.agentName, {
      metadata: JSON.stringify(metadata),
      deployment: this.config.deployment,
    });
    try {
      const participant = await this.sip.createSipParticipant(input.trunkId, input.destination, room, {
        fromNumber: input.fromNumber,
        participantIdentity,
        participantName: metadata.contactName ?? "Phone contact",
        participantMetadata: JSON.stringify(metadata),
        waitUntilAnswered: false,
        ringingTimeout: 45,
        maxCallDuration: 3_600,
        playDialtone: true,
      });
      return { roomName: room, dispatchId: dispatch.id, participantIdentity, sipParticipantId: participant.sipCallId ?? participant.participantId ?? participantIdentity };
    } catch (error) {
      await this.dispatch.deleteDispatch(dispatch.id, room).catch(() => undefined);
      throw error;
    }
  }

  /** Dispatch an already-routed inbound SIP room after Chusky resolves the
   * destination number to a tenant/account and creates its call record. */
  async dispatchInboundCall(input: { roomName: string; metadata: LiveKitCallMetadata }): Promise<{ dispatchId: string }> {
    if (!/^chusky-lvc_[A-Za-z0-9_-]{8,128}$/.test(input.roomName)) throw new Error("Invalid LiveKit inbound room name");
    const metadata = parseCallMetadata(JSON.stringify(input.metadata));
    const dispatch = await this.dispatch.createDispatch(input.roomName, this.config.agentName, {
      metadata: JSON.stringify(metadata),
      deployment: this.config.deployment,
    });
    return { dispatchId: dispatch.id };
  }

  async endCall(room: string, participantIdentity: string): Promise<void> {
    if (!/^chusky-lvc_[A-Za-z0-9_-]{8,128}$/.test(room) || !/^[A-Za-z0-9._:@+-]{1,128}$/.test(participantIdentity)) throw new Error("Invalid LiveKit call target");
    await this.rooms.removeParticipant(room, participantIdentity);
  }
}

