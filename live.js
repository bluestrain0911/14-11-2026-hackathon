// =====================================================================
// 即時監控模式（模擬）
//
// 外匯市場週末休市，所以用 SGX FX 的真實歷史資料「假裝」即時：
// 每隔一段真實時間（例如 5 秒）才送來下一分鐘的價格，就像接上真的市場一樣。
//
// 跟回放模式最大的不同：這裡「看不到未來」。
//   - 音樂只能用過去的價格判斷（causalMode），所以會比價格慢一點才切換 —— 這就是真實使用時的情況
//   - 風暴預警本來就只看過去，所以完全一樣
// 另外示範「資料中斷」：沒有新資料時，不能假裝市場還在動 → 音樂淡出、語音警告。
// =====================================================================

let liveActive = false;
let nextStepAt = 0;          // 下一筆資料什麼時候「送到」
let lastDataAt = 0;          // 上一筆資料是什麼時候送到的
let outage = false;          // 模擬資料中斷
let stale = false;           // 是否已經太久沒有新資料
let liveTimer = null;
let liveLastWarn = 0, liveLastMood = 'calm';
const originalTitle = document.title;

// =====================================================================
// 背景模式：長時間開著也不會煩
//   continuous：一直播音樂（demo、學習用）
//   ambient   ：平常音量很小；有事發生時音樂漸強 30 秒，再慢慢變小
//   alerts    ：平常完全安靜；有事發生時只播 1～2 秒的短提示音
// 警報聲、暴衝音效、語音播報不受影響，永遠都會響
// =====================================================================
const AMBIENT_LEVEL = 0.08;
let swellTimer = null;
let heartbeatTimer = null;
const bgMode = () => document.getElementById('bgMode').value;

// 短提示音：上漲 = 往上的三個音；下跌 = 往下的低音；回到平靜 = 一聲輕輕的叮
const cue = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' },
  envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.4 } }).toDestination();
cue.volume.value = -8;
function playCue(mood) {
  const now = Tone.now();
  const notes = mood === 'heaven' ? ['C5', 'E5', 'G5'] : mood === 'horror' ? ['G3', 'Eb3', 'C3'] : ['A5'];
  notes.forEach((n, k) => cue.triggerAttackRelease(n, '8n', now + k * 0.15));
}

function applyBackgroundMode() {
  clearTimeout(swellTimer);
  const level = bgMode() === 'continuous' ? 1 : bgMode() === 'ambient' ? AMBIENT_LEVEL : 0;
  musicBus.gain.rampTo(level, 1);
}

// 有事發生：ambient → 音樂漸強 30 秒；alerts → 播短提示音
function somethingHappened(kind) {
  if (bgMode() === 'ambient') {
    musicBus.gain.rampTo(1, 1.5);
    clearTimeout(swellTimer);
    swellTimer = setTimeout(() => { if (bgMode() === 'ambient') musicBus.gain.rampTo(AMBIENT_LEVEL, 5); }, 30000);
  } else if (bgMode() === 'alerts' && kind) {
    playCue(kind);
  }
}

// 定時的「心跳聲」：告訴使用者系統還活著（資料中斷時不響）
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

// 下拉選單：全部 53 天，或某一天
const realDays = Object.keys(datasets).filter(name => !name.startsWith('Demo'));
['ALL', ...realDays].forEach(name => {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name === 'ALL' ? 'All ' + realDays.length + ' days (Jul–Aug 2026)' : name;
  document.getElementById('liveDay').appendChild(option);
});

// 圖表要顯示哪些點（全部 7 萬多分鐘畫不下，所以歷史部分會抽樣）
let shownIndex = [];         // 圖上每個點對應到資料的第幾筆
let liveFrom = 0;            // 從第幾筆開始「即時」播放（= 90% 的位置）
let liveEvery = 1;           // 即時部分每幾筆畫一個點

