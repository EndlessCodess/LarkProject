import * as Lark from "@larksuiteoapi/node-sdk";

export async function startLarkWsEventSource(options, onEvent) {
  const appId = options.appId || process.env.LARK_APP_ID || "";
  const appSecret = options.appSecret || process.env.LARK_APP_SECRET || "";
  const eventType = options.eventType || "im.message.receive_v1";

  if (!appId || !appSecret) {
    throw new Error("SDK event source requires LARK_APP_ID and LARK_APP_SECRET");
  }

  const loggerLevel = resolveLoggerLevel(options.sdkLogLevel || process.env.LARK_SDK_LOG_LEVEL || "info");
  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel,
    autoReconnect: true,
    source: "lark-context-agent",
    onReady: () => {
      console.log("[chat-event] sdk websocket connected");
    },
    onReconnecting: () => {
      console.warn("[chat-event][warn] sdk websocket reconnecting");
    },
    onReconnected: () => {
      console.log("[chat-event] sdk websocket reconnected");
    },
    onError: (error) => {
      console.error(`[chat-event][sdk] ${error.message}`);
    },
  });

  const dispatcher = new Lark.EventDispatcher({ loggerLevel }).register({
    [eventType]: (data) => {
      const payload = normalizeSdkPayload(data, eventType);
      setImmediate(() => {
        Promise.resolve(onEvent(payload)).catch((error) => {
          console.error(`[chat-event] sdk handler failed: ${error.message}`);
        });
      });
    },
  });

  await wsClient.start({ eventDispatcher: dispatcher });
  return {
    close() {
      wsClient.close({ force: true });
    },
  };
}

function normalizeSdkPayload(data, eventType) {
  if (data?.header && data?.event) {
    return {
      type: data.header.event_type || eventType,
      ...data.event,
    };
  }

  if (data?.message) {
    return {
      type: eventType,
      ...data,
    };
  }

  return {
    type: eventType,
    event: data,
    message: data?.message || data,
  };
}

function resolveLoggerLevel(level) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "debug") return Lark.LoggerLevel.debug;
  if (normalized === "warn") return Lark.LoggerLevel.warn;
  if (normalized === "error") return Lark.LoggerLevel.error;
  return Lark.LoggerLevel.info;
}
