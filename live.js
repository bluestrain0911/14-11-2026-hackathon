// =====================================================================
// Live monitor mode (simulated)
//
// The FX market is closed at weekends, so we use real historical SGX FX data to "pretend" to be live:
// the next minute's price only arrives after a stretch of real time (e.g. 5 seconds), just like a real market feed.
//
// The biggest difference from replay mode: here we "can't see the future".
//   - The music can only judge from past prices (causalMode), so it switches a little after the price — just like real use
//   - The storm warning only ever looked at the past, so it's exactly the same
// Also demonstrates a "feed outage": with no new data we must not pretend the market is moving → music fades out, voice warning.
// =====================================================================

let liveActive = false;
let nextStepAt = 0;          // When the next data point "arrives"
let lastDataAt = 0;          // When the previous data point arrived
let outage = false;          // Simulated feed outage
let stale = false;           // Whether we've gone too long without new data
let liveTimer = null;
let liveLastWarn = 0, liveLastMood = 'calm';
const originalTitle = document.title;

// =====================================================================
// Background modes: not annoying even when left open for a long time
//   continuous: music plays all the time (demo, learning)
//   ambient   : very quiet normally; when something happens the music swells for 30 seconds, then slowly fades
//   alerts    : completely silent normally; when something happens, only a 1–2 second cue plays
// Alarm sounds, spike sounds and voice announcements are unaffected and always play
// =====================================================================
const AMBIENT_LEVEL = 0.08;
let swellTimer = null;
let heartbeatTimer = null;
const bgMode = () => document.getElementById('bgMode').value;

// =====================================================================
// Quiet mode: calm for long enough → music and commentary stop; they resume on a clear rise/fall, a storm or a spike
// =====================================================================
let liveQuiet = false;       // Are we "quiet" right now
let calmStreak = 0;          // How many minutes in a row it's been calm (market time)
let quietAnchor = 0;         // Price level when we went quiet
let normalMove = 1e-9;       // How far it "normally" moves in 10 minutes (from historical data)
const quietAfter = () => Number(document.getElementById('quietAfter').value);   // 0 = off

function goQuiet() {
  liveQuiet = true;
  musicBus.gain.rampTo(0, 3);                      // Fade the music out slowly
  if (typeof stopSpeech === 'function') stopSpeech();
  // Explain why the sound stopped, otherwise people think it's broken
  if (document.getElementById('narratorOn').checked) speakLine('Market is quiet. Pausing the music until something happens.', 'pro');
  else playCue('calm');
}
function wakeUp() {
  liveQuiet = false;
  applyBackgroundMode();                           // Bring the music back (according to the current background mode)
}

// Short cues: rising = three notes going up; falling = low notes going down; back to calm = one soft ding
const cue = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' },
  envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.4 } }).toDestination();
cue.volume.value = -8;
function playCue(mood) {
  const now = Tone.now();
  const notes = mood === 'heaven' ? ['C5', 'E5', 'G5'] : mood === 'horror' ? ['G3', 'Eb3', 'C3'] : ['A5'];
  try { notes.forEach((n, k) => cue.triggerAttackRelease(n, '8n', now + 0.02 + k * 0.15)); } catch (e) { console.warn('Cue skipped:', e.message); }
}

function applyBackgroundMode() {
  clearTimeout(swellTimer);
  const level = bgMode() === 'continuous' ? 1 : bgMode() === 'ambient' ? AMBIENT_LEVEL : 0;
  musicBus.gain.rampTo(level, 1);
}

// Something happened: ambient → music swells for 30 seconds; alerts → play a short cue
function somethingHappened(kind) {
  if (bgMode() === 'ambient') {
    musicBus.gain.rampTo(1, 1.5);
    clearTimeout(swellTimer);
    swellTimer = setTimeout(() => { if (bgMode() === 'ambient') musicBus.gain.rampTo(AMBIENT_LEVEL, 5); }, 30000);
  } else if (bgMode() === 'alerts' && kind) {
    playCue(kind);
  }
}

