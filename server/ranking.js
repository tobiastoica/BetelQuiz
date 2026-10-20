export const toPublicPlayer = (player) => {
  const p = player || {};
  return {
    userUuid: p.userUuid,
    nickname: p.nickname,
    avatar: p.avatar,
    score: p.score ?? 0,
    streak: p.streak ?? 0,
    connected: Boolean(p.connected),
  };
};

export const rankPlayers = (players) => {
  if (!players || !(players instanceof Map)) return [];
  return Array.from(players.values())
    .filter(Boolean)
    .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))
    .map((p, i) => ({
      rank: i + 1,
      ...toPublicPlayer(p),
    }));
};
