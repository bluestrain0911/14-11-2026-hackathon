// =====================================================================
// Survive mode: Survive the Market Storm
//
// You're a trader with $10,000, trading €1,000,000 each time (same as the SGX FX data).
//   ⬆ / W  : buy (bet the euro will rise)
//   ⬇ / S  : sell (bet the euro will fall)
//   Space  : run away back to cash (no gain, no loss)
// Every 1 pip (0.0001) the price moves, you make or lose $100. Hit zero and it's a "margin call" — game over.
// The chart only draws up to "now"; you can't see the future — but you can hear the market's mood in the music.
// =====================================================================

const START_MONEY = 10000;
const NOTIONAL = 1000000;        // Each trade is €1,000,000
const SWITCH_COST = 20;          // Cost of each change of direction (bid-ask spread, about 0.2 pip)
const GAME_STEPS = 120;          // How many steps per game (minutes of data); about 1.5 minutes at slow speed

let surviving = false;           // Whether survive mode is being played
let money = START_MONEY;
let position = 0;                // 1 = long, -1 = short, 0 = cash
let lastIndex = -1;
let lastMood = 'calm';
let gameOver = false;
let peakMoney = START_MONEY;

// ---------- On-screen animation state ----------
const stage = document.getElementById('stage');
const ctx = stage.getContext('2d');
let particles = [];              // Falling coins and raindrops
let popups = [];                 // Floating "+$420" text
let ghostUntil = 0;              // When the ghost disappears
let lastGhost = 0;
let frameTime = 0;
let countdownEnd = 0;            // When the 3, 2, 1 kick-off countdown ends
let paused = false;

// Scary scream (noise + a quickly falling tone)
const screamNoise = new Tone.NoiseSynth({ envelope: { attack: 0.005, decay: 0.5, sustain: 0 } }).toDestination();
screamNoise.volume.value = -10;
const screamTone = new Tone.Synth({ oscillator: { type: 'sawtooth' },
  envelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.1 } }).toDestination();
screamTone.volume.value = -12;
// Sad trombone "wah-wah-wah" when you go broke
const sadTrombone = new Tone.Synth({ oscillator: { type: 'triangle' },
  envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.5 } }).toDestination();

// =====================================================================
// Football-match atmosphere: crowd, whistle, air horn, goals
// =====================================================================
// Crowd: pink noise + band-pass filter = a big crowd making noise in the distance. Volume rises with how wild the market is
const crowdNoise = new Tone.Noise('pink');
const crowdFilter = new Tone.Filter(900, 'bandpass');
const crowdGain = new Tone.Gain(0).toDestination();
crowdNoise.connect(crowdFilter);
crowdFilter.connect(crowdGain);
let crowdBase = 0.05;

function crowdRoar() {                       // Cheer: volume jumps up, then slowly fades
  crowdFilter.frequency.rampTo(1300, 0.1);
  crowdGain.gain.rampTo(0.7, 0.15);
  setTimeout(() => { crowdGain.gain.rampTo(crowdBase, 1.8); crowdFilter.frequency.rampTo(900, 1.8); }, 700);
}
function crowdGroan() {                      // "Ohhh~": the sound drops
  crowdFilter.frequency.rampTo(1100, 0.05);
  crowdGain.gain.rampTo(0.45, 0.1);
  setTimeout(() => { crowdFilter.frequency.rampTo(300, 0.9); crowdGain.gain.rampTo(crowdBase, 1.4); }, 150);
}

// Referee's whistle
const whistleSynth = new Tone.Synth({ oscillator: { type: 'sine' },
  envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.05 } }).toDestination();
whistleSynth.volume.value = -22;              // A bit quieter, so it isn't harsh
function whistle(times, long) {
  for (let k = 0; k < times; k++) {
    const start = Tone.now() + k * 0.45;
    sfx(() => whistleSynth.triggerAttackRelease(1800, long && k === times - 1 ? 0.5 : 0.18, start + 0.02));
  }
}

// Air horn (for goals)
const airhorn = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' },
  envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.1 } }).toDestination();
airhorn.volume.value = -14;
function hornBlast() {
  sfx(() => {
    airhorn.triggerAttackRelease(['Bb4', 'D5', 'F5'], 0.25, Tone.now() + 0.02);
    airhorn.triggerAttackRelease(['Bb4', 'D5', 'F5'], 0.7, Tone.now() + 0.37);
  });
}

