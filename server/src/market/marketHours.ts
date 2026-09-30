import type { MarketSession, MarketStatusInfo } from "../domain/types.js";

/**
 * Local fallback for US equity market hours, used only when the provider's
 * market-status endpoint is unavailable. Does not know about holidays or
 * early closes, so its result is labeled source="local-calendar".
 */
export function localUsMarketStatus(now = new Date()): MarketStatusInfo {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  let session: MarketSession = "closed";
  if (weekday !== "Sat" && weekday !== "Sun") {
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) session = "pre-market";
    else if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) session = "regular";
    else if (minutes >= 16 * 60 && minutes < 20 * 60) session = "post-market";
  }
  return { isOpen: session === "regular", session, exchange: "US", asOf: now.getTime(), source: "local-calendar" };
}