// 把選到的資料接成一條連續的時間序列
function buildSeries(choice) {
  const days = choice === 'ALL' ? realDays : [choice];
  prices = []; ranges = []; times = [];
  days.forEach(name => {
    const d = datasets[name];
    const date = name.replace(/^EUR\/USD \w+ (\d+ \w+).*$/, '$1');          // 例如 "14 Jul"
    d.c.forEach((c, k) => {
      prices.push(c);
      ranges.push(d.h[k] - d.l[k]);
      times.push(days.length > 1 ? date + ' ' + d.t[k] : d.t[k]);
    });
  });
}

const liveInterval = () => Number(document.getElementById('liveSpeed').value);

// 由主程式的 onTick 呼叫：該不該前進到下一筆資料？
function liveShouldAdvance() {
  const now = performance.now();
  if (outage || now < nextStepAt) return false;
  nextStepAt = now + liveInterval();
  lastDataAt = now;
  return true;
}

async function startLive() {
  stopLive();
  buildSeries(document.getElementById('liveDay').value);
  causalMode = true;              // 只用過去的資料判斷
  analyse();
  causalMode = false;

  // 前 90% 當作「已經發生的歷史」直接畫出來，從 90% 的位置開始即時播放到 100%
  liveFrom = Math.floor(prices.length * 0.9);
  step = liveFrom;
  const historyEvery = Math.max(1, Math.ceil(liveFrom / 500));
  liveEvery = Math.max(1, Math.ceil((prices.length - liveFrom) / 500));
  shownIndex = [];
  for (let k = 0; k < liveFrom; k += historyEvery) shownIndex.push(k);
  liveLastWarn = warnLevel[step] || 0;
  liveLastMood = moods[step];

  chart.data.datasets[0].segment = {
    // 歷史 = 灰色實線；即時的部分 = 依照情緒上色
    borderColor: ctx => shownIndex[ctx.p0DataIndex] < liveFrom ? '#6b7385' : (MOOD_COLORS[moods[shownIndex[ctx.p0DataIndex]]] || '#8a93a6')
  };
  document.getElementById('liveStatus').textContent =
    'History (grey line, first 90%): ' + times[0] + ' → ' + times[liveFrom] + '. Live from ' + times[liveFrom] +
    ' to ' + times[times.length - 1] + ' (last 10%).';
  liveActive = true;
  outage = false; stale = false;
  nextStepAt = performance.now() + liveInterval();
  lastDataAt = performance.now();
  document.getElementById('outageBtn').textContent = '🔌 Simulate feed outage';
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  onFinished = stopLive;
  applyBackgroundMode();
  startHeartbeat();
  await play();
  liveStep(step);
  liveTimer = setInterval(checkFeed, 1000);
}