// Regular "heartbeat" ping: tells the user the system is alive (silent during a feed outage)
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  const every = Number(document.getElementById('heartbeat').value);
  if (!every) return;
  heartbeatTimer = setInterval(() => {
    if (!liveActive || stale) return;
    const now = Tone.now();
    cue.triggerAttackRelease('E6', '32n', now, 0.3);
    cue.triggerAttackRelease('E6', '32n', now + 0.12, 0.3);
  }, every);
}
document.getElementById('bgMode').addEventListener('change', () => { if (liveActive) applyBackgroundMode(); });
document.getElementById('heartbeat').addEventListener('change', () => { if (liveActive) startHeartbeat(); });

// Dropdown: all 53 days, or a single day
const realDays = Object.keys(datasets).filter(name => !name.startsWith('Demo'));
['ALL', ...realDays].forEach(name => {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name === 'ALL' ? 'All ' + realDays.length + ' days (Jul–Aug 2026)' : name;
  document.getElementById('liveDay').appendChild(option);
});

// Which points the chart shows (70,000+ minutes won't fit, so the history is sampled)
let shownIndex = [];         // Which data index each point on the chart corresponds to
let liveFrom = 0;            // Which index "live" playback starts from (= the 90% mark)
let liveEvery = 1;           // Draw one point every this many live data points
let liveShown = [];          // Which data the chart is currently drawing

// Join the chosen data into one continuous time series
function buildSeries(choice) {
  const days = choice === 'ALL' ? realDays : [choice];
  prices = []; ranges = []; times = [];
  days.forEach(name => {
    const d = datasets[name];
    const date = name.replace(/^EUR\/USD \w+ (\d+ \w+).*$/, '$1');          // e.g. "14 Jul"
    d.c.forEach((c, k) => {
      prices.push(c);
      ranges.push(d.h[k] - d.l[k]);
      times.push(days.length > 1 ? date + ' ' + d.t[k] : d.t[k]);
    });
  });
}

const liveInterval = () => Number(document.getElementById('liveSpeed').value);

// Data "delivery": uses its own timer, separate from the music engine.
// So even if the music stalls or the tab is in the background, data keeps coming; "feed down" only shows when there really is no data (simulated outage).
let feedTimer = null;
function feedTick() {
  if (!liveActive || outage) return;
  const now = performance.now();
  if (now < nextStepAt) return;
  if (step >= prices.length - 1) {
    stopLive();
    document.getElementById('liveStatus').innerHTML =
      '<b>⏹ Reached the end of the data (100%).</b> Press Start monitoring to run it again.';
    speakLine('End of data. Monitoring stopped.', 'pro');
    return;
  }
  step++;
  nextStepAt = now + liveInterval();
  lastDataAt = now;
  // Data is flowing again: if we'd flagged an outage, restore the music automatically (no need to press Restore)
  if (stale) {
    stale = false;
    Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 1);
    speakLine('Data is back. Resuming.', 'pro');
  }
  updateScreen(step);
}

