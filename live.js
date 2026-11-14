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

// 下拉選單：真實的交易日
Object.keys(datasets).filter(name => !name.startsWith('Demo')).forEach(name => {
  const option = document.createElement('option');
  option.value = name; option.textContent = name;
  document.getElementById('liveDay').appendChild(option);
});

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
  const data = datasets[document.getElementById('liveDay').value];
  prices = data.c.slice(); ranges = data.h.map((h, k) => h - data.l[k]); times = data.t.slice();
  causalMode = true;              // 只用過去的資料判斷
  analyse();
  causalMode = false;

  // 從使用者選的時間開始
  const startAt = document.getElementById('liveStart').value || '12:00';
  const index = times.findIndex(t => t >= startAt);
  step = Math.max(0, index);
  liveLastWarn = warnLevel[step] || 0;
  liveLastMood = moods[step];

  drawChart();
  liveActive = true;
  outage = false; stale = false;
  nextStepAt = performance.now() + liveInterval();
  lastDataAt = performance.now();
  document.getElementById('outageBtn').textContent = '🔌 Simulate feed outage';
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  onFinished = stopLive;
  await play();
  liveStep(step);
  liveTimer = setInterval(checkFeed, 1000);
}

function stopLive() {
  if (!liveActive) return;
  liveActive = false;
  clearInterval(liveTimer);
  stop();
  document.title = originalTitle;
  Tone.Destination.volume.rampTo(Number(document.getElementById('volume').value) || 0, 0.5);
  document.getElementById('liveStatus').textContent = 'Stopped.';
}

// 每一筆新資料送到時（由 updateScreen 呼叫）
function liveStep(i) {
  // 圖表只畫「過去 90 分鐘」，像看盤軟體一樣往左捲
  const from = Math.max(0, i - 89);
  chart.data.labels = times.slice(from, i + 1);
  chart.data.datasets[0].data = prices.slice(from, i + 1);
  chart.data.datasets[0].segment = { borderColor: ctx => MOOD_COLORS[moods[from + ctx.p0DataIndex]] || '#8a93a6' };
  const marker = prices.slice(from, i + 1).map(() => null);
  marker[marker.length - 1] = prices[i];
  chart.data.datasets[1].data = marker;
  chart.update();

  // 瀏覽器分頁標題：切到別的分頁也看得到狀況
  const label = { heaven: 'Rising', horror: 'Falling', calm: 'Calm' }[moods[i]];
  const warn = warnLevel[i] || 0;
  document.title = (warn === 2 ? '🔴 STORM · ' : warn === 1 ? '🟡 ' : '🎵 ') + 'EUR/USD ' + prices[i].toFixed(5) + ' · ' + label;

  // 播報：情緒改變、風暴預警
  const facts = { time: times[i], price: prices[i].toFixed(5), volatilityTimesNormal: (stormRatio[i] || 1).toFixed(1) };
  if (warn > liveLastWarn) narrate('stormWarning', facts, warn === 2);
  else if (moods[i] !== liveLastMood) narrate(moods[i], facts, false);
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
    status.innerHTML = '<span style="color:#3ecf8e">● LIVE (simulated)</span> · market time ' + times[i] +
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
