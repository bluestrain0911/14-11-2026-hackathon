// =====================================================================
// 生存模式：Survive the Market Storm
//
// 你是一個交易員，手上有 $10,000，每次交易 100 萬歐元（跟 SGX FX 的資料一樣）。
//   ⬆ / W  ：買進（賭歐元會漲）
//   ⬇ / S  ：賣出（賭歐元會跌）
//   空白鍵 ：逃跑，換回現金（不賺也不賠）
// 價格每動 1 pip（0.0001），你就賺或賠 $100。錢歸零就「追繳保證金」，遊戲結束。
// 圖表只會畫到「現在」，未來看不到 —— 但音樂聽得出來市場的情緒。
// =====================================================================

const START_MONEY = 10000;
const NOTIONAL = 1000000;        // 每次交易 100 萬歐元
const SWITCH_COST = 20;          // 每次換方向的手續費（買賣價差，約 0.2 pip）
const GAME_STEPS = 120;          // 一局播幾步（幾分鐘的資料），慢速下大約 1.5 分鐘

let surviving = false;           // 是否正在玩生存模式
let money = START_MONEY;
let position = 0;                // 1 = 買進、-1 = 賣出、0 = 現金
let lastIndex = -1;
let lastMood = 'calm';
let gameOver = false;
let peakMoney = START_MONEY;

// ---------- 畫面上的動畫狀態 ----------
const stage = document.getElementById('stage');
const ctx = stage.getContext('2d');
let particles = [];              // 掉下來的金幣、雨滴
let popups = [];                 // 浮出來的「+$420」文字
let ghostUntil = 0;              // 鬼出現到什麼時候
let lastGhost = 0;
let frameTime = 0;
let countdownEnd = 0;            // 開局倒數 3、2、1 到什麼時候
let paused = false;

// 嚇人的尖叫聲（雜訊 + 快速下降的音）
const screamNoise = new Tone.NoiseSynth({ envelope: { attack: 0.005, decay: 0.5, sustain: 0 } }).toDestination();
screamNoise.volume.value = -10;
const screamTone = new Tone.Synth({ oscillator: { type: 'sawtooth' },
  envelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.1 } }).toDestination();
screamTone.volume.value = -12;
// 輸光時的「哇哇哇～」悲傷長號
const sadTrombone = new Tone.Synth({ oscillator: { type: 'triangle' },
  envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.5 } }).toDestination();

// ---------- 開始一局 ----------
function startSurvival() {
  // 隨機挑一天，從「最劇烈的時刻」之前 40～100 分鐘開始，確保一定會遇到風暴
  const names = Object.keys(datasets).filter(name => !name.startsWith('Demo'));
  const data = datasets[names[Math.floor(Math.random() * names.length)]];
  prices = data.c.slice(); ranges = data.h.map((h, k) => h - data.l[k]); times = data.t.slice();
  analyse();                                   // 用整天的資料判斷情緒，標準才一致
  let peak = 0;
  ranges.forEach((r, k) => { if (r > ranges[peak]) peak = k; });
  const start = Math.max(0, Math.min(prices.length - GAME_STEPS, peak - 40 - Math.floor(Math.random() * 60)));
  const cut = arr => arr.slice(start, start + GAME_STEPS);
  prices = cut(prices); ranges = cut(ranges); times = cut(times);
  moods = cut(moods); intensity = cut(intensity); storm = cut(storm);
  computeSpikes();     // 暴衝用「這一局」的標準重新算，不然風暴時段會一直響

  money = START_MONEY; peakMoney = START_MONEY; position = 0; lastIndex = -1;
  lastMood = 'calm'; gameOver = false; particles = []; popups = [];
  surviving = true;
  drawChart();
  chart.data.datasets[0].data = prices.map(() => null);   // 圖表先清空，跟著時間慢慢畫出來
  chart.update();
  updateStats();
  document.getElementById('surviveStart').classList.add('hidden');
  document.getElementById('narratorText').textContent = '';
  step = 0;
  onFinished = endSurvival;
  paused = false;
  // 先倒數 3 秒，讓玩家準備好，再開始播
  countdownEnd = performance.now() + 3000;
  setTimeout(() => {
    if (!surviving) return;
    play();
    narrate('calm', { time: times[0] }, true);
  }, 3000);
}