async function startLive() {
  stopLive();
  buildSeries(document.getElementById('liveDay').value);
  causalMode = true;              // Judge using past data only
  analyse();
  causalMode = false;
  causalLines = true;             // Colour the chart "past-only"
  computeRecentScales();

  // Draw the first 90% straight away as "history that already happened", then play live from the 90% mark to 100%
  liveFrom = Math.floor(prices.length * 0.9);
  posEntry = prices[liveFrom];     // Assume we entered the trade when the live data started
  step = liveFrom;
  const historyEvery = Math.max(1, Math.ceil(liveFrom / 500));
  liveEvery = 1;                  // Draw every live data point
  shownIndex = [];
  for (let k = 0; k < liveFrom; k += historyEvery) shownIndex.push(k);
  liveLastWarn = warnLevel[step] || 0;
  liveLastMood = moodAt(step);

  chart.data.datasets[0].segment = {
    // History = solid grey line; the live part = coloured by mood
    borderColor: ctx => liveShown[ctx.p0DataIndex] < liveFrom ? '#6b7385' : lineColor(liveShown[ctx.p0DataIndex])
  };
  document.getElementById('liveStatus').textContent =
    'History (grey line, first 90%): ' + times[0] + ' → ' + times[liveFrom] + '. Live from ' + times[liveFrom] +
    ' to ' + times[times.length - 1] + ' (last 10%).';
  liveActive = true;
  outage = false; stale = false;
  liveQuiet = false; calmStreak = 0;
  // How far it normally moves in 10 minutes: median over the 90% of historical data
  const moves = [];
  for (let k = Math.max(10, liveFrom - 5000); k < liveFrom; k++) moves.push(Math.abs(prices[k] - prices[k - 10]));
  moves.sort((a, b) => a - b);
  normalMove = moves[Math.floor(moves.length / 2)] || 1e-9;
  nextStepAt = performance.now() + liveInterval();
  lastDataAt = performance.now();
  document.getElementById('outageBtn').textContent = '🔌 Simulate feed outage';
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  onFinished = stopLive;
  applyBackgroundMode();
  startHeartbeat();
  await play();
  updateScreen(step);
  feedTimer = setInterval(feedTick, 50);
  liveTimer = setInterval(checkFeed, 1000);
}