let moneyHistory = [];       // Money at each step, used to detect "goals"
let lastGoalStep = -99;
let lastGroanStep = -99;
let streak = 0;              // How many profitable steps in a row

// ---------- Stop-loss shield 🛡️ ----------
// 3 per game. Once on, if this trade loses more than $500 it automatically gets you back to cash.
// This is a real-world "stop-loss order": decide in advance the most you're willing to lose, and exit automatically when you hit it.
// The most you're willing to lose: players can set it in the dropdown ($300 / $500 / $1,000)
const shieldLimit = () => Number(document.getElementById('lossLimit').value) || 500;
let lastWarn = 0;            // Storm-warning level at the previous step
let promptUntil = 0;         // How long the "Protect?" prompt stays on screen
let warningsSeen = 0, warningsProtected = 0;
let shields = 3, shieldArmed = false, shieldBase = 0;

// ---------- Records for the post-match report ----------
let trades = [];             // Every trade: direction, start and end time, profit/loss
let tradeStart = null;       // When, and at what money level, the current trade started
let alignedSteps = 0;        // How many steps your moves "followed the music"
let shieldSaves = 0, goals = 0, groans = 0, lowestMoney = START_MONEY;

// Metallic "clang!" when the shield blocks a loss
const clang = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.4, release: 0.2 },
  harmonicity: 5.1, modulationIndex: 32, resonance: 3000, octaves: 1.5 }).toDestination();
clang.volume.value = -12;

function bestScore() {
  try { return Number(localStorage.getItem('ms_bestProfit')); } catch (e) { return NaN; }
}

// ---------- Start a game ----------
function startSurvival() {
  // Pick a random day and start 40–100 minutes before its "most violent moment", so you always hit a storm
  const names = Object.keys(datasets).filter(name => !name.startsWith('Demo'));
  const data = datasets[names[Math.floor(Math.random() * names.length)]];
  prices = data.c.slice(); ranges = data.h.map((h, k) => h - data.l[k]); times = data.t.slice();
  analyse();                                   // Judge mood from the whole day's data so the standard is consistent
  let peak = 0;
  ranges.forEach((r, k) => { if (r > ranges[peak]) peak = k; });
  const start = Math.max(0, Math.min(prices.length - GAME_STEPS, peak - 40 - Math.floor(Math.random() * 60)));
  const cut = arr => arr.slice(start, start + GAME_STEPS);
  prices = cut(prices); ranges = cut(ranges); times = cut(times);
  moods = cut(moods); intensity = cut(intensity); storm = cut(storm);
  stormRatio = cut(stormRatio); warnLevel = cut(warnLevel);
  lineMoods = cut(lineMoods); reversal = cut(reversal);
  computeSpikes();     // Recompute spikes with "this game's" standard, or a stormy stretch would keep firing

  money = START_MONEY; peakMoney = START_MONEY; position = 0; lastIndex = -1;
  moneyHistory = []; lastGoalStep = -99; lastGroanStep = -99; streak = 0;
  shields = 3; shieldArmed = false; shieldBase = 0;
  trades = []; tradeStart = null; alignedSteps = 0;
  shieldSaves = 0; goals = 0; groans = 0; lowestMoney = START_MONEY;
  lastWarn = 0; promptUntil = 0; warningsSeen = 0; warningsProtected = 0;
  document.getElementById('reportBox').classList.add('hidden');
  lastMood = 'calm'; gameOver = false; particles = []; popups = [];
  surviving = true;
  drawChart();
  chart.data.datasets[0].data = prices.map(() => null);   // Clear the chart first, then draw it bit by bit over time
  chart.update();
  updateStats();
  document.getElementById('surviveStart').classList.add('hidden');
  document.getElementById('narratorText').textContent = '';
  step = 0;
  onFinished = endSurvival;
  paused = false;
  // Count down 3 seconds so the player is ready, then start playing
  countdownEnd = performance.now() + 3000;
  Tone.start().then(() => {
    if (crowdNoise.state !== 'started') crowdNoise.start();
    crowdBase = 0.06;
    crowdGain.gain.rampTo(crowdBase, 1);
  });
  setTimeout(() => {
    if (!surviving) return;
    play();
    narrate('kickoff', { time: times[0] }, true);
  }, 3000);
}

// Pause / resume
function togglePause() {
  if (!surviving || gameOver || loopId === null) return;
  paused = !paused;
  if (paused) Tone.Transport.pause(); else Tone.Transport.start();
  document.getElementById('pauseBtn').textContent = paused ? '▶ Resume (P)' : '⏸ Pause (P)';
}
document.getElementById('pauseBtn').addEventListener('click', togglePause);

