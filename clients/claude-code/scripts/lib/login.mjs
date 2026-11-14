import { api } from "./api.mjs";
import { recordSuccess, serverUrl, setAuth } from "./store.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// OAuth device-code flow: no password or token ever passes through a terminal or a form.
export const requestDeviceCode = () => api("POST", "/v1/auth/device", { client: "strata-plugin" });

/** Polls until the engineer confirms the code. Resolves with the signed-in user; throws on denial or timeout. */
export async function waitForApproval(device, { signal } = {}) {
  const deadline = Date.now() + (device.expires_in ?? 300) * 1000;
  let interval = (device.interval ?? 2) * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("login cancelled");
    await sleep(interval);
    try {
      const token = await api("POST", "/v1/auth/token", { device_code: device.device_code });
      setAuth({ token: token.access_token, user: token.user, serverUrl: serverUrl() });
      recordSuccess(); // a fresh sign-in clears an "expired sign-in" state
      return token.user;
    } catch (err) {
      if (err.code === "slow_down") interval += 2000;
      else if (err.code === "authorization_pending" || !err.status || err.status >= 500)
        continue; // keep polling through blips
      else throw err;
    }
  }
  throw new Error("login timed out");
}