function stopLive() {
  if (!liveActive) return;
  liveActive = false;
  causalLines = false;
  clearInterval(liveTimer);
  clearInterval(feedTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(swellTimer);
  stop();
  musicBus.gain.rampTo(1, 0.5);           // Leaving live mode: other modes' music goes back to normal
  document.title = originalTitle;
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  document.getElementById('liveStatus').textContent = 'Stopped.';
}

// Called whenever a new data point arrives (from updateScreen)
function liveStep(i) {
  try { updateExposure(i); } catch (e) { console.warn('Exposure skipped:', e.message); }
  // Two ways to view the chart:
  //   Recent (default): only the last 4 hours, one point per minute; the line keeps scrolling left so you can see it moving
  //   Full: the first 90% of history (sampled) + every live point
  if (i >= liveFrom && shownIndex[shownIndex.length - 1] !== i) shownIndex.push(i);
  let shown;
  if (document.getElementById('liveView').value === 'recent') {
    const from = Math.max(0, i - 239);
    shown = [];
    for (let k = from; k <= i; k++) shown.push(k);
  } else {
    shown = shownIndex[shownIndex.length - 1] === i ? shownIndex : shownIndex.concat([i]);
  }
  liveShown = shown;
  fitYAxis(shown.map(k => prices[k]));
  chart.data.labels = shown.map(k => times[k]);
  chart.data.datasets[0].data = shown.map(k => prices[k]);
  const marker = shown.map(() => null);
  marker[marker.length - 1] = prices[i];
  chart.data.datasets[1].data = marker;
  chart.update();

  // Browser tab title: you can see the state even from another tab
  const label = { heaven: 'Rising', horror: 'Falling', calm: 'Calm' }[moodAt(i)];
  const warn = warnLevel[i] || 0;
  document.title = (liveQuiet ? '😴 ' : warn === 2 ? '🔴 STORM · ' : warn === 1 ? '🟡 ' : '🎵 ') + 'EUR/USD ' + prices[i].toFixed(5) + ' · ' + label;

  // Quiet mode (consistent with the line colours):
  //   "Calm" = the line has been all grey for the last N minutes, with no warnings or spikes → music and commentary stop
  //   "Wake up" = the line is the same coloured direction (gold / red …) for 2 minutes in a row, or the price moves far from where it went quiet, or a warning or spike appears
  const N = quietAfter();
  const wasQuiet = liveQuiet;
  if (N && !liveQuiet && i - N >= liveFrom) {
    let allGrey = true;
    for (let k = i - N + 1; k <= i; k++) if (moodAt(k) !== 'calm' || warnLevel[k] || spikes[k]) { allGrey = false; break; }
    if (allGrey) { quietAnchor = prices[i]; goQuiet(); }
  } else if (liveQuiet) {
    const coloured = moodAt(i) !== 'calm' && moodAt(i) === moodAt(i - 1);
    const bigMove = Math.abs(prices[i] - quietAnchor) > 2 * normalMove;
    if (coloured || bigMove || (warnLevel[i] || 0) > 0 || spikes[i]) wakeUp();   // Something clear is happening: wake up
  }

  // Commentary: mood changes, storm warnings
  const facts = { time: times[i], price: prices[i].toFixed(5), volatilityTimesNormal: (stormRatio[i] || 1).toFixed(1) };
  const ex = exposureAt(i);
  if (ex) facts.myPositionCouldSwingIn10MinUSD = Math.round(ex.risk10);
  if (liveQuiet) { /* Quiet: no commentary */ }
  else if (warn > liveLastWarn) { narrate('stormWarning', facts, warn === 2); somethingHappened(null); }   // The alarm sound plays anyway
  else if (moodAt(i) !== liveLastMood || wasQuiet) { narrate(moodAt(i), facts, wasQuiet); somethingHappened(moodAt(i)); }
  if (spikes[i] && !liveQuiet) { somethingHappened(null); if (Math.abs(spikes[i]) > 25 * spikeScale) narrate('spike', facts, true); }
  liveLastWarn = warn;
  liveLastMood = moodAt(i);
}

// Check once a second: how long since the data last updated?
function checkFeed() {
  if (!liveActive) return;
  // Safety net: if the data timer isn't advancing for any reason, push it one step from here (except during a simulated outage)
  if (!outage && performance.now() - lastDataAt > liveInterval() * 1.5 + 1000) {
    console.warn('Live feed timer was late — advancing it from the checker. step=', step);
    nextStepAt = 0;
    try { feedTick(); } catch (e) { console.error('feedTick failed:', e); }
    clearInterval(feedTimer); feedTimer = setInterval(feedTick, 50);
  }
  const secondsAgo = (performance.now() - lastDataAt) / 1000;
  const limit = Math.max(8, liveInterval() / 1000 * 3);    // No data for more than 3 update periods counts as an outage
  const status = document.getElementById('liveStatus');
  const i = step;

  // (A stalled music engine is handled by the main watchdog)

  // Sound was paused by the browser (e.g. after the computer slept): this has nothing to do with the data, so say so separately
  if (Tone.context.state !== 'running') {
    status.innerHTML = '<b style="color:#faad14">🔇 Sound is paused by the browser — click anywhere on the page to resume.</b>';
    return;
  }

  if (secondsAgo > limit && !stale) {
    stale = true;
    Tone.Destination.volume.rampTo(-40, 2);                 // Fade out the music: with no data we must not pretend the market is moving
    document.title = '⚠️ NO DATA · EUR/USD';
    speakLine('Warning. No new market data for ' + Math.round(secondsAgo) + ' seconds. The feed may be down.', 'pro');
  }
  if (stale) {
    status.innerHTML = '<b style="color:#ff4d4f">⚠️ No new data for ' + Math.round(secondsAgo) +
      ' s — feed may be down. Music paused so it never pretends the market is moving.</b>';
  } else {
    // Tell the user in one plain sentence "what the market is doing now"
    let calmFor = 0;
    for (let k = i; k >= liveFrom && moodAt(k) === 'calm' && !warnLevel[k]; k--) calmFor++;
    const warn = warnLevel[i] || 0;
    const summary = liveQuiet ? '<b style="color:#cfd6e4">😴 Quiet market — music and voice paused until a big move</b>'
      : warn === 2 ? '<b style="color:#ff4d4f">🔴 Storm — prices are moving violently</b>'
      : warn === 1 ? '<b style="color:#faad14">🟡 Getting choppy — volatility is rising</b>'
      : moodAt(i) === 'heaven' ? '<b style="color:#f5c542">📈 Rising</b>'
      : moodAt(i) === 'horror' ? '<b style="color:#ff6b6b">📉 Falling</b>'
      : '<b style="color:#cfd6e4">😌 Market is calm — no big moves' + (calmFor > 1 ? ' for ' + calmFor + ' minutes' : '') + '</b>';
    status.innerHTML = summary + '<br><span style="color:#3ecf8e">● LIVE (simulated)</span> · market time ' + times[i] +
      ' · EUR/USD ' + prices[i].toFixed(5) + ' · last update ' + Math.round(secondsAgo) + ' s ago';
  }
}

// Simulate a feed outage / restore
document.getElementById('outageBtn').addEventListener('click', () => {
  if (!liveActive) return;
  outage = !outage;
  document.getElementById('outageBtn').textContent = outage ? '🔌 Restore feed' : '🔌 Simulate feed outage';
  if (!outage && stale) {
    stale = false;
    nextStepAt = performance.now();
    lastDataAt = performance.now();
    Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 1);
    speakLine('Feed restored. Back to live.', 'pro');
  }
});

