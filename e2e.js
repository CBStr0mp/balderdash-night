"use strict";
/*
  End-to-end test: starts the real server, opens three separate phone-sized
  browsers on the real page, and plays a full 5-round game through the screens.
  Run with: npm install && npx playwright install chromium && npm test
*/
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const PORT = 3111;
const URL = "http://localhost:" + PORT + "/";
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
    const names = ["Ann", "Ben", "Cy"];
    const players = [];
    for (const label of names) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(label + ": " + e.message));
      await page.goto(URL);
      players.push({ label, page, ctx });
    }
    const [ann, ben, cy] = players;
    const each = (fn) => Promise.all(players.map(fn));

    ann.page.on("dialog", (d) => d.dismiss());
    await ann.page.fill("#nick", "Ann");
    await ann.page.click("#create");
    await ann.page.waitForSelector("#bigcode");
    const code = (await ann.page.textContent("#bigcode")).trim();
    assert(/^[A-Z]{4}$/.test(code), "room code is 4 letters, got " + code);
    console.log("host created room", code);

    for (const p of [ben, cy]) {
      await p.page.fill("#nick", p.label);
      await p.page.fill("#jcode", code);
      await p.page.click("#join");
    }
    await each((p) => p.page.waitForFunction(() => document.querySelectorAll(".plist li").length === 3));
    assert((await ben.page.textContent("main")).includes("Waiting for Ann"), "guests see waiting-for-host");
    console.log("3 players in the lobby");

    await ann.page.click('[data-act="rounds"][data-n="5"]');
    await cy.page.waitForFunction(() => document.querySelector("main").textContent.includes("5 rounds"));
    await ann.page.click('[data-act="start"]');

    let grand = 0;
    const seen = new Set();
    for (let round = 1; round <= 5; round++) {
      await each((p) => p.page.waitForSelector("#def"));
      const word = (await ann.page.textContent(".head")).trim();
      assert(!seen.has(word), "word repeated: " + word);
      seen.add(word);
      for (const p of players) assert((await p.page.textContent(".head")).trim() === word, p.label + " sees the same word");

      for (const p of players) {
        await p.page.fill("#def", p.label + " bluffs about " + word + " in round " + round);
        await p.page.click("#submit");
      }
      await each((p) => p.page.waitForSelector(".opts"));
      const orders = [];
      for (const p of players) {
        assert((await p.page.locator(".opt").count()) === 4, p.label + " sees 4 options");
        assert((await p.page.locator(".opt.mine").count()) === 1, p.label + " has one option marked as theirs");
        orders.push((await p.page.locator(".opt .t").allTextContents()).map((t) => t.replace("Yours", "").trim()).join("|"));
      }
      assert(new Set(orders).size === 1, "option order identical on every phone");

      for (let i = 0; i < players.length; i++) {
        const opts = players[i].page.locator(".opt:not(.mine)");
        await opts.nth((i + round) % (await opts.count())).click();
      }
      await each((p) => p.page.waitForSelector(".truth"));
      assert((await ann.page.textContent(".truth .big")).length > 5, "reveal shows the real definition");

      const spotted = await ann.page.locator(".truth .who b").count();
      const fooled = await ann.page.locator(".fake .who b").count();
      const deltas = (await ann.page.locator(".rank .delta").allTextContents()).map((t) => parseInt(t.replace("+", ""), 10));
      const sum = deltas.reduce((a, b) => a + b, 0);
      assert(sum === spotted * 2 + fooled, `round ${round} points: expected ${spotted * 2 + fooled}, got ${sum}`);
      grand += sum;
      const a = (await ann.page.locator(".rank .pts").allTextContents()).join();
      const c = (await cy.page.locator(".rank .pts").allTextContents()).join();
      assert(a === c, "scoreboards match across phones");
      console.log(`round ${round} ok: ${word}, +${sum} points`);
      await ann.page.click('[data-act="next"]');
    }

    await each((p) => p.page.waitForSelector(".winner"));
    const total = (await ann.page.locator(".rank .pts").allTextContents()).map((t) => parseInt(t, 10)).reduce((a, b) => a + b, 0);
    assert(total === grand, `final scores add up: expected ${grand}, got ${total}`);
    console.log("final screen ok. Winner:", (await ann.page.textContent(".winner")).trim(), "| total points", total);

    await ann.page.click('[data-act="again"]');
    await each((p) => p.page.waitForFunction(() => document.querySelector(".bigcode") && document.querySelectorAll(".plist li").length === 3));
    console.log("play again returns everyone to the lobby");

    assert(errors.length === 0, "page errors: " + errors.join("; "));
    console.log("\nALL CHECKS PASSED");
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
