"use strict";
/*
  Plays a full 5-round game with 15 separate phones against the real server.
  Run: node test/crowd.js   (needs playwright and its Chromium browser)
*/
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const PORT = 3114;
const N = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error("ASSERT FAILED: " + m);
};

async function main() {
  const server = spawn("node", [path.join(__dirname, "..", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const browser = await chromium.launch();
  const errors = [];
  try {
    await sleep(700);
    const players = [];
    for (let i = 0; i < N; i++) {
      const label = "P" + (i + 1);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
      // Record the biggest message this phone sends to the server.
      await ctx.addInitScript(() => {
        window.__maxSend = 0;
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (d) {
          window.__maxSend = Math.max(window.__maxSend, String(d).length);
          return send.call(this, d);
        };
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", (e) => errors.push(label + ": " + e.message));
      await page.goto("http://localhost:" + PORT + "/");
      players.push({ label, page });
    }
    const host = players[0];
    const each = (fn) => Promise.all(players.map(fn));

    await host.page.fill("#nick", "Host");
    await host.page.click("#create");
    await host.page.waitForSelector("#bigcode");
    const code = (await host.page.textContent("#bigcode")).trim();
    console.log("room", code);

    for (const p of players.slice(1)) {
      await p.page.fill("#nick", p.label);
      await p.page.fill("#jcode", code);
      await p.page.click("#join");
    }
    await each((p) => p.page.waitForFunction((n) => document.querySelectorAll(".plist li").length === n, N));
    console.log(N + " players in the lobby");

    // A 16th phone must be turned away.
    const ctx16 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p16 = await ctx16.newPage();
    p16.setDefaultTimeout(30000);
    await p16.goto("http://localhost:" + PORT + "/");
    await p16.fill("#nick", "Late");
    await p16.fill("#jcode", code);
    await p16.click("#join");
    await p16.waitForFunction(() => /room is full/i.test(document.querySelector("#err").textContent));
    console.log("16th player turned away: " + (await p16.textContent("#err")).trim());
    await ctx16.close();

    await host.page.click('[data-act="rounds"][data-n="5"]');
    await host.page.click('[data-act="start"]');

    let grand = 0;
    for (let round = 1; round <= 5; round++) {
      await each((p) => p.page.waitForSelector("#def"));
      const word = (await host.page.textContent(".head")).trim();
      await each(async (p) => {
        await p.page.fill("#def", p.label + " bluff " + word + " r" + round);
        await p.page.click("#submit");
      });
      await each((p) => p.page.waitForSelector(".opts"));
      const counts = await each((p) => p.page.locator(".opt").count());
      assert(counts.every((c) => c === N + 1), "everyone sees " + (N + 1) + " options, got " + counts.join());
      const lastLetter = (await host.page.locator(".opt .l").last().textContent()).trim();
      assert(lastLetter === "P", "options run A to P, last is " + lastLetter);
      const orders = await each(async (p) => (await p.page.locator(".opt .t").allTextContents()).map((t) => t.replace("Yours", "").trim()).join("|"));
      assert(new Set(orders).size === 1, "option order identical on all 15 phones");

      // Everyone taps an option at the same moment, which is the stress case for screen refreshes.
      await each(async (p, i) => {
        const opts = p.page.locator(".opt:not(.mine)");
        await opts.nth((i * 3 + round) % (await opts.count())).click();
      });
      await each((p) => p.page.waitForSelector(".truth"));
      const spotted = await host.page.locator(".truth .who b").count();
      const fooled = await host.page.locator(".fake .who b").count();
      const deltas = (await host.page.locator(".rank .delta").allTextContents()).map((t) => parseInt(t.replace("+", ""), 10));
      const sum = deltas.reduce((a, b) => a + b, 0);
      assert(sum === spotted * 2 + fooled, `round ${round} points: expected ${spotted * 2 + fooled}, got ${sum}`);
      assert((await host.page.locator(".rank li").count()) === N, "scoreboard lists all " + N + " players");
      grand += sum;
      const boards = await each(async (p) => (await p.page.locator(".rank .pts").allTextContents()).join());
      assert(new Set(boards).size === 1, "scoreboards match on all phones");
      console.log(`round ${round} ok: ${word}, ${N} votes, +${sum} points`);
      await host.page.click('[data-act="next"]');
    }

    await each((p) => p.page.waitForSelector(".winner"));
    const total = (await host.page.locator(".rank .pts").allTextContents()).map((t) => parseInt(t, 10)).reduce((a, b) => a + b, 0);
    assert(total === grand, `final scores add up: expected ${grand}, got ${total}`);
    const maxSend = Math.max(...(await each((p) => p.page.evaluate(() => window.__maxSend))));
    console.log("final screen ok. Winner:", (await host.page.textContent(".winner")).trim(), "| total points", total);
    console.log("largest message sent by any phone:", maxSend, "characters (server limit 8192)");
    assert(maxSend < 6000, "messages stay well under the server limit");
    assert(errors.length === 0, "page errors: " + errors.join("; "));
    console.log("\n15-PLAYER GAME PASSED");
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\nFAILED:", e.message);
    process.exit(1);
  }
);
