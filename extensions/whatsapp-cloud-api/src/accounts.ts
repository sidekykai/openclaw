/**
 * Account resolution: reads config from channels.whatsapp-cloud-api,
 * merges per-account overrides, falls back to environment variables.
 */

import type { WaCloudChannelConfig, ResolvedWaCloudAccount } from "./types.js";

/** Extract the channel config from the full OpenClaw config object. */
function getChannelConfig(cfg: any): WaCloudChannelConfig | undefined {
  return cfg?.channels?.["whatsapp-cloud-api"];
}

/** Parse allowFrom from string or array to string[]. */
function parseAllowFrom(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * List all configured account IDs for this channel.
 * Returns ["default"] if base config has credentials, plus any named accounts.
 */
export function listAccountIds(cfg: any): string[] {
  const channelCfg = getChannelConfig(cfg);
  if (!channelCfg) return [];

  const ids = new Set<string>();

  const hasBaseToken = channelCfg.accessToken || process.env.WHATSAPP_CLOUD_API_TOKEN;
  if (hasBaseToken) {
    ids.add("default");
  }

  if (channelCfg.accounts) {
    for (const id of Object.keys(channelCfg.accounts)) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * Resolve a specific account by ID with full defaults applied.
 * Falls back to env vars for the "default" account.
 */
export function resolveAccount(cfg: any, accountId?: string | null): ResolvedWaCloudAccount {
  const channelCfg = getChannelConfig(cfg) ?? {};
  const id = accountId || "default";

  // Account-specific overrides
  const accountOverride = channelCfg.accounts?.[id] ?? {};

  // Env var fallbacks
  const envAccessToken = process.env.WHATSAPP_CLOUD_API_TOKEN ?? "";
  const envAppSecret = process.env.WHATSAPP_CLOUD_API_APP_SECRET ?? "";
  const envPhoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID ?? "";
  const envVerifyToken = process.env.WHATSAPP_CLOUD_API_VERIFY_TOKEN ?? "";
  const envBaseUrl = process.env.WHATSAPP_CLOUD_API_BASE_URL ?? "";
  const envAllowFrom = process.env.WHATSAPP_CLOUD_API_ALLOW_FROM ?? "";
  const envBotName = process.env.OPENCLAW_BOT_NAME ?? "OpenClaw";

  return {
    accountId: id,
    enabled: accountOverride.enabled ?? channelCfg.enabled ?? true,
    accessToken: accountOverride.accessToken ?? channelCfg.accessToken ?? envAccessToken,
    appSecret: accountOverride.appSecret ?? channelCfg.appSecret ?? envAppSecret,
    phoneNumberId: accountOverride.phoneNumberId ?? channelCfg.phoneNumberId ?? envPhoneNumberId,
    verifyToken: accountOverride.verifyToken ?? channelCfg.verifyToken ?? envVerifyToken,
    baseUrl:
      accountOverride.baseUrl ?? channelCfg.baseUrl ?? (envBaseUrl || "https://graph.facebook.com"),
    webhookPath:
      accountOverride.webhookPath ?? channelCfg.webhookPath ?? "/webhook/whatsapp-cloud-api",
    dmPolicy: accountOverride.dmPolicy ?? channelCfg.dmPolicy ?? "open",
    allowFrom: parseAllowFrom(accountOverride.allowFrom ?? channelCfg.allowFrom ?? envAllowFrom),
    botName: accountOverride.botName ?? channelCfg.botName ?? envBotName,
  };
}
