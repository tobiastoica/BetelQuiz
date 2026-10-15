# BetelQuiz — Code Review

**Scope:** the whole repository: the `server/` Node/Express/Socket.IO backend, the `client/src` React app, and `data/quizzes`. The folder isn't a git repository, so this review covers the full codebase rather than a diff.
**Focus:** bugs (correctness and security) first, then deduplication, factorization, simplification and efficiency.
**How to read it:** every finding has **Problem**, **Where**, and **Resolution** sections. The resolution is the smallest clean change that fixes the root cause, usually with a ready-to-adapt code sketch. Many findings share one underlying fix; those are grouped in [the fix plan](#fix-plan--high-leverage-changes-first) so you can fix several at once.
**Caveat:** `node_modules` isn't installed in either package, so the test suite wasn't run. Every finding comes from reading the code and tracing it by hand.

---

## Summary

| Severity | Count | Theme |
|---|---|---|
| 🔴 Critical / High | 8 | Credentials in the repo, player identity hijack, host freeze after reconnect, early reveal, puzzle answers sent to players, score inflation, inconsistent reconnect payloads, fake game results |
| 🟠 Medium | 12 | Scoring edge cases, editor/answer-key mismatch, missing state guards, CSV issues, audio bug, admin flows |
| 🟡 Low | 13 | Validation gaps, UX issues, privacy, clock skew, minor leaks |
| 🔧 Dedup / factorization | 16 | Mostly in `gameManager.js`, `index.js`, `Host.tsx`, `Play.tsx`, `Creator.tsx` |
| 🧹 Dead code / simplification | 10 | |
| ⚡ Efficiency | 6 | |
| 🏗️ Architecture | 3 | |

---

## Fix plan — high-leverage changes first

A few structural changes each fix several findings at once. Doing them in this order keeps every step small and easy to review.

| # | Change | Size | Resolves |
|---|---|---|---|
| 1 | **Load secrets from the environment** (`dotenv` + required vars) and remove them from the README | XS | H1 |
| 2 | **Bind player identity to the socket and the cookie**, and stop sending `userUuid` to players | S | H2, L3 |
| 3 | **`allActivePlayersAnswered()` + `scheduleReveal()`** helpers | XS | H4, D3 |
| 4 | **Deduplicate selected IDs once** with `normalizeSelected()` | XS | H6, D6 |
| 5 | **`prepareQuiz()` at game creation** (fill in defaults, normalize puzzle order) | S | M2, M3 |
| 6 | **One question/resume payload builder** (`questionView`, `activePayload`, `getPlayerResumeEvents`) that doesn't include `order` | M | H5, H7, L8, L13, D1 |
| 7 | **`applyQuestionScores()`** that stores each `scoreResult` | S | M1 (part), D2, E3, S3 |
| 8 | **Create games over REST** (`POST /api/games` + `requireAdmin`) | S | M10, M12, H8, S5 |
| 9 | **Explicit transition table + "results recorded once" flag** | S | M4, M5, A1 |
| 10 | Host page: re-join on `connect`, `startCountdown()`, `emitHost()`, `localStorage` secret | S | H3, M8, M9, D11 |
| 11 | `server/fsUtils.js` + `server/csv.js` | S | M6, M7, D7, D9, E1 |
| 12 | Client hooks: `useSocketEvent`, `useEscapeKey`, `useDragReorder` | M | D14, D15, D16 |

---

## 🔴 Critical / High

### H1. Admin credentials and JWT signing secret are hard-coded and published in the README

**Problem.** `JWT_SECRET` falls back to a constant, and the admin password is a constant. The README prints them next to the public URL `quiz.tbsst.net`. Anyone can log in as admin, or forge an admin JWT without a password. The `dotenv` package is a dependency but is **never imported**, so a `.env` file would be ignored anyway. The login check uses `===` and has no rate limit.

**Where.** [server/config.js:27](server/config.js#L27), [server/config.js:29-32](server/config.js#L29), [README.md:53-57](README.md#L53), [server/routes/auth.js:42-45](server/routes/auth.js#L42)

**Resolution.**
1. Load the environment and require the secrets. Keep a fallback only for tests:
   ```js
   // server/config.js
   import 'dotenv/config'; // runs first, so process.env is populated below

   function requiredEnv(name, testFallback) {
     const value = process.env[name] || (isTestEnv ? testFallback : undefined);
     if (!value) throw new Error(`Missing required environment variable ${name}`);
     return value;
   }

   export const JWT_SECRET = requiredEnv('JWT_SECRET', 'test-only-secret');
   export const ADMIN_CREDENTIALS = {
     username: process.env.ADMIN_USERNAME || 'admin',
     password: requiredEnv('ADMIN_PASSWORD', 'test-only-password'),
   };
   ```
2. Compare in constant time. Hashing both sides first gives equal-length buffers, so `timingSafeEqual` can't throw:
   ```js
   // server/routes/auth.js
   import { createHash, timingSafeEqual } from 'crypto';
   const digest = (s) => createHash('sha256').update(String(s ?? '')).digest();
   const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));
   // if (safeEqual(username, ADMIN_CREDENTIALS.username) & safeEqual(password, ADMIN_CREDENTIALS.password)) …
   ```
   The single `&` is deliberate: both comparisons always run.
3. Rate-limit the login with one line, `router.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 10 }), …)` from `express-rate-limit`.
4. Add a `.env.example` file (`JWT_SECRET=`, `ADMIN_PASSWORD=`). Replace the credentials in the README with "copy `.env.example` to `.env`". `.env` is already in `.gitignore`.
5. **Rotate the deployed password and secret now.** They're already public.

---

### H2. A player's `userUuid` is a bearer token, it is sent to every player, and the server never checks who owns it

**Problem.** `userUuid` is the only player identity, so whoever presents it *is* that player.
- **It leaks to everyone.** `final_results.firstPlace` contains the winner's `userUuid` and goes to every player. The reconnect path sends the raw player object, including `socketId`. The client never reads `firstPlace`.
- **HTTP routes trust input over the cookie.** `?userUuid=` and `body.userUuid` take priority, so anyone can read or rewrite any profile.
- **Socket events don't check ownership.** `player_submit_answer` and `player_update_avatar` act on whatever `userUuid` the payload names. `player_join` with an existing `userUuid` takes over that seat.

**Where.** [server/gameManager.js:1162](server/gameManager.js#L1162), [server/index.js:359](server/index.js#L359), [server/index.js:62](server/index.js#L62), [:93](server/index.js#L93), [:102](server/index.js#L102), [:371-385](server/index.js#L371), [server/gameManager.js:288-291](server/gameManager.js#L288)

**Resolution.** Socket events get their identity from the socket, HTTP routes get it from the cookie, and nobody receives another player's UUID.
1. **Remove the leak.** Delete `firstPlace` from `final_results` in `transitionToPodium` and in the reconnect path. The client doesn't use it.
2. **HTTP: cookie only.** In the three `/api/player/*` routes, use `const userUuid = req.userUuid;`. The middleware always sets it. Remove `?userUuid=` from `api.ts` (`checkActiveGame`) and `userUuid` from the body in `PlayerProfileModal.tsx`. The client and server already share the same cookie name.
3. **Sockets: identity comes from the socket that joined.** After `player_join`, `socketToGame` already maps `socket.id → { pin, userUuid }`, so use that and ignore the payload:
   ```js
   // server/index.js
   const playerOf = (socket) => {
     const info = gameManager.socketToGame.get(socket.id);
     return info?.role === 'player' ? info : null;
   };

   socket.on('player_submit_answer', ({ answerPayload } = {}) => {
     const me = playerOf(socket);
     socket.emit('answer_submitted_ack', me
       ? gameManager.submitAnswer(me.pin, me.userUuid, answerPayload)
       : { success: false, error: 'Join the game first' });
   });

   socket.on('player_update_avatar', ({ avatar } = {}) => {
     const me = playerOf(socket);
     if (me && gameManager.updatePlayerAvatar(me.pin, me.userUuid, avatar)) {
       socket.emit('player_avatar_updated', { avatar });
     }
   });
   ```
4. **Takeover:** the newest connection wins, and the old one is told. This doesn't block real reconnects: after a refresh or network change the old socket is already dead, so the notice goes nowhere.
   ```js
   // gameManager.joinPlayer, reconnect branch, before overwriting player.socketId
   if (player.socketId && player.socketId !== socketId) {
     this.io.to(player.socketId).emit('player_kicked', { reason: 'You joined from another device' });
     this.socketToGame.delete(player.socketId);
   }
   ```
   Once UUIDs no longer leak, only the host and admin can see them, which is enough protection for a quiz app.

---

### H3. The host projector freezes permanently after any socket reconnect

**Problem.** The host sends `host_join` once, on mount. After a reconnect, Socket.IO uses a new socket id that isn't in the room, and `game.hostSocketId` still points at the dead socket. Every event to the host is lost, and the projector stops updating. Separately, `reconnectionAttempts: 10` makes a client stop retrying for good after about 40 s, without telling the user.

**Where.** [client/src/pages/Host.tsx:183](client/src/pages/Host.tsx#L183), [client/src/utils/socket.ts:11](client/src/utils/socket.ts#L11)

**Resolution.** Re-join on every `connect`. `host_join` is already idempotent, and the server already replays the full state through `host_game_data`.
```tsx
// Host.tsx, inside the main socket effect
const joinHost = () => socket.emit('host_join', { pin, hostSecret: hostSecretRef.current || undefined });
joinHost();                       // emits are buffered if not yet connected
socket.on('connect', joinHost);   // every reconnect gets a fresh socket id
socket.on('host_error', (e) => setHostError(e.error)); // render "Session expired — reopen from dashboard"
// cleanup:
socket.off('connect', joinHost);
```
In `socket.ts`, delete `reconnectionAttempts: 10`; the default is to retry forever. Optionally show a small "Reconnecting…" banner while `!socket.connected`.

---

### H4. "Everyone answered" counts answers, not people, so the reveal can come early

**Problem.** `answersCount >= activePlayers.length` includes answers from players who have since disconnected. Players A, B and C: A answers, then A's phone locks; B answers; now 2 ≥ 2, so the question is revealed while C is still answering. `handleDisconnect` already does it correctly (membership with `every`), so the two copies have drifted apart.

**Where.** [server/gameManager.js:697-711](server/gameManager.js#L697), [server/gameManager.js:1243-1253](server/gameManager.js#L1243)

**Resolution.** One membership-based helper and one reveal scheduler, used in both places:
```js
// gameManager.js
isActive(p) { return p.connected || this.isSocketAlive(p.socketId); }

allActivePlayersAnswered(game) {
  const answers = game.answers.get(game.currentQuestionIndex);
  if (!answers) return false;
  const everyone = [...game.players.values()];
  const active = everyone.filter((p) => this.isActive(p));
  const pool = active.length ? active : everyone; // nobody online → only if *all* answered
  return pool.length > 0 && pool.every((p) => answers.has(p.userUuid));
}

scheduleReveal(game, delayMs = 500) {
  this.clearGameTimer(game.pin);
  this.addGameTimer(game.pin, setTimeout(() => {
    if (game.state === 'QUESTION_ACTIVE') this.transitionToQuestionReveal(game);
  }, delayMs));
}
```
`submitAnswer` and `handleDisconnect` both become `if (this.allActivePlayersAnswered(game)) this.scheduleReveal(game);`.

---

### H5. The correct puzzle order is sent to every player before they answer

**Problem.** Player option payloads include `order: o.order ?? idx`. For puzzles, that *is* the answer key, and it's visible in DevTools' WebSocket frames. The REST endpoint strips it on purpose, but the socket path sends it anyway. The client never reads `order` while a question is active (only on the reveal screens), so removing it is safe.

**Where.** [server/gameManager.js:581-611](server/gameManager.js#L581), [server/index.js:275-284](server/index.js#L275)

**Resolution.** Send players only `id`, `text` and `colorIndex`. Do the "don't send an already-solved shuffle" check on the server, where `order` is still known:
```js
const toOptionView = (o, idx) => ({ id: o.id, text: o.text, colorIndex: o.colorIndex ?? idx });

playerOptions(game) {
  const opts = game.currentQuestionOptions;              // server-side copy, still has `order`
  if (this.currentQuestion(game).type !== 'puzzle' || opts.length < 2) return opts;
  const isSolved = (list) => list.every((o, i) => o.order === i); // order is normalized 0..n-1 (M3)
  let shuffled = shuffleArray(opts);
  for (let i = 0; i < 10 && isSolved(shuffled); i++) shuffled = shuffleArray(opts);
  return shuffled;
}
// payload: options: this.playerOptions(game).map(toOptionView)
```
This also replaces the local `shuffleOptions` and `isSorted` code (D10).

---

### H6. Multi-select scoring counts duplicate IDs, so a player can score more than the maximum

**Problem.** `selectedIds` is never deduplicated. With correct answers `{a, b}`, sending `['a','a','a']` gives accuracy 1.5, which is 150 % of the time score and more than a perfect answer. Vote tallies count each duplicate too.

**Where.** [server/scoring.js:99-103](server/scoring.js#L99), [:133-136](server/scoring.js#L133), [server/gameManager.js:743-750](server/gameManager.js#L743), [server/reportsManager.js:110-117](server/reportsManager.js#L110)

**Resolution.** One normalizer in `scoring.js`, used by scoring, the live tally and reports:
```js
export function normalizeSelected(payload) {
  const raw = payload?.selected;
  const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : [];
  return [...new Set(list)];
}
```
Unknown IDs already score 0, because `noWrongChosen` becomes false, so no extra validation is needed.

---

### H7. Four hand-copied question payload builders have drifted, so players and hosts get a different UI after a refresh

**Problem.** The `question_active` payload is built in four places. The reconnect copies are missing fields:
- **Player reconnect:** no `allowMultipleAnswers`, `tileLevel` or `fuzzyMatching`. A player who refreshes during a multi-answer word question gets the single-input UI.
- **Host reconnect:** no `tileLevel` or `acceptedAnswers`. The picture grid jumps back to `medium` density.

**Where.** [server/gameManager.js:541-573](server/gameManager.js#L541), [:614-638](server/gameManager.js#L614), [:1263-1308](server/gameManager.js#L1263), [server/index.js:265-367](server/index.js#L265)

**Resolution.** Use one builder for both audiences and both cases (live and reconnect), and move the resume logic out of `index.js`. Full sketch in **[D1](#d1-one-question-payload-builder-fixes-h5-h7-l8-l13)**. Afterwards, the `player_join` handler is:
```js
socket.on('player_join', (data = {}) => {
  const result = gameManager.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id, data.avatar);
  if (!result.success) return socket.emit('join_error', { error: result.error });
  socket.join(result.pin);
  socket.emit('join_success', result);
  const game = gameManager.getGameByPin(result.pin);
  for (const [event, payload] of gameManager.getPlayerResumeEvents(game, result.userUuid)) {
    socket.emit(event, payload);
  }
});
```

---

### H8. Leaving a lobby to host another quiz records a finished game, with fake wins

**Problem.** When the same socket creates a new game, any earlier game that isn't at `PODIUM`, including one still in `LOBBY`, is ended through `transitionToPodium`. That writes a report with 0 questions played and calls `recordGameResult` for every lobby player. With all scores at 0, the first player to join gets rank 1, a "win".

**Where.** [server/gameManager.js:137-144](server/gameManager.js#L137)

**Resolution.**
- **Root fix:** create games over REST ([M10](#m10-host_create_game-requires-no-authentication)). Game creation is then no longer tied to a host socket, and the implicit "end the previous game" behaviour, and this bug with it, goes away.
- **Minimal fix**, if you keep socket creation: close lobbies instead of ending them. Reusing the existing `player_kicked` event means no client change:
  ```js
  if (prevGame?.state === 'LOBBY') {
    this.io.to(prevGame.pin).emit('player_kicked', { reason: 'The host closed this game' });
    this.deleteGame(prevGame.pin);
  } else if (prevGame && prevGame.state !== 'PODIUM') {
    this.endGame(prevGame.pin);
  }
  ```
- In both cases, add the M5 "record once" flag.

---

## 🟠 Medium

### M1. Correct answers on 0-point questions show as "Incorrect" and reset the streak

**Problem.** `calculateQuestionScore` returns `isCorrect: false` early whenever `points <= 0`. 0 points is a supported setting (README, Creator), so every correct player sees "Incorrect" and loses their streak. For `number_guess` and multi-answer `word_guess`, correctness is also defined as `points > 0`, which has the same problem.

**Where.** [server/scoring.js:63-66](server/scoring.js#L63), [:266-268](server/scoring.js#L266), [:425-426](server/scoring.js#L425)

**Resolution.** Correctness must not depend on the point value.
1. Delete the early return (lines 64-66). With `maxPoints = 0`, the existing formula already gives `timeScore = 0`.
2. Base correctness on accuracy instead of points: `isCorrect: accuracy > 0, isPartial: accuracy > 0` in `number_guess`, and `effectiveAccuracy > 0` / `< 1` in multi-word mode.
3. Don't award a streak bonus on 0-point questions (one condition in `applyQuestionScores`, D2): `const bonus = q.points > 0 ? calculateStreakBonus(streak) : 0;`

---

### M2. Scoring ignores quiz-level defaults that the game loop uses

**Problem.** The timer and the screens use `question.x ?? quiz.defaultX ?? N`. Scoring and reports fall back straight to 20 s and 1000 points. With an imported quiz that has `defaultTimeLimit: 60` and no per-question value, players get 60 s but are scored as if the limit were 20 s.

**Where.** [server/gameManager.js:511](server/gameManager.js#L511), [:551](server/gameManager.js#L551), [server/scoring.js:63-70](server/scoring.js#L63), [server/reportsManager.js:161-162](server/reportsManager.js#L161)

**Resolution.** Resolve the defaults **once**, when the game is created, so every later step sees complete questions and none of them needs fallbacks:
```js
// gameManager.js
function prepareQuiz(quiz) {
  const questions = (quiz.questions || []).map((q) => normalizePuzzleOrder({
    ...q,
    timeLimit: q.timeLimit ?? quiz.defaultTimeLimit ?? 20,
    points: q.points ?? quiz.defaultPoints ?? 1000,
  }));
  return { ...quiz, questions };
}
// createGame: const quiz = prepareQuiz(getQuizById(quizId));
```
Then delete every `?? game.quiz?.defaultX ?? N` fallback in `gameManager.js` and `reportsManager.js`.

---

### M3. The Creator's puzzle editor shows array position, but scoring uses `order`

**Problem.** The editor treats array position as the correct sequence ("Item 1 in order…"). Scoring sorts by `order ?? 0`, and reveal sorts by `order ?? idx`. The shipped sample quiz has `order: [0, 2, 1, 3]`, so the editor shows the wrong correct order, and fixing texts to match the editor corrupts the answer key. An option without `order` is first for scoring but last for reveal.

**Where.** [client/src/pages/Creator.tsx:842-863](client/src/pages/Creator.tsx#L842), [server/scoring.js:181-183](server/scoring.js#L181), [server/gameManager.js:840-846](server/gameManager.js#L840), [server/storage.js:199-202](server/storage.js#L199)

**Resolution.** Make the array the single source of truth and keep `order` in step with it:
```js
// server: shared helper
export function normalizePuzzleOrder(q) {
  if (q.type !== 'puzzle') return q;
  const sorted = (q.options || [])
    .map((o, i) => ({ ...o, order: o.order ?? i }))
    .sort((a, b) => a.order - b.order);
  return { ...q, options: sorted.map((o, i) => ({ ...o, order: i })) };
}
```
- Apply it in `getQuizById`, which fixes legacy files when they're read so the Creator shows the right sequence, and in `prepareQuiz` (M2).
- In `Creator.handleSave`, write `order = index` for puzzle options before sending, so the editor's visible order is what gets saved.
- In scoring and reveal, `order` is now always 0…n-1, so the `?? 0` / `?? idx` fallbacks can go.

---

### M4. `startGame`, `endGame` and `skipToNextQuestion` don't check the current state

**Problem.**
- `startGame` runs in any state: it resets to question 0 and reshuffles. Holding Space (keyboard auto-repeat) sends several `host_start_game` events, because `handleStartGame` is the only handler without the client cooldown.
- `endGame` runs again in `PODIUM`, which double-records results (M5).
- `skipToNextQuestion` can restart a finished game.

**Where.** [server/gameManager.js:449-469](server/gameManager.js#L449), [:1027-1070](server/gameManager.js#L1027), [client/src/pages/Host.tsx:370-372](client/src/pages/Host.tsx#L370), [:394-410](client/src/pages/Host.tsx#L394)

**Resolution.** One-line guards now; the general fix is the transition table in [A1](#a1-make-the-game-state-machine-explicit).
```js
startGame(pin) {
  const game = this.getGameByPinOrId(pin);
  if (!game || game.state !== 'LOBBY' || game.quiz.questions.length === 0) return false;
  …
}
endGame(pin) {
  const game = this.getGameByPinOrId(pin);
  if (!game || game.state === 'PODIUM') return false;
  …
}
```
- Delete `skipToNextQuestion` and its `host_skip_to_next` handler. No UI uses it (S3), and its scoring differs from the reveal scoring (D2).
- On the client, add `if (e.repeat) return;` at the top of the keydown handler, and give `handleStartGame` the same `actionLockRef` check plus `triggerCooldown()` as the other handlers.

---

### M5. Recording the game result isn't idempotent

**Problem.** `transitionToPodium` writes the report and updates career profiles every time it runs. A second call, through M4 or H8, double-counts games played and wins.

**Where.** [server/gameManager.js:1171-1218](server/gameManager.js#L1171)

**Resolution.** Move the side effects into one method with a guard:
```js
recordResults(game) {
  if (game.resultsRecorded) return;
  game.resultsRecorded = true;
  try { generateGameReport(game); } catch (e) { console.error(e); }
  try { this.updateProfiles(game); } catch (e) { console.error(e); }
}
```

---

### M6. CSV formula injection, and unescaped fields, in the report export

**Problem.** Player-controlled nicknames are written as-is, so `=HYPERLINK(…)` runs as a formula in Excel or Sheets. `quizTitle` and `type` aren't escaped at all, so a title containing `"` breaks the file. A CSV escaper already exists in `quizBridge.js` but isn't reused.

**Where.** [server/reportsManager.js:324-345](server/reportsManager.js#L324), [server/quizBridge.js:78-85](server/quizBridge.js#L78)

**Resolution.** One small `server/csv.js` that both exports use:
```js
// server/csv.js
export function csvCell(value, { neutralizeFormulas = false } = {}) {
  let s = value == null ? '' : String(value);
  if (neutralizeFormulas && typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvRow = (cells, opts) => cells.map((c) => csvCell(c, opts)).join(',');
export { parseCsv } from './quizBridge.js'; // or move parseCsv here
```
The report export becomes a list of `csvRow([...], { neutralizeFormulas: true })` calls, because nicknames are untrusted. The Kahoot export uses `csvRow([...])` without neutralizing, because admins write the question text and a leading `-` must stay as it is.

---

### M7. The Kahoot CSV export picks the wrong correct answer when it's option 5 or 6

**Problem.** Only options 1-4 are exported. If the only correct option is #5 or #6, the row is written with correct answer "1", so a wrong answer is marked correct. Options 5 and 6 are dropped without a warning.

**Where.** [server/quizBridge.js:216-236](server/quizBridge.js#L216)

**Resolution.** Never write a wrong answer key: skip questions the Kahoot format can't represent.
```js
if (options.length > 4 || correctIndices.length === 0) {
  console.warn(`Kahoot export: skipped "${q.title}" (needs ≤4 options with a correct one)`);
  continue;
}
```
If you want to tell the user, append the skipped count to the download filename (`kahoot_<title>_2-skipped.csv`). The export is a plain `<a href>` download, so response headers wouldn't be visible.

---

### M8. The host countdown "tick" plays 4 times a second

**Problem.** The countdown interval runs every 250 ms and plays a tick every time. The same block is copied twice.

**Where.** [client/src/pages/Host.tsx:218-233](client/src/pages/Host.tsx#L218), [:285-300](client/src/pages/Host.tsx#L285)

**Resolution.** One `startCountdown` that only acts when the displayed second changes. It also takes a local end time (L13):
```tsx
const startCountdown = (endsAt: number) => {
  clearInterval(countdownTimerRef.current);
  let shown = -1;
  const tick = () => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (left === shown) return;                 // ← only once per second
    shown = left;
    setRemainingSeconds(left);
    if (left > 0) sound.playCountdownTick(left <= 5);
    else { clearInterval(countdownTimerRef.current); sound.playTimeUp(); }
  };
  tick();
  countdownTimerRef.current = setInterval(tick, 250);
};
// question_active:  startCountdown(Date.now() + data.remainingTimeMs);
// host_game_data:   startCountdown(Date.now() + data.activeQuestionData.remainingTimeMs);
```

---

### M9. A host page opened in a new tab or window loses control without any message

**Problem.** `hostSecret` is kept in `sessionStorage`, which is per tab. Opening `/host/<pin>` in a new window (for example on the projector screen) sends no secret. The server answers with `host_error`, which nothing listens for, so the page shows an empty lobby. `game_error` isn't handled on the Host page either.

**Where.** [client/src/pages/Host.tsx:48-55](client/src/pages/Host.tsx#L48), [:190](client/src/pages/Host.tsx#L190), [client/src/pages/AdminDashboard.tsx:122](client/src/pages/AdminDashboard.tsx#L122), [server/index.js:187-189](server/index.js#L187)

**Resolution.**
- Switch the three `sessionStorage` calls to `localStorage` (same key). The secret is per game and expires when the game is pruned.
- Listen for `host_error` and `game_error` (H3 snippet) and render a clear message with a "Back to dashboard" button instead of an empty lobby.
- Longer term, if host sockets authenticate with the admin session ([A3](#a3-identity--authorization-model)), the secret isn't needed at all.

---

### M10. `host_create_game` requires no authentication

**Problem.** Any socket can create games for any quiz, and the quiz list is public. Anonymous users can run private quizzes, or create games repeatedly to fill the PIN space and the disk.

**Where.** [server/index.js:140-163](server/index.js#L140), [client/src/pages/AdminDashboard.tsx:112-132](client/src/pages/AdminDashboard.tsx#L112)

**Resolution.** Create games over REST with the existing `requireAdmin` middleware. Admin auth then works through the normal cookie, without socket handshake plumbing. The Host page already joins with `host_join` + `hostSecret`, so nothing else changes.
```js
// server/index.js
import { requireAdmin } from './routes/auth.js';
app.post('/api/games', requireAdmin, (req, res) => {
  try {
    const game = gameManager.createGame(req.body?.quizId); // sync once the server QR is removed (S5)
    res.json({ pin: game.pin, hostSecret: game.hostSecret });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```
```ts
// client/src/utils/api.ts
export async function createGame(quizId: string) {
  const res = await fetch('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quizId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create game');
  return data as { pin: string; hostSecret: string };
}

// AdminDashboard.handleHostGame
const { pin, hostSecret } = await createGame(quizId);
localStorage.setItem(`kahoot_host_secret_${pin}`, hostSecret);
navigate(`/host/${pin}`, { state: { hostSecret } });
```
Delete the `host_create_game` socket handler and the `hostSocketId` "end previous game" block. This also resolves **H8** and **M12**. The test harnesses that emit `host_create_game` need a one-line switch to calling `gameManager.createGame` directly; several already do.

---

### M11. Rejoining a locked game by typing the PIN is blocked

**Problem.** The status endpoint returns **403** for a locked game, and the client stops there, before its "already in this game?" check. The server itself allows reconnects to locked games.

**Where.** [server/index.js:123-125](server/index.js#L123), [client/src/pages/Play.tsx:389-412](client/src/pages/Play.tsx#L389)

**Resolution.** The server reports the lock instead of refusing, and the client decides after the reconnect check:
```js
// server: replace the 403 branch
return res.json({ exists: true, locked: Boolean(game.settings?.lockGame), pin: game.pin, … });
```
```ts
// Play.handlePinSubmit, after the "already in this game → rejoin" branch
if (data.locked) { setErrorMsg('This game is locked by the host.'); return; }
setJoinStep('NICKNAME');
```

---

### M12. Stale `once` listeners in the dashboard's Host flow

**Problem.** `socket.once('game_created')` and `socket.once('game_error')` are both registered on the shared socket, and only one ever fires. The other stays registered and later reacts to unrelated errors. A double click creates two games.

**Where.** [client/src/pages/AdminDashboard.tsx:112-132](client/src/pages/AdminDashboard.tsx#L112)

**Resolution.** Fully resolved by the REST call in M10: one `await`, no listeners. If you keep the socket, use an acknowledgement callback, which can't leak: `socket.emit('host_create_game', { quizId }, (res) => …)` on the client and `socket.on('host_create_game', async (data, ack) => ack(result))` on the server. Either way, disable the Host button while `hostingQuizId` is set.

---

## 🟡 Low

### L1. Games are deleted 2 h after creation, even mid-game, and clients aren't told
**Where.** [server/gameManager.js:77-92](server/gameManager.js#L77)
**Resolution.** Prune by **idle time** and notify the room first:
```js
const idle = now - (game.lastStateTransitionTime || 0);
if (idle > TWO_HOURS_MS || isPodiumExpired) {
  this.io.to(pin).emit('player_kicked', { reason: 'This game has ended' });
  this.deleteGame(pin);
}
```

### L2. Renaming during a lobby reconnect skips the 20-char limit and the uniqueness check
**Where.** [server/gameManager.js:311-313](server/gameManager.js#L311), [:330-340](server/gameManager.js#L330)
**Resolution.** Extract one validator and use it on both paths:
```js
cleanNickname(game, raw, selfUuid) {
  const name = (raw || '').trim().slice(0, 20);
  const taken = name && [...game.players.values()]
    .some((p) => p.userUuid !== selfUuid && p.nickname.toLowerCase() === name.toLowerCase());
  return { name, taken };
}
```

### L3. `avatar` is never validated (any length or string), then stored in profiles and sent to the host
**Where.** [server/gameManager.js:314-316](server/gameManager.js#L314), [:395-396](server/gameManager.js#L395), [server/index.js:103-107](server/index.js#L103)
**Resolution.** One guard, applied in `joinPlayer`, `updatePlayerAvatar` and `updatePlayerIdentity` (the latter covers the HTTP route too):
```js
const cleanAvatar = (a) => (typeof a === 'string' && a.length > 0 && a.length <= 16 ? a : null);
```
16 code units fits even multi-codepoint emoji such as family or flag sequences.

### L4. `updateSettings` merges arbitrary keys and sends `settings_updated` to the host twice
**Where.** [server/gameManager.js:206-215](server/gameManager.js#L206)
**Resolution.** Whitelist the keys and emit once. The host socket is already in the room.
```js
const SETTING_KEYS = ['randomizeAnswers', 'randomizeQuestions', 'showQuestionsOnPlayerScreens', 'lockGame'];
for (const key of SETTING_KEYS) if (key in newSettings) game.settings[key] = Boolean(newSettings[key]);
this.io.to(game.pin).emit('settings_updated', game.settings);
```

### L5. The Creator lets a picture-reveal question have no correct option, or a word-guess question have no accepted answers
**Where.** [client/src/pages/Creator.tsx:484-529](client/src/pages/Creator.tsx#L484)
**Resolution.** Replace the inline `if` chain with one function that returns an error message per question:
```ts
function validateQuestion(q: Question): string | null {
  if (!q.title?.trim()) return 'is missing a question title';
  if (['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(q.type) && !q.options.some((o) => o.isCorrect))
    return 'must have at least 1 correct answer';
  if (q.type === 'puzzle' && q.options.some((o) => !o.text.trim())) return 'has empty puzzle items';
  if (q.type === 'word_guess' && !q.acceptedAnswers?.length) return 'needs at least 1 accepted answer';
  if (q.type === 'number_guess') { /* existing min/max/target checks */ }
  return null;
}
// handleSave: const bad = quiz.questions.findIndex((q) => validateQuestion(q));
```

### L6. Switching a puzzle question to quiz makes every option correct
**Where.** [client/src/pages/Creator.tsx:162-174](client/src/pages/Creator.tsx#L162)
**Resolution.** Keep the existing options only when switching between the two types that share option semantics; otherwise use the defaults (D13):
```ts
const canReuse = ['quiz', 'picture_reveal'].includes(currentQuestion.type) && ['quiz', 'picture_reveal'].includes(type);
const options = canReuse ? currentQuestion.options : createDefaultOptions(type);
```

### L7. The number inputs in the Creator can't be cleared (`Number('') === 0`)
**Where.** [client/src/pages/Creator.tsx:888-916](client/src/pages/Creator.tsx#L888)
**Resolution.** Map an empty input to `undefined`. The save validation already rejects an empty target.
```ts
const numberOrUndefined = (e: React.ChangeEvent<HTMLInputElement>) =>
  e.target.value === '' ? undefined : Number(e.target.value);
// onChange={(e) => updateCurrentQuestion({ numberTarget: numberOrUndefined(e) })}
```

### L8. The player's picture-reveal grid isn't synced with the question timer
**Problem.** The grid starts its own clock when it mounts, so after a refresh it starts fully covered while the host's grid is half revealed.
**Where.** [client/src/pages/Play.tsx:745-750](client/src/pages/Play.tsx#L745), [client/src/components/PictureRevealGrid.tsx:57-72](client/src/components/PictureRevealGrid.tsx#L57)
**Resolution.** The unified payload (D1) always carries `remainingTimeMs`. Pass `endsAt = Date.now() + remainingTimeMs` to the grid, and use it as the anchor in the grid's auto-progress effect: `const startTime = (endsAt ?? Date.now() + durationSeconds * 1000) - durationSeconds * 1000;`.

### L9. Word-cloud keys are case-sensitive, and reports tally words differently from the live reveal
**Where.** [server/gameManager.js:885-889](server/gameManager.js#L885), [server/reportsManager.js:119-124](server/reportsManager.js#L119)
**Resolution.** Use the same extractor and key in both places (D6):
```js
for (const w of extractWordInputs(payload)) {
  const key = normalizeString(w, question.caseSensitive);
  if (key) wordSubmissions[key] = (wordSubmissions[key] || 0) + 1;
}
```

### L10. Career analytics merge profile and report data inconsistently and undercount players who appear only in reports
**Where.** [server/playerProfiles.js:265-326](server/playerProfiles.js#L265), [:138](server/playerProfiles.js#L138)
**Resolution.** Profiles are written for every finished game, so treat them as the only source. **Delete** the whole "scan every report to enrich" block (about 60 lines). `getAllPlayersAnalytics` becomes `readJsonDir(PROFILES_DIR).map(toAnalyticsRow).sort(…)`. Replace the `wins` expression with `profile.wins = profile.firstPlaceCount;`.

### L11. "Answer already submitted" turns the answer buttons back on
**Where.** [server/gameManager.js:665-668](server/gameManager.js#L665), [client/src/pages/Play.tsx:326-334](client/src/pages/Play.tsx#L326)
**Resolution.** Make submission idempotent on the server: `if (questionAnswers.has(playerUuid)) return { success: true, duplicate: true };`. No client change is needed.

### L12. Privacy: the device ID restores itself after the user clears cookies (an evercookie pattern)
**Problem.** The ID is mirrored into cookies, localStorage, IndexedDB and the Cache API, and restores itself after the user clears cookies. It's also readable by JavaScript (`httpOnly: false`). This needs a GDPR and consent review.
**Where.** [client/src/utils/device.ts:90-329](client/src/utils/device.ts#L90), [server/index.js:45-58](server/index.js#L45)
**Resolution.** Keep only the cookie, mirrored to localStorage. Delete the IndexedDB and Cache API tiers and the self-healing logic. `device.ts` shrinks from about 400 lines to about 30 (`readCookie`, `writeCookie`, `getDeviceUuid`). Reconnects still work, because the cookie survives refreshes and restarts.

### L13. The host countdown depends on client and server clocks agreeing
**Problem.** The host computes `questionStartTime` (server clock) + limit − `Date.now()` (client clock). If the projector laptop's clock is 5 s off, the countdown and picture reveal are 5 s off.
**Where.** [client/src/pages/Host.tsx:278-282](client/src/pages/Host.tsx#L278), [:207-213](client/src/pages/Host.tsx#L207)
**Resolution.** Send a **duration** instead of a timestamp. The server includes `remainingTimeMs` in every active payload (D1), and the client computes `endsAt = Date.now() + remainingTimeMs` on receipt (M8 snippet). Then drop `questionStartTime` from the client.

### Hardening notes (each a one-liner)
- **CORS isn't needed at all.** The app is same-origin in production (served by Express) and in development (Vite proxies `/api`, `/uploads` and `/socket.io`). Delete `app.use(cors(...))` and the Socket.IO `cors` option ([server/index.js:28-39](server/index.js#L28)), and remove the `cors` dependency. The current `origin: true, credentials: true` reflects any origin with credentials.
- **Body limit:** `express.json({ limit: '1mb' })` globally, and `express.json({ limit: '30mb' })` only on `/api/quizzes/import/*` ([server/index.js:40-41](server/index.js#L40)).
- **Secure cookie behind the tunnel:** `app.set('trust proxy', 1)`, and use `secure: req.secure` in `res.cookie('token', …)` ([server/routes/auth.js:56](server/routes/auth.js#L56)).

---

## 🔧 Deduplication & factorization

### D1. One question payload builder (fixes H5, H7, L8, L13)
**Where.** [server/gameManager.js:541-641](server/gameManager.js#L541), [:1263-1308](server/gameManager.js#L1263), [:1311-1385](server/gameManager.js#L1311), [server/index.js:265-367](server/index.js#L265)
**Resolution.** Add three small methods in `gameManager.js` and delete the four copies:
```js
currentQuestion(game) { return game.quiz.questions[game.currentQuestionIndex]; }

questionView(game, audience, options = game.currentQuestionOptions) {
  const q = this.currentQuestion(game);
  const view = {
    id: q.id, type: q.type, title: q.title, image: q.image,
    timeLimit: q.timeLimit, points: q.points,               // complete thanks to prepareQuiz (M2)
    theme: q.theme || game.quiz.theme || 'spring',
    backgroundImage: q.backgroundImage || game.quiz.backgroundImage,
    isMultiSelect: q.isMultiSelect,
    numberMin: q.numberMin ?? 0, numberMax: q.numberMax ?? 100,
    tileLevel: q.tileLevel || 'medium',
    allowMultipleAnswers: q.allowMultipleAnswers,
    fuzzyMatching: q.fuzzyMatching,
    options: options.map(toOptionView),                       // never includes order/isCorrect (H5)
  };
  return audience === 'host'
    ? { ...view, acceptedAnswers: q.acceptedAnswers, caseSensitive: q.caseSensitive, fuzzyScorePercentage: q.fuzzyScorePercentage }
    : view;
}

activePayload(game, audience, options) {
  const answers = game.answers.get(game.currentQuestionIndex);
  return {
    state: 'QUESTION_ACTIVE',
    questionIndex: game.currentQuestionIndex,
    totalQuestions: game.quiz.questions.length,
    remainingTimeMs: Math.max(0, game.questionStartTime + game.questionTimeLimit * 1000 - Date.now()), // L13
    settings: { showQuestionsOnPlayerScreens: Boolean(game.settings.showQuestionsOnPlayerScreens) },
    question: this.questionView(game, audience, options),
    ...(audience === 'host' && { answersReceived: answers?.size ?? 0, totalPlayers: game.players.size }),
  };
}

getPlayerResumeEvents(game, userUuid) {
  switch (game.state) {
    case 'GET_READY':       return [['game_state_changed', this.getReadyPayload(game)]];
    case 'QUESTION_ACTIVE': return [['question_active', {
      ...this.activePayload(game, 'player', this.playerOptions(game)),
      alreadyAnswered: Boolean(game.answers.get(game.currentQuestionIndex)?.has(userUuid)),
    }]];
    case 'QUESTION_REVEAL': { const r = game.lastPlayerResults?.get(userUuid); return r ? [['player_feedback', r]] : []; }
    case 'SCOREBOARD':      return [['player_standing', this.standingFor(game, userUuid)]];
    case 'PODIUM':          return [['final_results', this.finalResultFor(game, userUuid)]];
    default:                return [];
  }
}
```
`transitionToQuestionActive` then emits `activePayload(game, 'host')` to the host and `activePayload(game, 'player', this.playerOptions(game))` to each player. `getHostStateData` uses `activePayload(game, 'host')`. `standingFor` and `finalResultFor` are shared with `transitionToScoreboard` and `transitionToPodium` (D4). `getReadyPayload` replaces the copy at [server/index.js:321-335](server/index.js#L321).

### D2. Apply question scores in one place, and store the results (fixes M1 streak, E3, S3)
**Where.** [server/gameManager.js:733-814](server/gameManager.js#L733), [:1040-1061](server/gameManager.js#L1040), [:1188-1197](server/gameManager.js#L1188), [server/reportsManager.js:87](server/reportsManager.js#L87)
**Resolution.** Score each submission once, save the result on the answer record, and have reports and profiles read it:
```js
const NO_ANSWER = { points: 0, isCorrect: false, isPartial: false, isExact: false, accuracy: 0 };

applyQuestionScores(game) {
  const q = this.currentQuestion(game);
  const answers = game.answers.get(game.currentQuestionIndex) ?? new Map();
  const results = new Map();
  for (const [uuid, player] of game.players) {
    const record = answers.get(uuid);
    const result = record ? calculateQuestionScore(q, record.answerPayload, record.responseTimeMs) : NO_ANSWER;
    if (record) record.scoreResult = result;                        // reused by reports & profiles
    const fullyCorrect = result.isCorrect && !result.isPartial;
    player.streak = fullyCorrect ? player.streak + 1 : result.isCorrect ? player.streak : 0;
    const pointsEarned = result.points + (fullyCorrect && q.points > 0 ? calculateStreakBonus(player.streak) : 0);
    player.score += pointsEarned;
    results.set(uuid, { result, pointsEarned });
  }
  return results;
}
```
`reportsManager` and the profile update use `record.scoreResult ?? calculateQuestionScore(...)`. The fallback only matters for answers that were never revealed, e.g. when a game is ended mid-question.

### D3. One "everyone answered" check (fixes H4)
**Resolution.** `allActivePlayersAnswered` and `scheduleReveal` in the H4 snippet replace both inline copies, including the two inline `isPlayerActive` lambdas.

### D4. Ranking is copied five times
**Where.** [server/gameManager.js:1079-1088](server/gameManager.js#L1079), [:1130-1138](server/gameManager.js#L1130), [server/reportsManager.js:32-41](server/reportsManager.js#L32), [server/index.js:344](server/index.js#L344), [:354](server/index.js#L354)
**Resolution.**
```js
// server/ranking.js
export const rankPlayers = (players) =>
  [...players].sort((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, ...toPublicPlayer(p) }));
```
Then `standingFor(game, uuid)` and `finalResultFor(game, uuid)` (D1) are `rankPlayers(...).find(...)` plus a few fields, used both by the transitions and by resume.

### D5. Player serialization is copied three times
**Where.** [server/gameManager.js:218-225](server/gameManager.js#L218), [:433-440](server/gameManager.js#L433), [:1324-1331](server/gameManager.js#L1324)
**Resolution.**
```js
const toPublicPlayer = ({ userUuid, nickname, avatar, score, streak, connected }) =>
  ({ userUuid, nickname, avatar, score, streak, connected });
```
Use it as `players: [...game.players.values()].map(toPublicPlayer)` in all three places. This is only for host and admin payloads; players never receive other players' UUIDs (H2).

### D6. Answer-payload normalization is copied four times
**Where.** [server/scoring.js:99-103](server/scoring.js#L99), [:301-310](server/scoring.js#L301), [server/gameManager.js:743-745](server/gameManager.js#L743), [:780-786](server/gameManager.js#L780), [:875-884](server/gameManager.js#L875), [server/reportsManager.js:110-121](server/reportsManager.js#L110)
**Resolution.** Export two helpers from `scoring.js`, `normalizeSelected` (H6) and:
```js
export function extractWordInputs(p) {
  if (Array.isArray(p?.answers)) return p.answers;
  if (Array.isArray(p?.selected)) return p.selected;
  if (typeof p?.text === 'string') return [p.text];
  if (typeof p?.selected === 'string') return [p.selected];
  return [];
}
```
Use them in scoring, in the live tallies and in reports.

### D7. File-system helpers
**Where.** `isValidId` in [server/storage.js:49](server/storage.js#L49), [server/reportsManager.js:6](server/reportsManager.js#L6) and [server/playerProfiles.js:5](server/playerProfiles.js#L5). Atomic-write code in [server/reportsManager.js:212-228](server/reportsManager.js#L212) and [server/playerProfiles.js:61-86](server/playerProfiles.js#L61); `saveQuiz` writes **non-atomically** ([server/storage.js:76](server/storage.js#L76)). Directory scans in `listQuizzes`, `listGameReports` and twice in `getAllPlayersAnalytics`.
**Resolution.**
```js
// server/fsUtils.js
import fs from 'fs';
import path from 'path';

export const isValidId = (id) => typeof id === 'string' && /^[\w-]+$/.test(id);

export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });   // no-op after a successful rename
  }
}

export function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))]; }
    catch (err) { console.error(`Skipping unreadable ${f}:`, err.message); return []; }
  });
}
```
`saveQuiz`, `savePlayerProfile` and `generateGameReport` call `writeJsonAtomic`. The list functions become `readJsonDir(dir).map(...)`.

### D8. Auth token handling is copied three times
**Where.** [server/routes/auth.js:7-36](server/routes/auth.js#L7), [:70-89](server/routes/auth.js#L70)
**Resolution.**
```js
export function getAdmin(req) {
  const token = req.cookies?.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.username === ADMIN_CREDENTIALS.username ? decoded : null;
  } catch { return null; }
}
export const isAdmin = (req) => Boolean(getAdmin(req));
export function requireAdmin(req, res, next) {
  req.user = getAdmin(req);
  return req.user ? next() : res.status(401).json({ error: 'Admin login required' });
}
router.get('/me', (req, res) => {
  const admin = getAdmin(req);
  res.json(admin ? { authenticated: true, user: { username: admin.username, role: 'admin' } } : { authenticated: false });
});
```

### D9. CSV helpers
**Resolution.** Covered by `server/csv.js` in M6: `parseCsv`, `csvCell` and `csvRow` live there, and both exports and the importer use them. Delete `escapeCsvField` once it's no longer referenced.

### D10. Shuffling is implemented twice
**Where.** [server/gameManager.js:588-611](server/gameManager.js#L588)
**Resolution.** Delete the local `shuffleOptions` and `isSorted`. `playerOptions()` in the H5 snippet uses the imported `shuffleArray`.

### D11. Host page boilerplate
**Where.** [client/src/pages/Host.tsx](client/src/pages/Host.tsx): seven `hostSecret` emits, two countdown copies, four toggle rows (`:669-770`), an inline theme list (`:783-790`), and an inline state union (`:75-77`).
**Resolution.**
```tsx
const emitHost = (event: string, extra: object = {}) =>
  socket.emit(event, { pin, hostSecret: hostSecretRef.current || undefined, ...extra });
// handleNext = () => guarded(() => emitHost('host_next')), etc.

const ToggleRow = ({ icon, label, description, value, onToggle, activeClass = 'bg-[#26890C]' }) => (/* one copy of the markup */);
```
- `startCountdown(endsAt)` from M8 replaces both countdown copies.
- Add `swatch` to each entry of `THEMES` in `utils/theme.ts` and map over it instead of the inline list.
- Use `GameState` from `types/quiz.ts` instead of the inline union.

### D12. Play page boilerplate
**Where.** [client/src/pages/Play.tsx](client/src/pages/Play.tsx): four clamp copies (`:874-994`), three word-add copies (`:1040-1074`), six `pin.trim().replace(...)`, and two resume branches (`:151-185`).
**Resolution.**
```tsx
const cleanPin = pin.replace(/\s+/g, '');
const clampGuess = (raw: string | number, fallback = guessedNumber) => {
  const n = typeof raw === 'number' ? raw : raw.trim() === '' ? NaN : Number(raw);
  return Math.min(question.numberMax ?? 100, Math.max(question.numberMin ?? 0, Number.isNaN(n) ? fallback : n));
};
const setGuess = (n: number) => { setGuessedNumber(n); setGuessedNumberText(String(n)); };
// minus: setGuess(clampGuess(guessedNumberText) - 1) → clampGuess again; blur/submit: clampGuess(guessedNumberText)

const addTypedWord = () => {
  const val = typedWord.trim();
  if (val && !typedWords.includes(val)) setTypedWords((prev) => [...prev, val]);
  setTypedWord('');
};

const resumeIfActive = async (onlyPin?: string) => {
  const active = await checkActiveGame();
  if (!active.hasActiveGame || !active.player || (onlyPin && active.pin !== onlyPin)) return false;
  socket.emit('player_join', {
    pin: active.pin, userUuid: getDeviceUuid(), nickname: active.player.nickname, avatar: active.player.avatar,
  });
  return true;
};
```

### D13. Creator default options per question type
**Where.** [client/src/pages/Creator.tsx:28-33](client/src/pages/Creator.tsx#L28), [:158-219](client/src/pages/Creator.tsx#L158), [:222-288](client/src/pages/Creator.tsx#L222)
**Resolution.**
```ts
const opt = (text = '', isCorrect = false, extra: Partial<AnswerOption> = {}): AnswerOption =>
  ({ id: uuidv4(), text, isCorrect, ...extra });

export function createDefaultOptions(type: QuestionType): AnswerOption[] {
  switch (type) {
    case 'quiz':
    case 'picture_reveal': return [opt('', true), opt(), opt(), opt()];
    case 'puzzle':         return [0, 1, 2, 3].map((i) => opt('', true, { order: i }));
    case 'true_false':     return [opt('True', true), opt('False')];
    case 'yes_no':         return [opt('Yes', true), opt('No')];
    default:               return [];
  }
}

export const typeDefaults = (type: QuestionType, prev: Partial<Question> = {}) => ({
  numberTarget: type === 'number_guess' ? prev.numberTarget ?? 50 : undefined,
  numberMin:    type === 'number_guess' ? prev.numberMin ?? 0 : undefined,
  numberMax:    type === 'number_guess' ? prev.numberMax ?? 100 : undefined,
  tileLevel:    type === 'picture_reveal' ? prev.tileLevel ?? 'medium' : undefined,
  acceptedAnswers: type === 'word_guess' ? prev.acceptedAnswers ?? [] : undefined,
});
```
`handleAddQuestion` and `handleChangeQuestionType` both shrink to a few lines (see also L6), and `DEFAULT_OPTIONS` goes away.

### D14. A hook for "Escape closes the modal"
**Where.** Six copies: `Host.tsx:99-109`, `Creator.tsx:69-79`, `GameReportsModal.tsx:89-96`, `PlayerProfileModal.tsx:48-55`, `QuizSettingsModal.tsx:41-48`, `EmojiPickerModal.tsx:56-63`.
**Resolution.**
```ts
// client/src/hooks/useEscapeKey.ts
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  useLayoutEffect(() => { ref.current = onEscape; });
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);
}
```

### D15. Drag-to-reorder logic
**Where.** [client/src/components/PuzzleReorder.tsx](client/src/components/PuzzleReorder.tsx) (~80-130) and [client/src/components/QuestionListReorder.tsx](client/src/components/QuestionListReorder.tsx) (~60-140).
**Resolution.** Extract `useDragReorder<T>(items: T[], onReorder: (next: T[], movedTo: number) => void)`. It returns `{ getItemProps(index), draggingIndex }` and contains the pointer handling, the nearest-slot calculation and the `splice` move. Each component keeps only its markup. Auto-scroll can be an option of the hook (`{ autoScrollContainer }`), used only by the question list.

### D16. Socket listener cleanup
**Where.** [client/src/pages/Host.tsx:347-359](client/src/pages/Host.tsx#L347), [client/src/pages/Play.tsx:359-371](client/src/pages/Play.tsx#L359). `socket.off('event')` without a handler removes *every* listener for that event on the shared socket.
**Resolution.** One hook that removes exactly its own handler and always calls the latest closure, so there are no stale-state bugs:
```ts
// client/src/hooks/useSocketEvent.ts
export function useSocketEvent<T = any>(event: string, handler: (data: T) => void) {
  const ref = useRef(handler);
  useLayoutEffect(() => { ref.current = handler; });
  useEffect(() => {
    const socket = getSocket();
    const listener = (data: T) => ref.current(data);
    socket.on(event, listener);
    return () => { socket.off(event, listener); };
  }, [event]);
}
// Host.tsx: useSocketEvent('scoreboard_update', (d) => { … });  ← replaces the big effect + manual cleanup
```

---

## 🧹 Dead code & simplification

| # | Item | Resolution |
|---|---|---|
| S1 | `Home` page is imported but never routed (`/` renders `Play`). [client/src/App.tsx:3](client/src/App.tsx#L3) | Delete `pages/Home.tsx` and the import. |
| S2 | `TimerCircle` and `FastForward` are imported in Host but never used. [Host.tsx:16](client/src/pages/Host.tsx#L16), [:30](client/src/pages/Host.tsx#L30) | Delete both imports. Delete `components/TimerCircle.tsx` if nothing else uses it. Run `npm run lint` (oxlint) to find the rest. |
| S3 | `handleSkipToNext` is never used, so `host_skip_to_next` / `skipToNextQuestion` can't be reached from the UI and its scoring differs from the reveal scoring. [Host.tsx:386-390](client/src/pages/Host.tsx#L386), [gameManager.js:1027-1070](server/gameManager.js#L1027) | Delete the client function, the socket handler and the server method. |
| S4 | `loadGameSnapshot` is never called. Snapshots are written on every change but never read, so a restart loses games anyway, contrary to what the README says. [storage.js:99-123](server/storage.js#L99) | Delete `saveGameSnapshot`, `loadGameSnapshot`, `serializeGame` and `GAMES_DIR`, and fix the README. If restoring games after a restart is wanted later, add it on purpose with debounced atomic writes. |
| S5 | The server QR encodes a **relative** path that phones can't open, and it overwrites the client's correct QR. `customHostUrl` is unused. [gameManager.js:127-154](server/gameManager.js#L127), [Host.tsx:192](client/src/pages/Host.tsx#L192) | Delete the server QR code, `qrCodeDataUrl` from all payloads, the `qrcode` server dependency and `Host.tsx:192`. `createGame` becomes synchronous. |
| S6 | `addGameTimer` and `clearGameTimer` handle impossible non-`Set` and array entries. [gameManager.js:28-55](server/gameManager.js#L28) | `addGameTimer(pin, t) { (this.timers.get(pin) ?? this.timers.set(pin, new Set()).get(pin)).add(t); }` and `clearGameTimer(pin) { this.timers.get(pin)?.forEach(clearTimeout); this.timers.delete(pin); }` |
| S7 | `exportToBetelQuizJson` is unused; the route repeats it. [quizBridge.js:248](server/quizBridge.js#L248) | Delete it. |
| S8 | `skipQuestion` repeats `handleHostNext` word for word. [gameManager.js:998-1024](server/gameManager.js#L998) | Point the `host_skip` handler at `handleHostNext` and delete `skipQuestion`. Simplify `handleHostNext` itself to a dispatch table (below). |
| S9 | Empty `else if (isCorrect && isPartial) {}` branch, an unreachable podium branch in `SCOREBOARD`, and redundant `clearGameTimer` / `lastStateTransitionTime` writes before transitions that already do both. [gameManager.js:763-765](server/gameManager.js#L763), [:952-992](server/gameManager.js#L952) | They disappear with D2 and the dispatch table below. |
| S10 | `createSampleQuiz` hard-codes the quiz that also ships as JSON. [storage.js:125-222](server/storage.js#L125) | Replace it with copying `data/quizzes/sample-master-quiz.json` from a `server/seed/` folder, or just ship the JSON. |

**`handleHostNext` as a dispatch table (S8/S9):**
```js
handleHostNext(pin) {
  const game = this.games.get(pin);
  if (!game || !this.checkHostCooldown(game)) return false;
  const isLast = game.currentQuestionIndex + 1 >= game.quiz.questions.length;
  const step = {
    GET_READY:       () => this.transitionToQuestionActive(game),
    QUESTION_ACTIVE: () => this.transitionToQuestionReveal(game),
    QUESTION_REVEAL: () => (isLast ? this.transitionToPodium(game) : this.transitionToScoreboard(game)),
    SCOREBOARD:      () => { game.currentQuestionIndex++; this.transitionToGetReady(game); },
  }[game.state];
  if (!step) return false;
  game.lastHostTransitionTime = Date.now();
  step();
  return true;
}
```

---

## ⚡ Efficiency

| # | Item | Resolution |
|---|---|---|
| E1 | `saveGameSnapshot` runs `JSON.stringify` and an async write on every join, avatar change and transition. Concurrent writes to the same file can interleave and corrupt it, and the file is never read. [storage.js:99-110](server/storage.js#L99) | Delete it (S4). |
| E2 | `correctOptionIds` and the reveal `options` array are rebuilt for every player inside the reveal loop. [gameManager.js:776-807](server/gameManager.js#L776) | Compute both once before the loop: `const correctOptionIds = …; const revealOptionViews = …;`. |
| E3 | Each answer is scored three times (reveal, podium, report). | Store `record.scoreResult` once (D2). |
| E4 | `getAllPlayersAnalytics` reads every profile **and** every report on each request; `listQuizzes` parses every full quiz. [playerProfiles.js:200-347](server/playerProfiles.js#L200), [storage.js:20-47](server/storage.js#L20) | L10 removes the report scan. For quizzes, cache the summary list in memory (`let quizListCache = null`) and reset it in `saveQuiz` and `deleteQuiz`, if the list ever gets large. |
| E5 | `updatePlayerIdentity` does a synchronous read and write of the profile on every `player_join`, including reconnects. [gameManager.js:358-363](server/gameManager.js#L358) | Call it only for new players, or when the nickname or avatar actually changed: `if (isNew \|\| prevNick !== player.nickname \|\| prevAvatar !== player.avatar) updatePlayerIdentity(...)`. |
| E6 | `generatePin` runs `pruneOldGames` on every game creation, although a 10-minute interval already does it. [gameManager.js:105](server/gameManager.js#L105) | Delete the call. |

---

## 🏗️ Architecture

### A1. Make the game state machine explicit
**Problem.** Each handler checks state in its own way, and some don't check at all (M4). There is a client cooldown, a server cooldown, and patches labelled "Issue N". Bugs such as M4, M5 and H8 keep appearing for this reason.
**Resolution.** All state changes go through one guarded function, and the side effects run exactly once:
```js
const TRANSITIONS = {
  LOBBY:           ['GET_READY'],
  GET_READY:       ['QUESTION_ACTIVE', 'PODIUM'],
  QUESTION_ACTIVE: ['QUESTION_REVEAL', 'PODIUM'],
  QUESTION_REVEAL: ['SCOREBOARD', 'PODIUM'],
  SCOREBOARD:      ['GET_READY', 'PODIUM'],
  PODIUM:          [],
};

setState(game, next) {
  if (!TRANSITIONS[game.state].includes(next)) return false;
  this.clearGameTimer(game.pin);
  game.state = next;
  game.lastStateTransitionTime = Date.now();
  return true;
}
// each transitionToX starts with: if (!this.setState(game, 'X')) return;
```
Migrate one `transitionTo*` at a time. Each conversion removes that function's manual `clearGameTimer`, `state =` and timestamp lines.

### A2. Socket handlers belong in their own module, and the tests should use them
**Problem.** About 230 of `index.js`'s 411 lines are game logic. Seven test files re-implement the socket handlers in their own test servers, so the real `index.js` wiring, including the reconnect payloads behind H7, is never tested.
**Resolution.**
```js
// server/socketHandlers.js
export function registerSocketHandlers(io, gameManager) {
  io.on('connection', (socket) => { /* the handlers, now thin: validate → gameManager.x → emit */ });
}
// server/index.js:   registerSocketHandlers(io, gameManager);
// tests:             const io = new Server(httpServer); registerSocketHandlers(io, new GameManager(io));
```
Also export `app` and `server` from a `createServer()` factory, so tests can start the real server on port 0.

### A3. Identity & authorization model
**Resolution.** Two rules replace all the per-payload `userUuid` / `hostSecret` passing:
- **Players** are identified by the cookie on HTTP and by `socketToGame` on sockets (H2). Clients never send their own identity in a payload after joining.
- **Hosts** are created through an admin-authenticated REST call (M10). The `hostSecret` returned there is the host's capability. It's stored in `localStorage` (M9) and checked once, in `host_join`. After that, the host socket's role in `socketToGame` is enough, which `isAuthorizedHost` already supports.

---

## Testing gaps worth closing
Each item below is a regression test for one of the findings above. Write them against the real handlers once A2 is done.
- Multi-select with duplicate IDs (H6); points = 0 (M1); quiz-level defaults (M2); puzzle with `order` ≠ array index (M3).
- The early-reveal case: answer, then disconnect, then another player answers while one player is still answering (H4).
- Player and host reconnect during `QUESTION_ACTIVE` for `word_guess` with `allowMultipleAnswers` and for `picture_reveal` (H7).
- `startGame` / `endGame` from every state, and podium side effects recorded exactly once (M4, M5).
- Kahoot export with the correct answer at index ≥ 4 (M7); CSV export with `=`-prefixed nicknames (M6).
- That no player-bound payload contains `order`, `isCorrect` or another player's `userUuid` (H2, H5). A single "walk every emitted payload" assertion helper covers this.
