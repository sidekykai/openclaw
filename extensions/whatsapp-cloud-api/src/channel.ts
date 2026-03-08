/**
 * WhatsApp Cloud API Channel Plugin for OpenClaw.
 *
 * Implements the ChannelPlugin interface following the Synology Chat pattern.
 */

import {
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  registerPluginHttpRoute,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { sendTextMessage } from "./api-client.js";
import { getWaCloudRuntime } from "./runtime.js";
import type { ResolvedWaCloudAccount } from "./types.js";
import { createWebhookHandler } from "./webhook-handler.js";

const CHANNEL_ID = "whatsapp-cloud-api";
const WaCloudConfigSchema = buildChannelConfigSchema(z.object({}).passthrough());

const activeRouteUnregisters = new Map<string, () => void>();

export function createWhatsAppCloudApiPlugin() {
  return {
    id: CHANNEL_ID,

    meta: {
      id: CHANNEL_ID,
      label: "WhatsApp Cloud API",
      selectionLabel: "WhatsApp Cloud API (Meta)",
      detailLabel: "WhatsApp Cloud API (Meta Business)",
      docsPath: "/channels/whatsapp-cloud-api",
      blurb: "Connect WhatsApp Business via the Meta Cloud API",
      order: 15,
    },

    capabilities: {
      chatTypes: ["direct" as const],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: false,
    },

    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

    configSchema: WaCloudConfigSchema,

    config: {
      listAccountIds: (cfg: any) => listAccountIds(cfg),

      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),

      defaultAccountId: (_cfg: any) => DEFAULT_ACCOUNT_ID,

      setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
        const channelConfig = cfg?.channels?.[CHANNEL_ID] ?? {};
        if (accountId === DEFAULT_ACCOUNT_ID) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              [CHANNEL_ID]: { ...channelConfig, enabled },
            },
          };
        }
        return setAccountEnabledInConfigSection({
          cfg,
          sectionKey: `channels.${CHANNEL_ID}`,
          accountId,
          enabled,
        });
      },
    },

    pairing: {
      idLabel: "whatsappPhoneNumber",
      normalizeAllowEntry: (entry: string) => entry.replace(/\D/g, "").trim(),
      notifyApproval: async ({ cfg, id }: { cfg: any; id: string }) => {
        const account = resolveAccount(cfg);
        if (!account.accessToken || !account.phoneNumberId) return;
        await sendTextMessage(
          account.baseUrl,
          account.accessToken,
          account.phoneNumberId,
          id,
          "OpenClaw: your access has been approved.",
        );
      },
    },

    security: {
      resolveDmPolicy: ({
        cfg,
        accountId,
        account,
      }: {
        cfg: any;
        accountId?: string | null;
        account: ResolvedWaCloudAccount;
      }) => {
        const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
        const channelCfg = (cfg as any).channels?.[CHANNEL_ID];
        const useAccountPath = Boolean(channelCfg?.accounts?.[resolvedAccountId]);
        const basePath = useAccountPath
          ? `channels.${CHANNEL_ID}.accounts.${resolvedAccountId}.`
          : `channels.${CHANNEL_ID}.`;
        return {
          policy: account.dmPolicy ?? "open",
          allowFrom: account.allowFrom ?? [],
          policyPath: `${basePath}dmPolicy`,
          allowFromPath: basePath,
          approveHint: "openclaw pairing approve whatsapp-cloud-api <phone>",
          normalizeEntry: (raw: string) => raw.replace(/\D/g, "").trim(),
        };
      },
      collectWarnings: ({ account }: { account: ResolvedWaCloudAccount }) => {
        const warnings: string[] = [];
        if (!account.accessToken) {
          warnings.push(
            "- WhatsApp Cloud API: accessToken is not configured. Outbound messages will fail.",
          );
        }
        if (!account.phoneNumberId) {
          warnings.push("- WhatsApp Cloud API: phoneNumberId is not configured.");
        }
        if (!account.appSecret) {
          warnings.push(
            "- WhatsApp Cloud API: appSecret is not configured. Webhook signature validation is disabled.",
          );
        }
        if (account.dmPolicy === "allowlist" && account.allowFrom.length === 0) {
          warnings.push(
            '- WhatsApp Cloud API: dmPolicy="allowlist" with empty allowFrom blocks all senders.',
          );
        }
        return warnings;
      },
    },

    messaging: {
      normalizeTarget: (target: string) => {
        const trimmed = target.trim();
        if (!trimmed) return undefined;
        // Strip non-digits (normalize phone number)
        return trimmed.replace(/\D/g, "");
      },
      targetResolver: {
        looksLikeId: (id: string) => {
          const trimmed = id?.trim();
          if (!trimmed) return false;
          // WhatsApp phone numbers are digits, optionally prefixed with +
          return /^\+?\d{7,15}$/.test(trimmed);
        },
        hint: "<phoneNumber>",
      },
    },

    directory: {
      self: async () => null,
      listPeers: async () => [],
      listGroups: async () => [],
    },

    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 4096,

      sendText: async ({ to, text, accountId, account: ctxAccount }: any) => {
        const account: ResolvedWaCloudAccount = ctxAccount ?? resolveAccount({}, accountId);

        if (!account.accessToken || !account.phoneNumberId) {
          throw new Error(
            "WhatsApp Cloud API credentials not configured (accessToken or phoneNumberId missing)",
          );
        }

        const ok = await sendTextMessage(
          account.baseUrl,
          account.accessToken,
          account.phoneNumberId,
          to,
          text,
        );
        if (!ok) {
          throw new Error("Failed to send message via WhatsApp Cloud API");
        }
        return {
          channel: CHANNEL_ID,
          messageId: `wa-${Date.now()}`,
          chatId: to,
        };
      },

      sendMedia: async ({ to, text, accountId, account: ctxAccount }: any) => {
        // Media not yet supported — send caption as text fallback.
        const account: ResolvedWaCloudAccount = ctxAccount ?? resolveAccount({}, accountId);
        if (!account.accessToken || !account.phoneNumberId) {
          throw new Error(
            "WhatsApp Cloud API credentials not configured (accessToken or phoneNumberId missing)",
          );
        }
        if (text) {
          await sendTextMessage(
            account.baseUrl,
            account.accessToken,
            account.phoneNumberId,
            to,
            text,
          );
        }
        return {
          channel: CHANNEL_ID,
          messageId: `wa-${Date.now()}`,
          chatId: to,
        };
      },
    },

    gateway: {
      startAccount: async (ctx: any) => {
        const { cfg, accountId, log, abortSignal } = ctx;
        const account = resolveAccount(cfg, accountId);

        if (!account.enabled) {
          log?.info?.(`WhatsApp Cloud API account ${accountId} is disabled, skipping`);
          return { stop: () => {} };
        }

        if (!account.accessToken || !account.phoneNumberId) {
          log?.warn?.(
            `WhatsApp Cloud API account ${accountId} not fully configured (missing accessToken or phoneNumberId)`,
          );
          return { stop: () => {} };
        }

        log?.info?.(
          `Starting WhatsApp Cloud API channel (account: ${accountId}, path: ${account.webhookPath})`,
        );

        const handler = createWebhookHandler({
          account,
          deliver: async (msg) => {
            const rt = getWaCloudRuntime();
            const currentCfg = await rt.config.loadConfig();

            // Build MsgContext (same format as LINE/Signal/Synology).
            // Surface must match OriginatingChannel so dispatch-from-config
            // uses our dispatcherOptions.deliver callback instead of
            // routeReply → delivery queue → loadChannelOutboundAdapter.
            const msgCtx = {
              Body: msg.body,
              From: msg.from,
              To: account.phoneNumberId,
              SessionKey: msg.sessionKey,
              AccountId: account.accountId,
              Surface: CHANNEL_ID,
              OriginatingChannel: CHANNEL_ID as any,
              OriginatingTo: msg.from,
              ChatType: msg.chatType,
              SenderName: msg.senderName,
            };

            // Dispatch via the SDK's buffered block dispatcher
            await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: currentCfg,
              dispatcherOptions: {
                deliver: async (payload: { text?: string; body?: string }) => {
                  const text = payload?.text ?? payload?.body;
                  if (text) {
                    await sendTextMessage(
                      account.baseUrl,
                      account.accessToken,
                      account.phoneNumberId,
                      msg.from,
                      text,
                    );
                  }
                },
                onReplyStart: () => {
                  log?.info?.(`Agent reply started for ${msg.from}`);
                },
              },
            });

            return null;
          },
          log,
        });

        // Deregister any stale route from a previous start
        const routeKey = `${accountId}:${account.webhookPath}`;
        const prevUnregister = activeRouteUnregisters.get(routeKey);
        if (prevUnregister) {
          log?.info?.(`Deregistering stale route before re-registering: ${account.webhookPath}`);
          prevUnregister();
          activeRouteUnregisters.delete(routeKey);
        }

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (msg: string) => log?.info?.(msg),
          handler,
        });
        activeRouteUnregisters.set(routeKey, unregister);

        log?.info?.(`Registered HTTP route: ${account.webhookPath} for WhatsApp Cloud API`);

        // Block until the gateway signals shutdown via abortSignal.
        // Without this, startAccount resolves immediately and the gateway
        // interprets it as a disconnect, triggering auto-restart.
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve();
            return;
          }
          const onAbort = () => {
            resolve();
          };
          abortSignal?.addEventListener("abort", onAbort, { once: true });
        });

        log?.info?.(`Stopping WhatsApp Cloud API channel (account: ${accountId})`);
        if (typeof unregister === "function") unregister();
        activeRouteUnregisters.delete(routeKey);
      },

      stopAccount: async (ctx: any) => {
        ctx.log?.info?.(`WhatsApp Cloud API account ${ctx.accountId} stopped`);
      },
    },

    agentPrompt: {
      messageToolHints: () => [
        "",
        "### WhatsApp Formatting",
        "WhatsApp supports limited formatting:",
        "",
        "**Bold**: Wrap text with *asterisks* → *bold*",
        "**Italic**: Wrap text with _underscores_ → _italic_",
        "**Monospace**: Wrap text with ```backticks``` → ```monospace```",
        "",
        "**Limitations**:",
        "- No buttons, cards, or interactive elements in text messages",
        "- No message editing after send",
        "- Keep messages under 4096 characters",
        "",
        "**Best practices**:",
        "- Use short, clear responses",
        "- Use line breaks to separate sections",
        "- Use numbered or bulleted lists for clarity",
      ],
    },
  };
}