document.getElementById('liveStartBtn').addEventListener('click', startLive);
document.getElementById('liveView').addEventListener('change', () => { if (liveActive) liveStep(step); });
document.getElementById('liveStopBtn').addEventListener('click', stopLive);


// =====================================================================
// My position (Challenge 1: Understand your exposure)
// Turn market moves into "my money": current P&L, risk over the next 10 minutes, today's biggest one-minute hit
// For a €1 position, each 0.0001 move (1 pip) = $0.0001; €1,000,000 → $100 per pip
// =====================================================================
let posEntry = null;
const posSide = () => Number(document.getElementById('posSide').value);
const posSize = () => Math.max(0, Number(document.getElementById('posSize').value) || 0);
const usd = x => (x < 0 ? '−' : x > 0 ? '+' : '') + '$' + Math.abs(Math.round(x)).toLocaleString('en-GB');

function exposureAt(i) {
  const side = posSide(), size = posSize();
  if (!side || !size || posEntry === null) return null;
  const pnl = side * size * (prices[i] - posEntry);
  // High-low range over the last 10 minutes: volatility persists, so the next 10 minutes will "probably" swing about as much
  const from = Math.max(0, i - 9);
  let hi = -Infinity, lo = Infinity;
  for (let k = from; k <= i; k++) { hi = Math.max(hi, prices[k] + (ranges[k] || 0) / 2); lo = Math.min(lo, prices[k] - (ranges[k] || 0) / 2); }
  const risk10 = size * (hi - lo);
  // The biggest one-minute move so far today (the worst hit)
  let worst = 0;
  for (let k = 1; k <= i; k++) worst = Math.max(worst, Math.abs(prices[k] - prices[k - 1]));
  return { pnl, risk10, worstHit: size * worst, perPip: size * 0.0001 };
}

function updateExposure(i) {
  const box = document.getElementById('exposureText');
  const e = exposureAt(i);
  if (!e) { box.innerHTML = '<span>' + (posSide() ? 'Start monitoring to see your exposure.' : 'No position — nothing at risk.') + '</span>'; return; }
  const level = warnLevel[i] || 0;
  const advice = level === 2 ? '🔴 Storm: consider cutting size or setting a stop-loss now'
               : level === 1 ? '🟡 Storm brewing: check your stop-loss'
               : '😌 Normal conditions';
  box.innerHTML =
    '<div>Profit / loss now<b style="color:' + (e.pnl >= 0 ? '#3ddc97' : '#ff6b6b') + '">' + usd(e.pnl) + '</b></div>' +
    '<div class="risk-' + level + '">Could swing in next 10 min<b>±' + usd(e.risk10).replace('+', '') + '</b></div>' +
    '<div>Worst 1-minute jolt today<b>' + usd(-e.worstHit) + '</b></div>' +
    '<div>Each pip is worth<b>$' + Math.round(e.perPip).toLocaleString('en-GB') + '</b></div>' +
    '<div style="grid-column:1/-1">' + advice + '</div>';
}

function enterAtCurrent() { if (liveActive) { posEntry = prices[step]; updateExposure(step); } }
document.getElementById('posEnterBtn').addEventListener('click', enterAtCurrent);
document.getElementById('posSide').addEventListener('change', enterAtCurrent);
document.getElementById('posSize').addEventListener('input', () => { if (liveActive) updateExposure(step); });
