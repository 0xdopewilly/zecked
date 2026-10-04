// Free-drop alerts: when the house hides a new free riddle, everyone with notifications on gets a ping.
// At most one every 4 hours per player (drops can be more frequent than that), and a switch in Settings
// turns them off (dropAlerts).
import type { StashRecord } from "./game";
import { kv } from "./kv";
import { getPlayer } from "./players";
import { PUSH_PLAYERS, pushConfigured, sendPush } from "./push";

const EVERY_S = 4 * 3600;
const MAX_PLAYERS = 2000;
const BATCH = 25;

export async function dropAlert(s: StashRecord) {
  if (!pushConfigured() || s.type !== "riddle" || !s.riddle) return;
  const t = s.riddle.text.trim();
  const teaser = t.length > 90 ? `${t.slice(0, 88)}…` : t;
  const payload = {
    title: "🎁 Free drop is live",
    body: `“${teaser}” First to crack it keeps the ZEC.`,
    url: `/s/${s.id}`,
    tag: "house-drop",
  };
  const players = await kv().zrevrange(PUSH_PLAYERS, 0, MAX_PLAYERS - 1);
  for (let i = 0; i < players.length; i += BATCH) {
    await Promise.all(
      players.slice(i, i + BATCH).map(async ({ member: pid }) => {
        if (!(await kv().set(`dropalert:${pid}`, 1, { nx: true, exSeconds: EVERY_S }))) return;
        const p = await getPlayer(pid);
        if (!p || p.house || p.dropAlerts === false) return;
        await sendPush(pid, payload).catch(() => {});
      }),
    );
  }
}