// Play a sound safely: if a sound effect errors, skip just that sound without affecting the game
function sfx(play) { try { play(); } catch (e) { console.warn('Sound skipped:', e.message); } }

// ---------- Every step (called from the main updateScreen) ----------
function surviveStep(i) {
  if (!surviving || gameOver) return;

  // The chart only draws up to now
  chart.data.datasets[0].data = prices.map((p, k) => (k <= i ? p : null));

  // Money: price change from the last step to this one × position size
  if (lastIndex >= 0 && i > lastIndex) {
    const change = (prices[i] - prices[lastIndex]) * NOTIONAL * position;
    money += change;
    if (Math.abs(change) >= 150) {
      popups.push({ text: (change > 0 ? '+$' : '-$') + Math.round(Math.abs(change)),
                    color: change > 0 ? '#f5c542' : '#ff4d4f', y: 0, life: 1 });
    }
  }
  if (lastIndex >= 0 && i > lastIndex) {
    const change = money - (moneyHistory[moneyHistory.length - 1] ?? START_MONEY);
    streak = change > 0 ? streak + 1 : change < 0 ? 0 : streak;
    if (streak === 5 || streak === 10 || streak === 15) {
      popups.push({ text: '🔥 ON FIRE x' + streak, color: '#ff9f1c', y: -60, life: 1.5 });
      crowdRoar();
      narrate('streak', { streak: streak, balance: Math.round(money) }, false);
    }
  }
  moneyHistory.push(money);
  lowestMoney = Math.min(lowestMoney, money);
  // Did your moves "follow the music": buy in heaven, sell in horror, hold cash when calm
  const follow = { heaven: 1, horror: -1, calm: 0 }[moodAt(i)];
  if (position === follow) alignedSteps++;
  lastIndex = i;

  // ===== Storm warning: volatility suddenly jumps → warn the player and ask about the shield =====
  const level = warnLevel[i] || 0;
  if (level > lastWarn) {
    warningsSeen++;
    playAlarm(level);
    const ratio = stormRatio[i].toFixed(1);
    if (position !== 0 && !shieldArmed) {
      if (document.getElementById('autoProtect').checked && shields > 0) {
        armShield();                                          // Auto-protect mode: turn the shield on for you
        warningsProtected++;
        popups.push({ text: '🤖 AUTO-PROTECT: shield on', color: '#7ec8ff', y: -60, life: 1.8 });
      } else {
        promptUntil = performance.now() + 5000;               // Show a "Protect?" prompt for 5 seconds
      }
    } else {
      warningsProtected++;            // Shield already on, or holding cash: already safe
    }
    popups.push({ text: (level === 2 ? '🔴 STORM WARNING ' : '🟡 STORM BREWING ') + ratio + '×',
                  color: level === 2 ? '#ff4d4f' : '#faad14', y: -100, life: 1.8 });
    narrate('stormWarning', { volatilityTimesNormal: ratio, playerPosition: ['short', 'cash', 'long'][position + 1],
                              shieldsLeft: shields }, level === 2);
  }
  lastWarn = level;

  // Shield: this trade loses more than the set amount → automatically back to cash
  if (shieldArmed && position !== 0 && money < shieldBase - shieldLimit()) triggerShield(i);
  peakMoney = Math.max(peakMoney, money);

  // Crowd volume follows how wild the market is
  crowdBase = 0.06 + storm[i] * 0.2;

  // "Goal": made $800+ over the last 5 steps → cheering, air horn, confetti
  const gained = money - (moneyHistory[Math.max(0, moneyHistory.length - 6)] ?? START_MONEY);
  if (gained >= 800 && i - lastGoalStep > 8) {
    lastGoalStep = i;
    popups.push({ text: 'GOOOAL! +$' + Math.round(gained).toLocaleString(), color: '#3ecf8e', y: -40, life: 2, big: true });
    for (let k = 0; k < 80; k++) {
      particles.push({ x: Math.random() * stage.width, y: -Math.random() * 60, vy: 80 + Math.random() * 120,
                       kind: 'confetti', color: ['#f5c542', '#3ecf8e', '#4f8cff', '#ff6b6b', '#ffffff'][k % 5] });
    }
    goals++;
    crowdRoar(); hornBlast();
    narrate('goal', { gained: Math.round(gained), balance: Math.round(money), time: times[i] }, true);
  }
  // "Conceded": lost $800+ over the last 5 steps → crowd goes "ohhh~"
  if (gained <= -800 && i - lastGroanStep > 8) {
    lastGroanStep = i;
    popups.push({ text: 'OOOH! -$' + Math.round(-gained).toLocaleString(), color: '#ff4d4f', y: -40, life: 1.6, big: true });
    groans++;
    crowdGroan();
    narrate('losing', { lost: Math.round(-gained), balance: Math.round(money), time: times[i] }, true);
  }

  // Spike: big text pops up on screen
  if (spikes[i]) {
    popups.push({ text: (spikes[i] > 0 ? '⚡ SPIKE UP!' : '💥 CRASH!'),
                  color: spikes[i] > 0 ? '#f5c542' : '#ff4d4f', y: -30, life: 1.4 });
  }

  // Narrator: talks on mood changes, spikes and big wins
  const pips = (prices[i] - prices[Math.max(0, i - 10)]) * 10000;
  const facts = { time: times[i], price: prices[i].toFixed(5), last10MinutesPips: Math.round(pips),
                  playerBalance: Math.round(money), playerPosition: ['short', 'cash', 'long'][position + 1] };
  if (storm[i] > 0.85 && Math.abs(pips) > 15) narrate('spike', facts, false);
  else if (moodAt(i) !== lastMood) narrate(moodAt(i), facts, false);
  else if (money > START_MONEY * 1.3 && Math.random() < 0.05) narrate('bigWin', facts, false);
  lastMood = moodAt(i);

  // When it's really scary, a ghost occasionally jumps out
  const now = performance.now();
  if (!document.getElementById('gentleMode').checked &&
      moodAt(i) === 'horror' && intensity[i] > 0.6 && now - lastGhost > 8000 && Math.random() < 0.15) {
    ghostUntil = now + 450; lastGhost = now;
    sfx(() => {
      screamNoise.triggerAttackRelease('8n', Tone.now() + 0.02);
      screamTone.triggerAttackRelease(900, 0.5, Tone.now() + 0.02);
      screamTone.frequency.exponentialRampTo(150, 0.5);      // The pitch drops quickly, like a scream
    });
  }

  // Went broke
  if (money <= 0) {
    money = 0; gameOver = true;
    stop();
    sfx(() => ['G3', 'F#3', 'F3', 'E3'].forEach((note, k) =>
      sadTrombone.triggerAttackRelease(note, k === 3 ? 1.2 : 0.4, Tone.now() + 0.02 + k * 0.45)));
    whistle(3, true);
    crowdGroan();
    setTimeout(() => crowdGain.gain.rampTo(0, 2), 2500);
    narrate('marginCall', facts, true);
    finishText('MARGIN CALL! You went broke at ' + times[i] + '.');
    closeTrade();
    setTimeout(() => showReport(matchStats(true)), 2500);
  }
  updateStats();
}

