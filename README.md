# Balderdash Night

A bluffing word game for phones. Each round shows a real, strange word. Everyone secretly writes a fake definition, then everyone votes for the one they think is real. Picking the real definition scores 2 points. Each vote your fake gets scores 1 point.

3 to 15 players, 5, 8 or 10 rounds, 49 words. No accounts. Anyone with the link can play. With a big group the vote screen gets long (up to 16 answers, lettered A to P), so players scroll to find their pick.

## Put it online (about 10 minutes, free)

You need a free GitHub account and a free Render account. Do this on a laptop if you can. It is much easier than on a phone.

1. **Make a GitHub repository.** On github.com choose New repository, name it `balderdash-night`, and leave it empty.
2. **Upload these files.** On the new repository's page choose "uploading an existing file", drag in everything from this folder (`server.js`, `package.json`, `render.yaml`, `public`, `test`, `README.md`, `.gitignore`), and commit.
3. **Create the service on Render.** At render.com choose New, then Blueprint (or New, then Web Service), connect your GitHub account and pick the repository. With a Blueprint, Render reads `render.yaml` and fills everything in. For a manual Web Service use:
   - Runtime: Node
   - Build command: `npm install --omit=dev`
   - Start command: `npm start`
   - Instance type: Free
4. **Wait for the first deploy.** When it says Live, Render shows your address, something like `https://balderdash-night.onrender.com`.
5. **Send that address to your friends.** Open it yourself, enter a nickname and choose "Start a new game". Give everyone the 4-letter code.

## What to expect on the free plan

Checked against Render's free-plan page when this was built. Render can change its terms, so look at render.com/docs/free if something differs.

- **Cold start.** A free service goes to sleep after 15 minutes with no traffic and takes about a minute to wake. **Open the address a couple of minutes before game night** so it is awake. Messages during a game keep it awake. The page shows a "waking the server" note if someone arrives while it is asleep.
- **750 free hours a month.** That is plenty for a game night. A sleeping service does not use hours.
- **No saved data.** Games live in memory only. If the service restarts, games in progress end. That is fine for a party game, and nothing about your friends is stored.

Other hosts that run a Node server also work (Railway, Fly.io, a small VPS). The only requirement is that WebSockets are allowed, and the server listens on the `PORT` that the host provides.

## Try it on your own computer first

```
npm install
npm start
```

Open http://localhost:3000. To try it with phones on the same Wi-Fi, open `http://<your computer's local address>:3000` on each phone.

## Tests

```
npx playwright install chromium
npm test
node test/resilience.js
```

`npm test` plays a full 5-round game with three simulated phones and checks the words, voting, scoring and final screen. `test/resilience.js` checks a phone refreshing mid-round and the host dropping out. `test/crowd.js` plays a full game with 15 phones and checks that a 16th is turned away.

## How it works

`server.js` serves the page and relays each phone's small state to every other phone. The game rules run in the browsers. The server only checks sizes and never reads game content.

- A phone that refreshes or loses signal rejoins on its own with its answer and vote kept. The server holds a dropped phone's state for 25 seconds.
- If the host's phone drops for good, everyone sees "The host dropped out" and any player can tap "Take over as host" to carry on from where the game stopped.
- The host, not the server, decides when a round ends: when every player has answered or voted, or when the host taps "Move on without the rest".

## Adding words

The word list is the `WORDS` array near the top of the script in `public/index.html`. Each entry is `{w:"word", p:"noun", d:"Its real definition."}`. Use real, obscure words with accurate definitions, since the game depends on the real one being true.
