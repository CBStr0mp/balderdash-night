"use strict";
/* Checks a phone that refreshes mid-round and a host who disappears. Run: node test/resilience.js */
const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error("ASSERT FAILED: " + m); };
(async () => {
  const server = spawn("node", [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: "3113", GRACE_MS: "6000" }, stdio: "ignore" });
  await sleep(700);
  const browser = await chromium.launch();
  try {
    const mk = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const p = await c.newPage(); p.setDefaultTimeout(20000); await p.goto("http://localhost:3113/"); return p; };
    const [a, b, c] = [await mk(), await mk(), await mk()];
    await a.fill("#nick", "Ann"); await a.click("#create"); await a.waitForSelector("#bigcode");
    const code = (await a.textContent("#bigcode")).trim();
    for (const [p, n] of [[b, "Ben"], [c, "Cy"]]) { await p.fill("#nick", n); await p.fill("#jcode", code); await p.click("#join"); }
    await a.waitForFunction(() => document.querySelectorAll(".plist li").length === 3);
    await a.click('[data-act="start"]');
    await Promise.all([a, b, c].map((p) => p.waitForSelector("#def")));

    // Ben locks in an answer, then refreshes. He should land back in the game with his answer kept.
    await b.fill("#def", "Ben's saved bluff"); await b.click("#submit");
    await b.waitForSelector(".mine-text");
    await b.reload();
    await b.waitForSelector(".mine-text", { timeout: 20000 });
    assert((await b.textContent(".mine-text")).includes("Ben's saved bluff"), "answer kept after refresh");
    await a.waitForFunction(() => document.querySelectorAll(".chip.done").length === 1);
    assert((await a.locator(".chip").count()) === 3, "all three players still shown on Ann's screen");
    console.log("refresh mid-round ok: Ben is back with his answer");

    // Finish the round so we can see the vote screen on a phone.
    await a.fill("#def", "Ann bluff"); await a.click("#submit");
    await c.fill("#def", "Cy bluff"); await c.click("#submit");
    await Promise.all([a, b, c].map((p) => p.waitForSelector(".opts")));
    await a.screenshot({ path: path.join(__dirname, "vote-screen.png") });

    // Host drops (tab closed). Others see the dropped-host screen, one takes over, game goes on.
    await a.context().close();
    await b.waitForSelector('[data-act="takeover"]', { timeout: 20000 });
    await b.click('[data-act="takeover"]');
    await b.waitForSelector(".opts", { timeout: 10000 });
    await c.waitForSelector(".opts");
    console.log("host drop ok: Ben took over and the vote screen is back");
    await b.locator(".opt:not(.mine)").first().click();
    await c.locator(".opt:not(.mine)").first().click();
    await sleep(500);
    const phase = await b.textContent("main");
    console.log("votes after takeover:", /2 of 2 voted|The real definition/.test(phase) ? "counted (2 remaining players, round moved on)" : "still waiting: " + phase.slice(0, 120).replace(/\s+/g, " "));
    console.log("\nRESILIENCE CHECKS DONE");
  } finally { await browser.close().catch(() => {}); server.kill(); }
})().then(() => process.exit(0), (e) => { console.error("FAILED:", e.message); process.exit(1); });