function endSurvival() {
  if (gameOver || !surviving) return;
  gameOver = true;
  const result = money - START_MONEY;
  whistle(3, true);                            // Final whistle: peep, peep, peeep~
  if (result > 0) { crowdRoar(); hornBlast(); } else crowdGroan();
  setTimeout(() => crowdGain.gain.rampTo(0, 2), 3000);
  // Personal best
  const best = bestScore();
  const newBest = isNaN(best) || result > best;
  if (newBest) {
    try { localStorage.setItem('ms_bestProfit', String(Math.round(result))); } catch (e) { /* If it can't be saved, never mind */ }
    popups.push({ text: '🏆 NEW PERSONAL BEST!', color: '#f5c542', y: -80, life: 2.5, big: true });
  }
  narrate(newBest ? 'newBest' : result > 0 ? 'end' : 'endLoss',
          { finalBalance: Math.round(money), profit: Math.round(result) }, true);
  finishText('FULL TIME! You finished with $' + Math.round(money).toLocaleString() +
             ' (' + (result >= 0 ? '+' : '') + Math.round(result / START_MONEY * 100) + '%).' +
             (newBest ? ' 🏆 New personal best!' : ''));
  closeTrade();
  setTimeout(() => showReport(matchStats(false)), 2500);
}

// Close the current trade and add it to the record
function closeTrade() {
  if (position !== 0 && tradeStart) {
    trades.push({ side: position === 1 ? 'long' : 'short', from: tradeStart.time,
                  to: times[Math.max(0, lastIndex)], pnl: Math.round(money - tradeStart.money) });
  }
  tradeStart = null;
}

