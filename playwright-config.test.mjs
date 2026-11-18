import test from 'node:test';
import assert from 'node:assert/strict';

async function loadConfig(debug, ci) {
  const saved = { PWDEBUG: process.env.PWDEBUG, CI: process.env.CI };
  process.env.PWDEBUG = debug ? '1' : '';
  process.env.CI = ci ? 'true' : '';
  try {
    return (await import(`./playwright.config.mjs?debug=${debug}&ci=${ci}`)).default;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('normal local integration runs do not add action delays', async () => {
  const config = await loadConfig(false, false);
  assert.equal(config.use.launchOptions.slowMo, 0);
});

test('Inspector debug mode adds a one-second delay to browser actions', async () => {
  const config = await loadConfig(true, false);
  assert.equal(config.use.launchOptions.slowMo, 1000);
});

test('CI never adds debug delays, even when PWDEBUG is inherited', async () => {
  for (const debug of [false, true]) {
    const config = await loadConfig(debug, true);
    assert.equal(config.use.launchOptions.slowMo, 0);
  }
});
