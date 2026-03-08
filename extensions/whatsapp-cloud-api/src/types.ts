/**
 * Type definitions for the WhatsApp Cloud API channel plugin.
 */

/** Raw channel config from openclaw.json channels.whatsapp-cloud-api */
export interface WaCloudChannelConfig {
  enabled?: boolean;
  accessToken?: string;
  appSecret?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  baseUrl?: string;
  webhookPath?: string;
  dmPolicy?: "open" | "allowlist" | "pairing";
  allowFrom?: string | string[];
  botName?: string;
  accounts?: Record<string, WaCloudAccountRaw>;
}

/** Raw per-account config (overrides base config) */
export interface WaCloudAccountRaw {
  enabled?: boolean;
  accessToken?: string;
  appSecret?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  baseUrl?: string;
  webhookPath?: string;
  dmPolicy?: "open" | "allowlist" | "pairing";
  allowFrom?: string | string[];
  botName?: string;
}

/** Fully resolved account config with defaults applied */
export interface ResolvedWaCloudAccount {
  accountId: string;
  enabled: boolean;
  accessToken: string;
  appSecret: string;
  phoneNumberId: string;
  verifyToken: string;
  baseUrl: string;
  webhookPath: string;
  dmPolicy: "open" | "allowlist" | "pairing";
  allowFrom: string[];
  botName: string;
}

/** Meta webhook payload (inbound) */
export interface MetaWebhookPayload {
  object: string;
  entry?: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id?: string;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value?: MetaWebhookValue;
  field?: string;
}

export interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MetaWebhookMessage[];
  statuses?: unknown[];
}

export interface MetaWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  reaction?: { message_id: string; emoji: string };
}