// Collect this game's stats for the post-match report
function matchStats(brokeOut) {
  const sorted = trades.slice().sort((a, b) => b.pnl - a.pnl);
  return {
    day: document.getElementById('surviveDay')?.textContent || '',
    from: times[0], to: times[times.length - 1],
    finalBalance: Math.round(money), profit: Math.round(money - START_MONEY),
    wentBroke: brokeOut,
    trades: trades.length, bestTrade: sorted[0] || null, worstTrade: sorted[sorted.length - 1] || null,
    followedMusicPercent: Math.round(alignedSteps / Math.max(1, lastIndex + 1) * 100),
    shieldsUsed: 3 - shields, shieldSaves: shieldSaves, goals: goals, bigLosses: groans,
    stormWarnings: warningsSeen, stormWarningsProtected: warningsProtected, lossLimit: shieldLimit(),
    lowestBalance: Math.round(lowestMoney),
    tradeLog: trades.slice(0, 20)
  };
}

function finishText(message) {
  document.getElementById('surviveMessage').textContent = message;
  const button = document.getElementById('surviveStart');
  button.textContent = '▶ Play again';
  button.classList.remove('hidden');
}

// ---------- Controls: buy, sell, run away ----------
function setPosition(newPosition) {
  if (!surviving || gameOver || newPosition === position) return;
  closeTrade();                                                     // The previous trade has ended; record it
  if (position !== 0 || newPosition !== 0) money -= SWITCH_COST;   // Changing direction costs a small fee
  position = newPosition;
  if (position !== 0) tradeStart = { money: money, time: times[Math.max(0, lastIndex)] };
  if (shieldArmed) shieldBase = money;                              // The shield is recalculated for the new trade
  updateStats();
  // The narrator comments on your move (like a commentator on a player)
  const event = newPosition === 1 ? 'playerLong' : newPosition === -1 ? 'playerShort' : 'playerCash';
  narrate(event, { mood: moodAt(Math.max(0, lastIndex)), balance: Math.round(money) }, false);
}

// Turn on the shield
function armShield() {
  if (!surviving || gameOver || shieldArmed || shields <= 0) return;
  shields--; shieldArmed = true; shieldBase = money;
  if (performance.now() < promptUntil) { warningsProtected++; promptUntil = 0; }   // The player heard the warning and turned on the shield
  popups.push({ text: '🛡 SHIELD ON (max loss $' + shieldLimit() + ')', color: '#7ec8ff', y: -20, life: 1.4 });
  sfx(() => clang.triggerAttackRelease('C4', '16n', Tone.now() + 0.02));
  updateStats();
}

// The shield blocked a loss
function triggerShield(i) {
  const saved = Math.round(shieldBase - money);
  shieldArmed = false;
  shieldSaves++;
  setPosition(0);
  popups.push({ text: '🛡 SHIELD SAVED YOU! (-$' + saved + ')', color: '#7ec8ff', y: -40, life: 2, big: true });
  sfx(() => clang.triggerAttackRelease('C3', '8n', Tone.now() + 0.05));
  narrate('shield', { time: times[i], lossCapped: saved, balance: Math.round(money) }, true);
}

document.getElementById('shieldBtn').addEventListener('click', armShield);

// Playable without looking at the screen: press B to hear the current status read aloud
function speakStatus() {
  if (!surviving) return;
  const i = Math.max(0, lastIndex);
  const profit = Math.round(money - START_MONEY);
  const where = position === 1 ? 'You are long.' : position === -1 ? 'You are short.' : 'You are in cash.';
  const market = { heaven: 'The market is rising', horror: 'The market is falling', calm: 'The market is flat' }[moodAt(i) || 'calm'];
  const strength = moodAt(i) === 'calm' ? '.' : intensity[i] > 0.6 ? ', strongly.' : ', gently.';
  speakLine('Balance ' + Math.round(money) + ' dollars, ' + (profit >= 0 ? 'up ' : 'down ') + Math.abs(profit) + '. ' +
            where + ' ' + market + strength + ' ' + shields + ' shields left' + (shieldArmed ? ', shield on.' : '.'), 'calm');
}
document.getElementById('statusBtn').addEventListener('click', speakStatus);
document.getElementById('buyBtn').addEventListener('click', () => setPosition(1));
document.getElementById('cashBtn').addEventListener('click', () => setPosition(0));
document.getElementById('sellBtn').addEventListener('click', () => setPosition(-1));
document.getElementById('surviveStart').addEventListener('click', startSurvival);

