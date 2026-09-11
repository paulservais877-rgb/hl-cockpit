/* Personal Alpha OS — Hyperliquid REST client (info endpoint) with timeout, retry and observability */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  const INFO_URL = "https://api.hyperliquid.xyz/info";
  const metrics = { calls: 0, errors: 0, lastLatencyMs: NaN, lastError: null, lastErrorTs: NaN, rateLimited: 0 };

  class HlError extends Error {
    constructor(message, { status, type, payload } = {}) {
      super(message);
      this.name = "HlError";
      this.status = status;
      this.type = type || "network";
      this.payloadType = payload?.type;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * POST /info. Retries on network errors, 429 and 5xx with exponential backoff.
   * @param {object} payload   e.g. {type:"clearinghouseState", user}
   * @param {object} opts      {timeoutMs=12000, retries=2, signal}
   */
  async function info(payload, opts = {}) {
    const { timeoutMs = 12000, retries = 2, signal } = opts;
    let attempt = 0, lastErr = null;
    while (attempt <= retries) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      if (signal && ctrl) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      const t0 = Date.now();
      try {
        metrics.calls++;
        const res = await fetch(INFO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: ctrl ? ctrl.signal : undefined,
        });
        metrics.lastLatencyMs = Date.now() - t0;
        if (res.status === 429) {
          metrics.rateLimited++;
          throw new HlError("Rate limited (429)", { status: 429, type: "rate_limit", payload });
        }
        if (!res.ok) throw new HlError("HTTP " + res.status, { status: res.status, type: res.status >= 500 ? "server" : "client", payload });
        const json = await res.json();
        return json;
      } catch (e) {
        lastErr = e instanceof HlError ? e : new HlError(e?.name === "AbortError" ? "Timeout (" + timeoutMs + "ms)" : String(e?.message || e), { type: e?.name === "AbortError" ? "timeout" : "network", payload });
        metrics.errors++;
        metrics.lastError = lastErr.message + " [" + (payload?.type || "?") + "]";
        metrics.lastErrorTs = Date.now();
        const retriable = lastErr.type !== "client" || lastErr.status === 429;
        if (!retriable || attempt === retries || (signal && signal.aborted)) throw lastErr;
        await sleep(400 * 2 ** attempt + Math.random() * 200);
      } finally {
        if (timer) clearTimeout(timer);
      }
      attempt++;
    }
    throw lastErr;
  }

  // Convenience wrappers ---------------------------------------------------------------
  const api = {
    info, HlError, metrics, INFO_URL,
    clearinghouseState: (user, o) => info({ type: "clearinghouseState", user }, o),
    metaAndAssetCtxs: (o) => info({ type: "metaAndAssetCtxs" }, o),
    allMids: (o) => info({ type: "allMids" }, o),
    openOrders: (user, o) => info({ type: "frontendOpenOrders", user }, o).catch(() => info({ type: "openOrders", user }, o)),
    predictedFundings: (o) => info({ type: "predictedFundings" }, o),
    candles: (coin, interval, startTime, endTime, o) => info({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }, o),
    fundingHistory: (coin, startTime, endTime, o) => info({ type: "fundingHistory", coin, startTime, endTime }, o),
    userFills: (user, o) => info({ type: "userFills", user }, o),
    userFillsByTime: (user, startTime, endTime, o) => info({ type: "userFillsByTime", user, startTime, endTime, aggregateByTime: true }, o),
    userFunding: (user, startTime, endTime, o) => info({ type: "userFunding", user, startTime, endTime }, o),
    portfolio: (user, o) => info({ type: "portfolio", user }, o),
    ledger: (user, startTime, endTime, o) => info({ type: "userNonFundingLedgerUpdates", user, startTime, endTime }, o),
    l2Book: (coin, o) => info({ type: "l2Book", coin }, o),
  };

  AOS.hl = api;
})(typeof window !== "undefined" ? window : globalThis);
