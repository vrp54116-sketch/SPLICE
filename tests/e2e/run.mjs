/**
 * SPLICE Playwright E2E — runs against the already-running single-service app.
 * Desktop 1440×900 and mobile 390×844. Uses system Chrome; no browser download.
 * Run: npm run build && npm start &  then  npm run test:e2e
 *
 * Nav clicks are dispatched on the DOM (not Playwright actionability clicks)
 * because Lenis smooth-scroll hijacks document scrolling and can stall
 * scrollIntoView. The app is a SPA, so a native .click() is equivalent.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.SPLICE_BASE ?? 'http://localhost:3001';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to a Chromium binary.`);
  process.exit(2);
}

const results = [];
const ok = (name, detail = '') => { results.push({ name, pass: true, detail }); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { results.push({ name, pass: false, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };
async function step(name, fn) {
  try { await fn(); } catch (e) { bad(name, String(e.message).split('\n')[0].slice(0, 160)); }
}

/** Click a <button> by its text, optionally scoped to a CSS selector. */
async function clickButton(page, text, scope) {
  const clicked = await page.evaluate(({ text, scope }) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const buttons = [...root.querySelectorAll('button')];
    const exact = buttons.find((b) => b.innerText.trim() === text);
    const target = exact ?? buttons.find((b) => b.innerText.includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, { text, scope });
  if (!clicked) throw new Error(`button "${text}" not found${scope ? ` in ${scope}` : ''}`);
}
async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  for (const device of [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ]) {
    console.log(`\n[${device.name} ${device.width}×${device.height}]`);
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1,
      isMobile: device.mobile, hasTouch: device.mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await step('home loads', async () => {
      const res = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      if (!res?.ok()) throw new Error(`HTTP ${res?.status()}`);
      ok('home loads', `HTTP ${res.status()}`);
    });
    await step('boot screen clears', async () => {
      await page.getByText('Warming the projector').waitFor({ state: 'detached', timeout: 12000 });
      await visibleText(page, 'Long video in.');
      ok('boot screen clears', 'home hero visible');
    });
    await step('API health', async () => {
      const health = await page.evaluate(async () => (await fetch('/api/health')).json());
      if (health.status !== 'ok') throw new Error(JSON.stringify(health));
      ok('API health', `${health.llm} / ${health.rights}`);
    });
    await step('no horizontal overflow', async () => {
      const o = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, v: Math.round(visualViewport.width) }));
      if (o.w > o.v + 2) throw new Error(`scrollWidth ${o.w} > visible ${o.v}`);
      ok('no horizontal overflow', `${o.w}px / ${o.v}px`);
    });

    if (device.mobile) {
      for (const [label, heading] of [
        ['Library', 'Library · your local archive'],
        ['Stats', 'Studio stats · local analytics'],
        ['Settings', 'Settings · the control room'],
      ]) {
        await step(`${label} page`, async () => {
          await clickButton(page, label, 'nav[aria-label="Mobile navigation"]');
          await visibleText(page, heading);
          ok(`${label} page`, heading);
        });
      }
      await step('Configure page (New tab)', async () => {
        await clickButton(page, 'New', 'nav[aria-label="Mobile navigation"]');
        await visibleText(page, 'Set the splice.');
        // The 14 controls are semantic groups (segmented/toggle/search/ranges),
        // not 14 bare <input> tags — assert on their labels, not a tag count.
        const expected = ['Clip count', 'Resolution', 'Duration', 'Aspect ratio', 'Language',
          'Processing timeframe', 'Captions', 'Caption style', 'Auto hook card', 'Hook tone',
          'Reframe mode', 'AI music', 'Split screen', 'Rights policy'];
        const found = await page.evaluate((labels) => {
          const text = document.querySelector('main').innerText;
          const aria = [...document.querySelectorAll('main [aria-label], main .label')]
            .map((e) => e.getAttribute('aria-label') || e.textContent.trim()).join(' ');
          return labels.filter((l) => `${text} ${aria}`.includes(l));
        }, expected);
        if (found.length < 14) throw new Error(`only ${found.length}/14 controls: ${expected.filter((l) => !found.includes(l)).join(', ')}`);
        ok('Configure page (New tab)', `${found.length}/14 controls present`);
      });
    } else {
      for (const [label, heading] of [
        ['Library', 'Library · your local archive'],
        ['Brand Templates', 'Brand templates · the identity lab'],
        ['Social Scheduler', "Social scheduler · plan, don't upload"],
        ['Studio Stats', 'Studio stats · local analytics'],
        ['Settings', 'Settings · the control room'],
        ['Processing', 'Processing · the cutting room'],
        ['Home', 'Long video in.'],
      ]) {
        await step(`${label} page`, async () => {
          await clickButton(page, label, 'aside nav[aria-label="Main navigation"]');
          await visibleText(page, heading);
          ok(`${label} page`, heading);
        });
      }
      await step('Configure page', async () => {
        await clickButton(page, 'New project', 'header');
        await visibleText(page, 'Set the splice.');
        ok('Configure page', 'Set the splice.');
      });
      await step('command palette opens', async () => {
        await page.keyboard.press('Control+k');
        await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible', timeout: 6000 });
        ok('command palette opens', '⌘K / Ctrl+K');
        await page.keyboard.press('Escape');
      });
      await step('Results page', async () => {
        await clickButton(page, 'Home', 'aside nav[aria-label="Main navigation"]');
        await visibleText(page, 'Studio Demo Reel');
        await clickButton(page, 'Studio Demo Reel');
        await visibleText(page, 'Results · the contact sheet');
        ok('Results page', 'demo project opened');
      });
      await step('Editor page', async () => {
        const clicked = await page.evaluate(() => {
          const b = document.querySelector('button.absolute.bottom-2.left-2.right-2');
          if (!b) return false; b.click(); return true;
        });
        if (!clicked) throw new Error('clip open button not found');
        await visibleText(page, 'Editor · cut');
        ok('Editor page', 'clip opened');
      });
      await step('CLAIM SHIELD panel', async () => {
        await clickButton(page, 'CLAIM SHIELD', 'main');
        await visibleText(page, 'All 16 detector parameters');
        ok('CLAIM SHIELD panel', '16 parameters, heatmap, legal repairs');
      });
    }

    const relevant = errors.filter((e) => !/favicon|ResizeObserver|tesseract|mediapipe|CVDisplayLink/i.test(e));
    relevant.length === 0 ? ok('no console errors') : bad('no console errors', relevant.slice(0, 3).join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} E2E checks passed.`);
if (failed.length) process.exit(1);