// 暫停／繼續
function togglePause() {
  if (!surviving || gameOver || loopId === null) return;
  paused = !paused;
  if (paused) Tone.Transport.pause(); else Tone.Transport.start();
  document.getElementById('pauseBtn').textContent = paused ? '▶ Resume (P)' : '⏸ Pause (P)';
}
document.getElementById('pauseBtn').addEventListener('click', togglePause);

// ---------- 每走一步（由主程式的 updateScreen 呼叫） ----------
function surviveStep(i) {
  if (!surviving || gameOver) return;

  // 圖表只畫到現在
  chart.data.datasets[0].data = prices.map((p, k) => (k <= i ? p : null));

  // 算錢：上一步到這一步的價格變化 × 部位大小
  if (lastIndex >= 0 && i > lastIndex) {
    const change = (prices[i] - prices[lastIndex]) * NOTIONAL * position;
    money += change;
    if (Math.abs(change) >= 150) {
      popups.push({ text: (change > 0 ? '+$' : '-$') + Math.round(Math.abs(change)),
                    color: change > 0 ? '#f5c542' : '#ff4d4f', y: 0, life: 1 });
    }
  }
  lastIndex = i;
  peakMoney = Math.max(peakMoney, money);

  // 暴衝：畫面上跳出大字
  if (spikes[i]) {
    popups.push({ text: (spikes[i] > 0 ? '⚡ SPIKE UP!' : '💥 CRASH!'),
                  color: spikes[i] > 0 ? '#f5c542' : '#ff4d4f', y: -30, life: 1.4 });
  }

  // 播報員：情緒改變、暴衝、大賺的時候講話
  const pips = (prices[i] - prices[Math.max(0, i - 10)]) * 10000;
  const facts = { time: times[i], price: prices[i].toFixed(5), last10MinutesPips: Math.round(pips),
                  playerBalance: Math.round(money), playerPosition: ['short', 'cash', 'long'][position + 1] };
  if (storm[i] > 0.85 && Math.abs(pips) > 15) narrate('spike', facts, false);
  else if (moods[i] !== lastMood) narrate(moods[i], facts, false);
  else if (money > START_MONEY * 1.3 && Math.random() < 0.05) narrate('bigWin', facts, false);
  lastMood = moods[i];

  // 恐怖得很厲害時，偶爾有鬼跳出來
  const now = performance.now();
  if (moods[i] === 'horror' && intensity[i] > 0.6 && now - lastGhost > 8000 && Math.random() < 0.15) {
    ghostUntil = now + 450; lastGhost = now;
    screamNoise.triggerAttackRelease('8n');
    screamTone.triggerAttackRelease(900, 0.5);
    screamTone.frequency.exponentialRampTo(150, 0.5);      // 音高快速往下掉，像尖叫
  }

  // 輸光了
  if (money <= 0) {
    money = 0; gameOver = true;
    stop();
    ['G3', 'F#3', 'F3', 'E3'].forEach((note, k) =>
      sadTrombone.triggerAttackRelease(note, k === 3 ? 1.2 : 0.4, Tone.now() + k * 0.45));
    narrate('marginCall', facts, true);
    finishText('MARGIN CALL! You went broke at ' + times[i] + '.');
  }
  updateStats();
}

function endSurvival() {
  if (gameOver || !surviving) return;
  gameOver = true;
  const result = money - START_MONEY;
  narrate('end', { finalBalance: Math.round(money), profit: Math.round(result) }, true);
  finishText('Closing bell! You finished with $' + Math.round(money).toLocaleString() +
             ' (' + (result >= 0 ? '+' : '') + Math.round(result / START_MONEY * 100) + '%).');
}

function finishText(message) {
  document.getElementById('surviveMessage').textContent = message;
  const button = document.getElementById('surviveStart');
  button.textContent = '▶ Play again';
  button.classList.remove('hidden');
}

// ---------- 操作：買、賣、逃跑 ----------
function setPosition(newPosition) {
  if (!surviving || gameOver || newPosition === position) return;
  if (position !== 0 || newPosition !== 0) money -= SWITCH_COST;   // 換方向要付一點手續費
  position = newPosition;
  updateStats();
}

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
});