function stopLive() {
  if (!liveActive) return;
  liveActive = false;
  clearInterval(liveTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(swellTimer);
  stop();
  musicBus.gain.rampTo(1, 0.5);           // 離開即時模式，其他模式的音樂恢復正常
  document.title = originalTitle;
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  document.getElementById('liveStatus').textContent = 'Stopped.';
}

// 每一筆新資料送到時（由 updateScreen 呼叫）
function liveStep(i) {
  // 圖表：前 90% 的歷史（灰色虛線）+ 即時進來的新資料（依照情緒上色）
  if (i >= liveFrom && ((i - liveFrom) % liveEvery === 0 || shownIndex[shownIndex.length - 1] < i - liveEvery)) {
    if (shownIndex[shownIndex.length - 1] !== i) shownIndex.push(i);
  }
  const shown = shownIndex[shownIndex.length - 1] === i ? shownIndex : shownIndex.concat([i]);
  chart.data.labels = shown.map(k => times[k]);
  chart.data.datasets[0].data = shown.map(k => prices[k]);
  const marker = shown.map(() => null);
  marker[marker.length - 1] = prices[i];
  chart.data.datasets[1].data = marker;
  chart.update();

  // 瀏覽器分頁標題：切到別的分頁也看得到狀況
  const label = { heaven: 'Rising', horror: 'Falling', calm: 'Calm' }[moods[i]];
  const warn = warnLevel[i] || 0;
  document.title = (warn === 2 ? '🔴 STORM · ' : warn === 1 ? '🟡 ' : '🎵 ') + 'EUR/USD ' + prices[i].toFixed(5) + ' · ' + label;

  // 播報：情緒改變、風暴預警
  const facts = { time: times[i], price: prices[i].toFixed(5), volatilityTimesNormal: (stormRatio[i] || 1).toFixed(1) };
  if (warn > liveLastWarn) { narrate('stormWarning', facts, warn === 2); somethingHappened(null); }   // 警報聲本來就會響
  else if (moods[i] !== liveLastMood) { narrate(moods[i], facts, false); somethingHappened(moods[i]); }
  if (spikes[i]) somethingHappened(null);                                                          // 暴衝音效本來就會響
  liveLastWarn = warn;
  liveLastMood = moods[i];
}

// 每秒檢查一次：資料多久沒更新了？
function checkFeed() {
  if (!liveActive) return;
  const secondsAgo = (performance.now() - lastDataAt) / 1000;
  const limit = Math.max(8, liveInterval() / 1000 * 3);    // 超過 3 個更新週期沒資料就算中斷
  const status = document.getElementById('liveStatus');
  const i = Math.max(0, step - 1);

  if (secondsAgo > limit && !stale) {
    stale = true;
    Tone.Destination.volume.rampTo(-40, 2);                 // 音樂淡出：沒有資料就不能假裝市場還在動
    document.title = '⚠️ NO DATA · EUR/USD';
    speakLine('Warning. No new market data for ' + Math.round(secondsAgo) + ' seconds. The feed may be down.', 'stormWarning');
  }
  if (stale) {
    status.innerHTML = '<b style="color:#ff4d4f">⚠️ No new data for ' + Math.round(secondsAgo) +
      ' s — feed may be down. Music paused so it never pretends the market is moving.</b>';
  } else {
    // 用一句白話告訴使用者「現在市場怎麼樣」
    let calmFor = 0;
    for (let k = i; k >= liveFrom && moods[k] === 'calm' && !warnLevel[k]; k--) calmFor++;
    const warn = warnLevel[i] || 0;
    const summary = warn === 2 ? '<b style="color:#ff4d4f">🔴 Storm — prices are moving violently</b>'
      : warn === 1 ? '<b style="color:#faad14">🟡 Getting choppy — volatility is rising</b>'
      : moods[i] === 'heaven' ? '<b style="color:#f5c542">📈 Rising</b>'
      : moods[i] === 'horror' ? '<b style="color:#ff6b6b">📉 Falling</b>'
      : '<b style="color:#cfd6e4">😌 Market is calm — no big moves' + (calmFor > 1 ? ' for ' + calmFor + ' minutes' : '') + '</b>';
    status.innerHTML = summary + '<br><span style="color:#3ecf8e">● LIVE (simulated)</span> · market time ' + times[i] +
      ' · EUR/USD ' + prices[i].toFixed(5) + ' · last update ' + Math.round(secondsAgo) + ' s ago';
  }
}

// 模擬資料中斷／恢復
document.getElementById('outageBtn').addEventListener('click', () => {
  if (!liveActive) return;
  outage = !outage;
  document.getElementById('outageBtn').textContent = outage ? '🔌 Restore feed' : '🔌 Simulate feed outage';
  if (!outage && stale) {
    stale = false;
    nextStepAt = performance.now();
    lastDataAt = performance.now();
    Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 1);
    speakLine('Feed restored. Back to live.', 'calm');
  }
});

document.getElementById('liveStartBtn').addEventListener('click', startLive);
document.getElementById('liveStopBtn').addEventListener('click', stopLive);
