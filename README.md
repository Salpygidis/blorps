# Blorps

A family-friendly hex slime racing game. Grow by eating fruit and slurping goo, bounce off friends, and race to **10 points**. At 6 points you slow down.

Play in the browser on a desktop or phone. No accounts — just a short room code.

## How a room works

1. One person opens the game and clicks **Create room**. They get a 4-character code (for example `K7QM`).
2. Race solo with **Play vs 1 bot** or **Play vs 2 bots**, or wait for friends to join with the code. The host can add more bots in the waiting room, up to 12 racers.
3. Everyone else can **Join** with the code. Check **Join as spectator** to watch without playing.
4. The host clicks **Start race** once 2–12 players (humans and/or bots) are in. 2–4 players get one foundation, 5–8 get two adjacent foundations, and 9–12 get four in a row.
5. Late arrivals can still join the same code as spectators and see the live board.

Bots take their own turns: they go for fruit, crystals, slime tokens, and will bop you if they land on you.

Room state lives in the Node process memory. If the server restarts or sleeps, open rooms disappear.

## Rules (short)

- Everyone starts with 2 slime and a 2-hex move. A random player goes first, with the same goo as everyone else. A turn that starts at **6 points** or more has **1** move. Stepping up onto a higher hex costs **2** moves, or **1** if you have 6 points or more.
- Hold the pointer on a hex for a second to read everything on it.
- On your turn, tap a glowing hex. You may change direction between steps.
- Trees block movement. You cannot stop on a tree or be bopped onto one. Treehopper lets a free bounce or a bop hop over a tree and land on a hex past it.
- Your first move **leaves 1 slime** on the hex you started from. You cannot jump back onto that hex during this turn. Each slime you still hold is **1 point**.
- Landing on a slime token (yours or anyone’s) puts it in your tray for **1 point** and gives a **free bounce**.
- A free bounce leaves through **one of the six sides** and keeps going straight, up to **2 hexes**. You cannot turn.
- Landing on another player: **Bounce** off them the same way, or **Bop** them (push up to 2 hexes in a straight line). A bop steals 1 goo, or a random fruit from their tray. A bop that lands on another Blorp bumps that Blorp 1 hex in the same direction. Goo Armor makes the first bop against you each round steal nothing and push only 1 hex.
- A pushed Blorp does not drop goo. They pick up fruit, slime, or a new crystal on the hex they land on. A slime picked up while pushed does not give a free bounce. Flying over a hex still leaves it behind.
- The board starts with one apple, one banana, and one bunch of grapes per player. Fruit stays in your tray when you **land** on it: apples and bananas **1** each, grapes **2**. Flying over it leaves it behind. Nothing respawns.
- There is one crystal pool per player. Crystal pools are liquid tiles with a crystal print. They are a shared **power-up deck**. Hop on one you have not used and draw the top card. The pool stays on the board. Each pool works once per player. Every card you hold is worth **1 point**.
- The tray at the bottom right lists your slimes, fruit, and cards with the points for each row. Add them up.
- First to **10** points wins.

Upgrades: **Zoomies** (first step can be a straight hop of 2 hexes), **Long Reach** (+1 move while you have fewer than 6 points), **Treehopper** (bounce or bop over a tree), **Slip-n-Slide** (under 6 points, leaving water costs 1, even uphill), **Apple Fan** (+1 per apple in your tray), **Banana Bunch** (+1 per banana in your tray), **Grape Stomp** (+1 per grape in your tray), **Goo Armor** (first bop against you each round steals nothing and pushes 1), **Super Bounce** (bops and free bounces go 3 hexes). Every card is also worth 1 point.

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