function updateStats() {
  document.getElementById('moneyText').textContent = '$' + Math.round(money).toLocaleString();
  const profit = money - START_MONEY;
  const profitText = document.getElementById('profitText');
  profitText.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(Math.round(profit)).toLocaleString();
  profitText.style.color = profit >= 0 ? '#3ecf8e' : '#ff4d4f';
  document.getElementById('positionText').textContent =
    position === 1 ? '⬆ Long (betting up)' : position === -1 ? '⬇ Short (betting down)' : '💵 Cash (safe)';
}

// =====================================================================
// 畫交易員和特效（每秒約 60 次）
// =====================================================================
function drawStage(t) {
  requestAnimationFrame(drawStage);
  const dt = Math.min(0.05, (t - frameTime) / 1000);
  frameTime = t;
  const W = stage.width, H = stage.height;

  const i = Math.max(0, lastIndex);
  const mood = surviving && moods.length ? moods[i] : 'calm';
  const power = surviving && intensity.length ? intensity[i] : 0;
  const losing = money < START_MONEY;

  // 恐怖時整個畫面會抖
  const shake = mood === 'horror' ? power * 6 : 0;
  ctx.save();
  ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // 背景：天堂 = 金色天空、恐怖 = 暗紅色、平穩 = 夜空
  ctx.fillStyle = mood === 'heaven' ? '#3a3216' : mood === 'horror' ? '#2a0b0f' : '#141824';
  ctx.fillRect(-10, -10, W + 20, H + 20);
  ctx.fillStyle = '#20242e';
  ctx.fillRect(-10, H - 30, W + 20, 40);              // 地板

  // 掉落物：天堂掉金幣、恐怖下紅雨
  if (surviving && !gameOver) {
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
    } else {
      ctx.fillStyle = '#a3262a'; ctx.fillRect(p.x, p.y, 2, 10);
    }
  });

  // 天堂時，旁邊有兩個小天使
  if (mood === 'heaven') {
    [W * 0.25, W * 0.75].forEach((x, k) => {
      const y = 50 + Math.sin(t / 300 + k) * 10;
      ctx.fillStyle = '#fff6d5';
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();          // 頭
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 16, 10, 3, 0, 0, Math.PI * 2); ctx.stroke();  // 光環
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(x - 16, y + 4, 10, 5, -0.5, 0, Math.PI * 2); ctx.fill();  // 翅膀
      ctx.beginPath(); ctx.ellipse(x + 16, y + 4, 10, 5, 0.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  drawTrader(W / 2, H - 30, mood, power, losing, t);

  // 「+$420」浮動文字
  popups = popups.filter(p => p.life > 0);
  popups.forEach(p => {
    p.y += 40 * dt; p.life -= dt * 0.8;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color; ctx.font = 'bold 22px system-ui';
    ctx.fillText(p.text, W / 2 + 60, H / 2 - p.y);
    ctx.globalAlpha = 1;
  });

  // 提示：告訴新手「現在的音樂代表什麼、可以怎麼做」
  if (surviving && !gameOver && document.getElementById('hintsOn').checked && performance.now() > countdownEnd) {
    const hint = mood === 'heaven' ? '♪ Heaven music → price is rising → try ⬆ Buy'
               : mood === 'horror' ? '♪ Horror music → price is falling → try ⬇ Sell'
               : '♪ Calm music → price is flat → stay in 💵 Cash';
    ctx.font = 'bold 18px system-ui';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(10, 10, ctx.measureText(hint).width + 20, 32);
    ctx.fillStyle = mood === 'heaven' ? '#f5c542' : mood === 'horror' ? '#ff6b6b' : '#cfd6e4';
    ctx.fillText(hint, 20, 33);
  }

  // 開局倒數
  const left = countdownEnd - performance.now();
  if (surviving && left > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    ctx.font = 'bold 72px system-ui'; ctx.fillText(String(Math.ceil(left / 1000)), W / 2, H / 2 + 10);
    ctx.font = '18px system-ui'; ctx.fillText('W / ⬆ = Buy    S / ⬇ = Sell    Space = Cash    P = Pause', W / 2, H / 2 + 50);
    ctx.textAlign = 'left';
  }

  // 暫停畫面
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2); ctx.textAlign = 'left';
  }

  // 輸光畫面
  if (gameOver && money <= 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff4d4f'; ctx.font = 'bold 44px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('MARGIN CALL', W / 2, H / 2);
    ctx.font = '18px system-ui'; ctx.fillStyle = '#e8e8e8';
    ctx.fillText('The bank has taken your lunch money', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // 鬼！（不跟著抖，直接蓋滿畫面）
  if (performance.now() < ghostUntil) drawGhost(W, H);
}

// 畫一個像素風的交易員
function drawTrader(x, ground, mood, power, losing, t) {
  let bob = 0, jitter = 0, armsUp = false;
  if (mood === 'heaven') { bob = Math.abs(Math.sin(t / (220 - power * 100))) * (8 + power * 10); armsUp = true; }
  if (mood === 'horror') jitter = (Math.random() - 0.5) * (2 + power * 6);
  const cx = x + jitter, top = ground - 90 - bob;

  ctx.fillStyle = '#1f3a6e'; ctx.fillRect(cx - 9, ground - 30 - bob, 7, 30 + bob);   // 腿
  ctx.fillRect(cx + 2, ground - 30 - bob, 7, 30 + bob);
  ctx.fillStyle = '#2b4c8c'; ctx.fillRect(cx - 18, top + 30, 36, 32);                 // 西裝
  ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 5, top + 30, 10, 14);                  // 襯衫
  ctx.fillStyle = '#d93a3a'; ctx.fillRect(cx - 2, top + 32, 4, 16);                   // 領帶

  ctx.fillStyle = '#2b4c8c';                                                          // 手
  if (armsUp) {
    ctx.fillRect(cx - 30, top + 6, 8, 30); ctx.fillRect(cx + 22, top + 6, 8, 30);
  } else if (mood === 'horror') {
    ctx.fillRect(cx - 26, top + 12, 8, 24); ctx.fillRect(cx + 18, top + 12, 8, 24);   // 抱頭
  } else {
    ctx.fillRect(cx - 26, top + 32, 8, 26); ctx.fillRect(cx + 18, top + 32, 8, 26);
  }

  ctx.fillStyle = mood === 'horror' ? '#d9e3c4' : '#f1c9a0';                          // 頭（嚇到臉色發青）
  ctx.fillRect(cx - 15, top, 30, 30);
  ctx.fillStyle = '#3b2a1a'; ctx.fillRect(cx - 15, top - 4, 30, 8);                   // 頭髮

  ctx.fillStyle = '#111';                                                              // 眼睛
  const eye = mood === 'horror' ? 4 : 3;
  ctx.fillRect(cx - 8, top + 10, eye, eye); ctx.fillRect(cx + 5, top + 10, eye, eye);

  // 嘴巴：天堂大笑、恐怖張大嘴、平穩看有沒有在賠錢
  if (mood === 'heaven') { ctx.fillRect(cx - 7, top + 20, 14, 3); ctx.fillRect(cx - 8, top + 18, 2, 3); ctx.fillRect(cx + 6, top + 18, 2, 3); }
  else if (mood === 'horror') ctx.fillRect(cx - 4, top + 18, 8, 8);
  else if (losing) { ctx.fillRect(cx - 7, top + 22, 14, 2); ctx.fillRect(cx - 8, top + 24, 2, 2); ctx.fillRect(cx + 6, top + 24, 2, 2); }
  else ctx.fillRect(cx - 6, top + 21, 12, 2);

  if (mood === 'horror') {                                                             // 冷汗
    ctx.fillStyle = '#7ec8ff';
    const drop = (t / 6) % 30;
    ctx.fillRect(cx + 16, top + 4 + drop, 3, 5); ctx.fillRect(cx - 19, top + 10 + (drop + 12) % 30, 3, 5);
  }
  if (losing && money < START_MONEY * 0.6) {                                           // 賠很多：眼淚
    ctx.fillStyle = '#7ec8ff';
    ctx.fillRect(cx - 8, top + 14 + (t / 10) % 12, 2, 4); ctx.fillRect(cx + 6, top + 14 + (t / 10 + 6) % 12, 2, 4);
  }

  // 頭上的部位標示
  ctx.font = '20px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(position === 1 ? '📈' : position === -1 ? '📉' : '💵', cx, top - 12);
  ctx.textAlign = 'left';
}

// 跳出來嚇人的鬼
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
