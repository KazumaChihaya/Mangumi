import { get, type Query } from "./db.ts";
import type { User } from "./auth.ts";
import { contentVisible, entitled } from "./domain.ts";
import { now } from "./security.ts";
export async function voiceAuthorized(q: Query, participant: any) {
  if (!participant?.sessionId) return false;
  const user = (
      await q.all<User>(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? AND s.expires_at > ? AND u.status = 'active' AND u.verified = 1",
        [participant.sessionId, participant.userId, now()],
      )
    )[0],
    room = await get(q, "rooms", participant.roomId);
  if (
    !user ||
    !room ||
    !["公開", "開催中"].includes(room.status) ||
    !contentVisible({ ...room, status: "公開" }, user) ||
    (await get(q, "roomBans", `${room.id}_${user.id}`)) ||
    (await get(q, "blocks", `${user.id}_${room.hostId}`)) ||
    (await get(q, "blocks", `${room.hostId}_${user.id}`))
  )
    return false;
  try {
    await entitled(q, user, "voice.join");
    if (["host", "cohost", "speaker"].includes(participant.role))
      await entitled(q, user, "voice.speak");
    return true;
  } catch {
    return false;
  }
}
