export type LiveKitCallDirection = "inbound" | "outbound";
export type LiveKitCallProfile = "personal" | "business";

export interface LiveKitCallMetadata {
  version: 1;
  callId: string;
  userId: number;
  direction: LiveKitCallDirection;
  purpose: string;
  callProfile: LiveKitCallProfile;
  participantIdentity?: string;
  contactName?: string;
  organization?: string;
  verification?: "public" | "identified" | "verified";
}

const CALL_ID = /^lvc_[A-Za-z0-9_-]{8,128}$/;
const IDENTITY = /^[A-Za-z0-9._:@+-]{1,128}$/;

function boundedString(value: unknown, name: string, max: number, required = true): string | undefined {
  if (typeof value !== "string") {
    if (!required) return undefined;
    throw new Error(`${name} is required`);
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !normalized) throw new Error(`${name} is required`);
  if (normalized.length > max) throw new Error(`${name} is too long`);
  return normalized || undefined;
}

export function parseCallMetadata(raw: string): LiveKitCallMetadata {
  if (!raw || Buffer.byteLength(raw, "utf8") > 16 * 1024) throw new Error("LiveKit job metadata is missing or too large");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("LiveKit job metadata is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("LiveKit job metadata must be an object");
  const input = value as Record<string, unknown>;
  if (input.version !== 1) throw new Error("Unsupported LiveKit job metadata version");
  const callId = boundedString(input.callId, "callId", 128) as string;
  if (!CALL_ID.test(callId)) throw new Error("LiveKit callId is invalid");
  const userId = input.userId;
  if (!Number.isSafeInteger(userId) || (userId as number) <= 0) throw new Error("LiveKit userId is invalid");
  if (input.direction !== "inbound" && input.direction !== "outbound") throw new Error("LiveKit direction is invalid");
  if (input.callProfile !== "personal" && input.callProfile !== "business") throw new Error("LiveKit callProfile is invalid");
  const participantIdentity = boundedString(input.participantIdentity, "participantIdentity", 128, false);
  if (participantIdentity && !IDENTITY.test(participantIdentity)) throw new Error("LiveKit participantIdentity is invalid");
  const verification = input.verification === undefined ? undefined : input.verification;
  if (verification !== undefined && verification !== "public" && verification !== "identified" && verification !== "verified") throw new Error("LiveKit verification is invalid");
  return {
    version: 1,
    callId,
    userId: userId as number,
    direction: input.direction,
    purpose: boundedString(input.purpose, "purpose", 1_000) as string,
    callProfile: input.callProfile,
    ...(participantIdentity ? { participantIdentity } : {}),
    ...(boundedString(input.contactName, "contactName", 200, false) ? { contactName: boundedString(input.contactName, "contactName", 200, false) } : {}),
    ...(boundedString(input.organization, "organization", 240, false) ? { organization: boundedString(input.organization, "organization", 240, false) } : {}),
    ...(verification ? { verification } : {}),
  };
}

export function metadataForLog(metadata: LiveKitCallMetadata): Record<string, string | number> {
  return { callId: metadata.callId, userId: metadata.userId, direction: metadata.direction, profile: metadata.callProfile };
}

