# Blorps

A family-friendly hex slime racing game. Grow by eating fruit and slurping goo, bounce off friends, and race to **10 slime points**. Getting bigger makes you slower.

Play in the browser on a desktop or phone. No accounts — just a short room code.

## How a room works

1. One person opens the game and clicks **Create room**. They get a 4-character code (for example `K7QM`).
2. Race solo with **Play vs 1 bot** or **Play vs 2 bots**, or wait for friends to join with the code. The host can also set bots to 0, 1, or 2 in the waiting room.
3. Everyone else can **Join** with the code. Check **Join as spectator** to watch without playing.
4. The host clicks **Start race** once 2–4 players (humans and/or bots) are in.
5. Late arrivals can still join the same code as spectators and see the live board.

Bots take their own turns: they go for fruit, crystals, slime tokens, and will bop you if they land on you.

Room state lives in the Node process memory. If the server restarts or sleeps, open rooms disappear.

## Rules (short)

- Start at size 3 with a 2-hex move. At size **6** your base move becomes **1**.
- On your turn, tap a glowing neighbor. You may change direction freely.
- You **must drop 1 slime point** on the first hex you land on.
- Landing on an existing slime token (yours or anyone’s) slurps it and gives a **free bounce** (pivot and launch).
- Landing on another player: **Bounce** off them, or **Bop** them (push up to 2 hexes and steal 1 goo).
- Fruit: apples and bananas **+1**, grapes **+2**. Landing on or bouncing over fruit eats it. Nothing respawns.
- Capture crystals: once per player per crystal. **+1 goo**, an upgrade card, and a slime drop.
- First to **10** goo wins.

Upgrades include Zoomies (first move is 2 hexes instead of 1), Treehopper (bounce over trees), Slip-n-Slide (extra move on water), and Super Bounce (bops and free bounces go 3 hexes).

## Run locally

Needs **Node 18+**.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

That starts two processes:

- Vite client on port **5173** (proxies `/socket.io` and `/api` to the game server)
- Socket.io + Express game server on port **3000**

Open a second browser window (or your phone on the same Wi-Fi at `http://YOUR_LAN_IP:5173`) to play multiplayer.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Client + server with hot reload |
| `npm test` | Hex math and rules tests |
| `npm run build` | Vite production build into `dist/` |
| `npm start` | Serve `dist/` + Socket.io (production) |

### Environment variables

Copy `.env.example` if you want a local file. None are required for a normal deploy.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket listen port. **Render sets this for you.** |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | unset | `production` serves the Vite build from `dist/` |
| `VITE_SOCKET_URL` | *(same origin)* | Only if the client and Socket.io host differ |

## Deploy on Render

This is **one Web Service** (Node), not a static site. Socket.io needs a long-lived server.

1. Push this repo to GitHub.
2. On [Render](https://render-www.onrender.com/), **New → Web Service** and point it at the repo.
3. Settings:

   | Setting | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install && npm run build` |
   | Start command | `npm start` |
   | Instance | Free is fine for playtesting |

4. Environment:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `20` |

   Do not set `PORT`. Render injects it.

5. Health check path (optional): `/api/health`

There is a `render.yaml` in the repo if you prefer Blueprint deploys.

After deploy, share `https://YOUR-SERVICE.onrender.com/`. Free instances sleep when idle — the first load after a nap can take a minute, and in-memory rooms reset.

## Stack

- Vite + Three.js client
- Express + Socket.io server (authoritative rules)
- Shared hex math in `shared/`

The server owns movement, bops, absorbs, captures, and the win check. Clients send taps; everyone (including late spectators) gets a full snapshot.
