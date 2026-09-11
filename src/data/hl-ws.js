/* Personal Alpha OS — Hyperliquid WebSocket client (allMids + webData2) with heartbeat and reconnect.
   The WS is an accelerator only: REST polling remains the fallback source of truth. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  const WS_URL = "wss://api.hyperliquid.xyz/ws";

  function createWs({ onMids, onWebData, onStatus, log } = {}) {
    let ws = null, user = null, wanted = false, backoff = 1000, pingTimer = null, watchdog = null, lastMsgTs = 0, status = "OFF";
    const setStatus = (s, detail) => { status = s; onStatus?.(s, detail); };
    const say = (...a) => log?.("[ws]", ...a);

    function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } }

    function subscribe() {
      send({ method: "subscribe", subscription: { type: "allMids" } });
      if (user) send({ method: "subscribe", subscription: { type: "webData2", user } });
    }

    function open() {
      if (!wanted || typeof WebSocket === "undefined") return;
      try {
        setStatus("CONNECTING");
        ws = new WebSocket(WS_URL);
      } catch (e) { setStatus("ERROR", String(e)); scheduleReconnect(); return; }
      ws.onopen = () => {
        backoff = 1000; lastMsgTs = Date.now();
        setStatus("CONNECTED");
        subscribe();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ method: "ping" }), 45000);
        clearInterval(watchdog);
        watchdog = setInterval(() => {
          // no message for 90s => connection is considered dead
          if (Date.now() - lastMsgTs > 90000) { say("watchdog: silent, reconnecting"); try { ws.close(); } catch (e) { /* ignore */ } }
        }, 15000);
      };
      ws.onmessage = (ev) => {
        lastMsgTs = Date.now();
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const ch = msg?.channel;
        if (ch === "allMids") { const mids = msg.data?.mids || msg.data; if (mids && typeof mids === "object") { setStatus("LIVE"); onMids?.(mids, lastMsgTs); } }
        else if (ch === "webData2") { if (msg.data) { setStatus("LIVE"); onWebData?.(msg.data, lastMsgTs); } }
        else if (ch === "subscriptionResponse" || ch === "pong") { /* fine */ }
        else if (ch === "error") { say("error", msg.data); }
      };
      ws.onerror = () => { setStatus("ERROR"); };
      ws.onclose = () => { clearInterval(pingTimer); clearInterval(watchdog); if (wanted) { setStatus("RECONNECTING"); scheduleReconnect(); } else setStatus("OFF"); };
    }

    function scheduleReconnect() {
      if (!wanted) return;
      const wait = backoff + Math.random() * 500;
      backoff = Math.min(backoff * 2, 60000);
      setTimeout(() => { if (wanted) open(); }, wait);
    }

    return {
      start(u) { user = u || null; wanted = true; if (!ws || ws.readyState > 1) open(); else subscribe(); },
      stop() { wanted = false; clearInterval(pingTimer); clearInterval(watchdog); try { ws && ws.close(); } catch (e) { /* ignore */ } ws = null; setStatus("OFF"); },
      setUser(u) { if (u !== user) { user = u; if (ws && ws.readyState === 1) { this.stop(); this.start(u); } } },
      get status() { return status; },
      get lastMsgTs() { return lastMsgTs; },
    };
  }

  AOS.hlws = { createWs, WS_URL };
})(typeof window !== "undefined" ? window : globalThis);
