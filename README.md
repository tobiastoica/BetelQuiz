# KahootV2 - Personal Live Kahoot Replica

A high-fidelity, customized live multiplayer quiz platform replicating the exact look, feel, and functionality of Kahoot!.

---

## 🚀 Quick Start

### 1. Start the Server
```bash
npm start
```
The server will start at **`http://localhost:3000`**.

For development with hot-reloading:
```bash
npm run dev
```

### Tests
```bash
npm test
```
Runs the server test suite (unit tests plus socket sync tests against the real handlers) in about 20 seconds and exits on its own. For the client, use `npm run build` in the `client` directory to typecheck and build.

---

## 🌐 Exposing via Cloudflare Tunnel (`quiz.tbsst.net`)

Since the entire application (Host screen, Player mobile interface, Creator studio, WebSockets, and image uploads) runs on a single port (**`3000`**), setting up your Cloudflare Tunnel is effortless:

### Option A: Using your named tunnel configuration:
In your `~/.cloudflared/config.yml` or Cloudflare Zero Trust dashboard:
```yaml
ingress:
  - hostname: quiz.tbsst.net
    service: http://localhost:3000
  - service: http_status:404
```

### Option B: Quick tunnel command:
```bash
cloudflared tunnel run <TUNNEL_NAME>
```
or for an ad-hoc tunnel:
```bash
cloudflared tunnel --url http://localhost:3000
```

All WebSocket connections, APIs, and media assets will route automatically over HTTPS/WSS without any CORS issues.

---

## 🔐 Credentials & Authentication

- **Admin Portal**: [http://localhost:3000/admin/login](http://localhost:3000/admin/login)
  - Configure `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` (copied from `.env.example`).
- **Players**: **No login required!**
  - Players only need to enter the 6-digit numeric Game PIN and their nickname.

---

## 📱 Navigation & URL Structure

- **Landing Page**: `https://quiz.tbsst.net/` (PIN entry & quick links)
- **Player View**: `https://quiz.tbsst.net/play` (or direct links: `/play?pin=123456` or `/play?gameId=<UUID>&session_id=<UUID>`)
- **Admin Login**: `https://quiz.tbsst.net/admin/login`
- **Quiz Dashboard**: `https://quiz.tbsst.net/admin/dashboard`
- **Creator Studio**: `https://quiz.tbsst.net/creator` (or `/creator/<quizId>`)
- **Host Projector**: `https://quiz.tbsst.net/host/<pin>`

---

## 🎨 Features & Replicated Screens

1. **Kahoot Creator Studio**:
   - Question list carousel sidebar (reorder, duplicate, delete).
   - Up to 6 answer choices with signature Kahoot geometric shapes (▲, ◆, ●, ■, ★, ⬡).
   - Single-select and Multi-select support with toggle checkmarks.
   - Customizable points from **0 to 2000**.
   - Adjustable time limits (5s to 240s).
   - Local image uploads with preview, replacement, and "Use as background".
   - Themes: Standard, Spring Blossom, Summer Beach, Autumn Foliage, Winter Frost, Dark Mode, and custom background images.

2. **5 Question Types**:
   - **Quiz**: Multiple choice (2 to 6 options), single or multi-select.
   - **True / False**: Binary choice with blue diamond and red triangle.
   - **Yes / No**: Binary choice for direct opinions.
   - **Puzzle**: Ranking / sorting items into the correct sequence.
   - **Number Guessing / Slider**: Closeness-based scoring where answers closer to the target receive higher points.

3. **Live Host Projector Screens**:
   - **Lobby Screen**: Large 6-digit PIN, join URL, QR code for mobile camera scanning, animated player cards with avatars, and host kick action.
   - **Get Ready Screen**: Question teaser, question type badge, 3-second tension countdown.
   - **Question Active Screen**: Circular countdown timer ring with urgency tick, live answer counter pill, centered media image, and signature color answer blocks.
   - **Answer Reveal Screen**: Animated bar chart distribution of player votes, correct answers marked with checkmarks (✓) and wrong with (✗).
   - **Scoreboard Screen**: Animated top 5 leaderboard with scores, rank indicators, and streak flames (🔥).
   - **Podium Screen (Grand Finale)**: 3-tier Olympic podium (3rd, 2nd, 1st) with victory fanfare and celebratory confetti bursts!

4. **Participant Mobile Experience**:
   - Responsive, touch-first tiles with tactile haptic feel.
   - Immediate tap submission for single select, checkbox review for multi-select, touch reordering for puzzle, and slider for number guessing.
   - Instant feedback screen: "Correct! +1,000 pts" or "Incorrect", with personal streak and rank standing.
   - **Reconnection Resilience**: Disconnected or refreshed phones reconnect seamlessly without losing their nickname or score.

5. **Audio Synthesizer Engine**:
   - Built-in Web Audio API synthesizer: lobby background beat, timer ticks, time-up gong, correct chord chime, and podium fanfare.
   - Host Master Mute/Unmute toggle.

6. **Local Persistence**:
   - All quizzes stored locally in `data/quizzes/*.json`.
   - Active game session snapshots in `data/games/*.json`.
   - Media uploads in `data/uploads/*`.
