/* CYBERVERSE host transport. No credentials, wallet mutations or API URLs here. */
(() => {
  "use strict";
  const channel = "edusphere.game-vault";
  const gameId = "cyberverse";
  const incomingTypes = new Set([
    "EDUSPHERE_INIT_CONTEXT",
    "EDUSPHERE_UNLOCK_MISSION_RESPONSE",
    "EDUSPHERE_MISSION_PROGRESS_RESPONSE",
  ]);
  const outgoingTypes = new Set([
    "EDUSPHERE_GAME_READY",
    "EDUSPHERE_UNLOCK_MISSION_REQUEST",
    "EDUSPHERE_MISSION_PROGRESS",
  ]);
  const origin = window.location.origin;
  let callback = null;
  const validEnvelope = (data) => data && typeof data === "object" &&
    !Array.isArray(data) && data.channel === channel && data.version === 1 &&
    data.gameId === gameId && typeof data.type === "string" &&
    typeof data.requestId === "string" && data.requestId.length <= 128 &&
    data.payload && typeof data.payload === "object" && !Array.isArray(data.payload);
  const receive = (event) => {
    if (!callback || window.parent === window || origin === "null" ||
        event.source !== window.parent || event.origin !== origin ||
        !validEnvelope(event.data) || !incomingTypes.has(event.data.type)) return;
    const serialized = JSON.stringify(event.data);
    if (serialized.length <= 65536) callback(serialized);
  };
  if (window.CyberverseEduSphereBridge) window.CyberverseEduSphereBridge.close();
  window.CyberverseEduSphereBridge = {
    is_hosted() {
      return window.parent !== window && origin !== "null";
    },
    install(nextCallback) {
      callback = nextCallback;
      window.removeEventListener("message", receive);
      window.addEventListener("message", receive);
    },
    send_json(serialized) {
      if (window.parent === window || origin === "null" || typeof serialized !== "string" || serialized.length > 65536) return;
      let data;
      try { data = JSON.parse(serialized); } catch { return; }
      if (validEnvelope(data) && outgoingTypes.has(data.type)) window.parent.postMessage(data, origin);
    },
    close() {
      callback = null;
      window.removeEventListener("message", receive);
    },
  };
})();