document.addEventListener('keydown', event => {
  if (!surviving) return;
  if (event.key === 'ArrowUp' || event.key === 'w') { setPosition(1); event.preventDefault(); }
  if (event.key === 'ArrowDown' || event.key === 's') { setPosition(-1); event.preventDefault(); }
  if (event.key === ' ') { setPosition(0); event.preventDefault(); }
  if (event.key === 'p') togglePause();
  if (event.key === 'e') armShield();
  if (event.key === 'b') speakStatus();
});

function updateStats() {
  document.getElementById('moneyText').textContent = '$' + Math.round(money).toLocaleString();
  const profit = money - START_MONEY;
  const profitText = document.getElementById('profitText');
  profitText.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(Math.round(profit)).toLocaleString();
  profitText.style.color = profit >= 0 ? '#3ecf8e' : '#ff4d4f';
  document.getElementById('shieldText').textContent =
    (shieldArmed ? '🛡 ON  ' : '') + shields + ' left';
  document.getElementById('positionText').textContent =
    position === 1 ? '⬆ Long (betting up)' : position === -1 ? '⬇ Short (betting down)' : '💵 Cash (safe)';
}

// =====================================================================
// Draw the trader and effects (about 60 times a second)
// =====================================================================
function drawStage(t) {
  requestAnimationFrame(drawStage);
  const dt = Math.min(0.05, (t - frameTime) / 1000);
  frameTime = t;
  const W = stage.width, H = stage.height;

  const i = Math.max(0, lastIndex);
  const mood = surviving && moods.length ? moodAt(i) : 'calm';
  const power = surviving && intensity.length ? intensity[i] : 0;
  const losing = money < START_MONEY;

  // In horror the whole screen shakes
  const shake = mood === 'horror' ? power * 6 : 0;
  ctx.save();
  ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // Background: heaven = golden sky, horror = dark red, calm = night sky
  ctx.fillStyle = mood === 'heaven' ? '#3a3216' : mood === 'horror' ? '#2a0b0f' : '#141824';
  ctx.fillRect(-10, -10, W + 20, H + 20);
  ctx.fillStyle = '#20242e';
  ctx.fillRect(-10, H - 30, W + 20, 40);              // Floor

  // Falling items: coins in heaven, red rain in horror
  if (surviving && !gameOver && !paused && particles.length < 120) {   // Nothing falls while paused; the count is capped
    const rate = mood === 'calm' ? 0 : 0.2 + power * 0.8;
    if (Math.random() < rate) {
      particles.push({ x: Math.random() * W, y: -10, vy: 60 + Math.random() * 80,
                       kind: mood === 'heaven' ? 'coin' : 'rain' });
    }
  }
  particles = particles.filter(p => p.y < H);
  particles.forEach(p => {
    p.y += p.vy * dt * (p.kind === 'rain' ? 3 : 1);
    if (p.kind === 'coin') {
      ctx.fillStyle = '#f5c542';
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8901c'; ctx.fillRect(p.x - 1, p.y - 3, 2, 6);
    } else if (p.kind === 'confetti') {
      ctx.fillStyle = p.color; ctx.fillRect(p.x + Math.sin(p.y / 15) * 6, p.y, 6, 4);
    } else {
      ctx.fillStyle = '#a3262a'; ctx.fillRect(p.x, p.y, 2, 10);
    }
  });

  // In heaven, two little angels hover nearby
  if (mood === 'heaven') {
    [W * 0.25, W * 0.75].forEach((x, k) => {
      const y = 50 + Math.sin(t / 300 + k) * 10;
      ctx.fillStyle = '#fff6d5';
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();          // Head
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 16, 10, 3, 0, 0, Math.PI * 2); ctx.stroke();  // Halo
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(x - 16, y + 4, 10, 5, -0.5, 0, Math.PI * 2); ctx.fill();  // Wings
      ctx.beginPath(); ctx.ellipse(x + 16, y + 4, 10, 5, 0.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  drawTrader(W / 2, H - 30, mood, power, losing, t);

  // Floating "+$420" text
  popups = popups.filter(p => p.life > 0);
  popups.forEach(p => {
    p.y += 40 * dt; p.life -= dt * 0.8;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    if (p.big) {                                   // Goal / conceded: big centred text
      ctx.font = 'bold ' + Math.round(Math.min(44, W / 11)) + 'px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.text, W / 2, H / 2 - 20 - p.y * 0.3);
      ctx.textAlign = 'left';
    } else {
      ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.text, W / 2, H / 2 - 40 - p.y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  });

  // Hints: tell beginners "what the music means now and what you can do"
  if (surviving && !gameOver && document.getElementById('hintsOn').checked && performance.now() > countdownEnd) {
    const hint = mood === 'heaven' ? '⬆ Rising → Buy'
               : mood === 'horror' ? '⬇ Falling → Sell'
               : '➡ Flat → Cash';
    ctx.font = 'bold 18px system-ui';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, H - 72, ctx.measureText(hint).width + 20, 30);
    ctx.fillStyle = mood === 'heaven' ? '#f5c542' : mood === 'horror' ? '#ff6b6b' : '#cfd6e4';
    ctx.fillText(hint, 20, H - 50);
  }

  // Scoreboard: like the top-right corner of a TV broadcast
  if (surviving && lastIndex >= 0) drawScoreboard(W, t);

  // Storm warning + "Protect?" prompt (top-left)
  const warn = surviving && !gameOver && lastIndex >= 0 ? warnLevel[lastIndex] : 0;
  if (warn > 0) {
    const flash = Math.floor(t / 400) % 2 === 0;
    ctx.fillStyle = warn === 2 ? (flash ? '#ff4d4f' : '#a3262a') : '#faad14';
    ctx.font = 'bold 16px system-ui';
    const warnText = (warn === 2 ? '🔴 STORM ' : '🟡 Choppy ') + stormRatio[lastIndex].toFixed(1) + '×';
    const warnW = ctx.measureText(warnText).width + 20;
    ctx.fillRect(10, 10, warnW, 32);
    ctx.fillStyle = warn === 2 ? '#ffffff' : '#3a2e00';
    ctx.fillText(warnText, 20, 32);
    if (performance.now() < promptUntil && position !== 0 && !shieldArmed) {
      const ask = shields > 0 ? '🛡 Protect? Press E' : '⚠️ No shields → Space';
      ctx.font = 'bold 16px system-ui';
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(10, 46, ctx.measureText(ask).width + 20, 32);
      ctx.fillStyle = '#7ec8ff';
      ctx.fillText(ask, 20, 68);
    }
  }

  // Kick-off countdown
  const left = countdownEnd - performance.now();
  if (surviving && left > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    ctx.font = 'bold 72px system-ui'; ctx.fillText(String(Math.ceil(left / 1000)), W / 2, H / 2 + 10);
    ctx.font = 'bold 16px system-ui';
    ctx.fillText('W Buy · S Sell · Space Cash', W / 2, H / 2 + 50);
    ctx.textAlign = 'left';
  }

  // Pause screen
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2); ctx.textAlign = 'left';
  }

  // Broke screen
  if (gameOver && money <= 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff4d4f'; ctx.font = 'bold ' + Math.round(Math.min(44, W / 10)) + 'px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('MARGIN CALL', W / 2, H / 2);
    ctx.font = '14px system-ui'; ctx.fillStyle = '#e8e8e8';
    ctx.fillText('The bank has taken your lunch money', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // Ghost! (doesn't shake; covers the whole screen)
  if (performance.now() < ghostUntil) drawGhost(W, H);
}

// Scoreboard: only "LIVE + time + progress" — money and shields are already on the big cards to the right
function drawScoreboard(W, t) {
  ctx.font = 'bold 16px system-ui';
  const text = times[lastIndex] + '  ·  ' + (lastIndex + 1) + '/' + prices.length;
  const boxW = 70 + ctx.measureText(text).width + 14, x = W - boxW - 10, y = 10;
  ctx.fillStyle = 'rgba(10,12,18,0.85)'; ctx.fillRect(x, y, boxW, 32);
  ctx.fillStyle = '#d93a3a'; ctx.fillRect(x, y, 64, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(Math.floor(t / 500) % 2 ? '● LIVE' : '  LIVE', x + 6, y + 22);
  ctx.fillStyle = '#cfd6e4';
  ctx.fillText(text, x + 74, y + 22);
  if (streak >= 3) { ctx.fillStyle = '#ff9f1c'; ctx.fillText('🔥 ' + streak, x - 54, y + 22); }
}

// Draw a pixel-art trader
function drawTrader(x, ground, mood, power, losing, t) {
  let bob = 0, jitter = 0, armsUp = false;
  if (mood === 'heaven') { bob = Math.abs(Math.sin(t / (220 - power * 100))) * (8 + power * 10); armsUp = true; }
  if (mood === 'horror') jitter = (Math.random() - 0.5) * (2 + power * 6);
  const cx = x + jitter, top = ground - 90 - bob;

  ctx.fillStyle = '#1f3a6e'; ctx.fillRect(cx - 9, ground - 30 - bob, 7, 30 + bob);   // Legs
  ctx.fillRect(cx + 2, ground - 30 - bob, 7, 30 + bob);
  ctx.fillStyle = '#2b4c8c'; ctx.fillRect(cx - 18, top + 30, 36, 32);                 // Suit
  ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 5, top + 30, 10, 14);                  // Shirt
  ctx.fillStyle = '#d93a3a'; ctx.fillRect(cx - 2, top + 32, 4, 16);                   // Tie

  ctx.fillStyle = '#2b4c8c';                                                          // Hands
  if (armsUp) {
    ctx.fillRect(cx - 30, top + 6, 8, 30); ctx.fillRect(cx + 22, top + 6, 8, 30);
  } else if (mood === 'horror') {
    ctx.fillRect(cx - 26, top + 12, 8, 24); ctx.fillRect(cx + 18, top + 12, 8, 24);   // Hands on head
  } else {
    ctx.fillRect(cx - 26, top + 32, 8, 26); ctx.fillRect(cx + 18, top + 32, 8, 26);
  }

  ctx.fillStyle = mood === 'horror' ? '#d9e3c4' : '#f1c9a0';                          // Head (green with fright)
  ctx.fillRect(cx - 15, top, 30, 30);
  ctx.fillStyle = '#3b2a1a'; ctx.fillRect(cx - 15, top - 4, 30, 8);                   // Hair

  ctx.fillStyle = '#111';                                                              // Eyes
  const eye = mood === 'horror' ? 4 : 3;
  ctx.fillRect(cx - 8, top + 10, eye, eye); ctx.fillRect(cx + 5, top + 10, eye, eye);

  // Mouth: big grin in heaven, wide open in horror, when calm depends on whether you're losing
  if (mood === 'heaven') { ctx.fillRect(cx - 7, top + 20, 14, 3); ctx.fillRect(cx - 8, top + 18, 2, 3); ctx.fillRect(cx + 6, top + 18, 2, 3); }
  else if (mood === 'horror') ctx.fillRect(cx - 4, top + 18, 8, 8);
  else if (losing) { ctx.fillRect(cx - 7, top + 22, 14, 2); ctx.fillRect(cx - 8, top + 24, 2, 2); ctx.fillRect(cx + 6, top + 24, 2, 2); }
  else ctx.fillRect(cx - 6, top + 21, 12, 2);

  if (mood === 'horror') {                                                             // Cold sweat
    ctx.fillStyle = '#7ec8ff';
    const drop = (t / 6) % 30;
    ctx.fillRect(cx + 16, top + 4 + drop, 3, 5); ctx.fillRect(cx - 19, top + 10 + (drop + 12) % 30, 3, 5);
  }
  if (losing && money < START_MONEY * 0.6) {                                           // Losing a lot: tears
    ctx.fillStyle = '#7ec8ff';
    ctx.fillRect(cx - 8, top + 14 + (t / 10) % 12, 2, 4); ctx.fillRect(cx + 6, top + 14 + (t / 10 + 6) % 12, 2, 4);
  }

  // Position marker above the head
  ctx.font = '20px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(position === 1 ? '📈' : position === -1 ? '📉' : '💵', cx, top - 12);
  ctx.textAlign = 'left';
}

// Ghost that jumps out to scare you
function drawGhost(W, H) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2 - 10, 70, Math.PI, 0);
  ctx.lineTo(W / 2 + 70, H / 2 + 70);
  for (let k = 0; k < 5; k++) ctx.lineTo(W / 2 + 70 - (k + 0.5) * 28, H / 2 + (k % 2 ? 70 : 50));
  ctx.lineTo(W / 2 - 70, H / 2 + 70);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(W / 2 - 25, H / 2 - 15, 12, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(W / 2 + 25, H / 2 - 15, 12, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(W / 2, H / 2 + 25, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff4d4f'; ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('SELL!!!', W / 2, 36);
  ctx.textAlign = 'left';
}

requestAnimationFrame(drawStage);
