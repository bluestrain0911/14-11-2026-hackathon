// =====================================================================
// 戲劇化播報員
//
// 三種等級，有什麼用什麼：
//   1. 沒有任何 API key：用內建的搞笑台詞 + 瀏覽器內建的語音（免費、不用網路設定）
//   2. 有 Gemini key：讓 Gemini 根據當下的市場狀況，即時寫一句浮誇的評論
//   3. 有 ElevenLabs key：用 ElevenLabs 的電影預告片聲音唸出來
// 任何一步失敗，都會自動退回上一級，不會讓遊戲壞掉。
//
// ⚠️ API key 只存在你自己的瀏覽器裡，不要把 key 寫進程式碼或推上 GitHub。
// =====================================================================

const LINES = {
  horror: [
    'The euro is falling! Brace yourselves!',
    'Ladies and gentlemen... it is a bloodbath.',
    'Sell! Sell! Somebody call my mum!',
    'The charts are bleeding. I can hear them screaming.',
    'This is not a dip. This is a cliff.'
  ],
  heaven: [
    'The angels are singing! The euro takes flight!',
    'To the moon! Well... to one point one four.',
    'Buy everything! Buy the building!',
    'Green candles as far as the eye can see!',
    'Somebody is getting a very big bonus this year.'
  ],
  calm: [
    'Calm waters. Suspiciously calm.',
    'Nothing is happening. Traders are eating sandwiches.',
    'The market is taking a little nap.',
    'Quiet... too quiet.'
  ],
  spike: [
    'Whoa! Who pressed the big red button?!',
    'Forty pips in one minute! My coffee just evaporated!',
    'That candle just went vertical!'
  ],
  marginCall: [
    'Margin call! Your broker is on the phone, and they are not happy.',
    'Game over. The bank has taken your lunch money.'
  ],
  bigWin: [
    'Look at you go! The Wolf of Durham Street!',
    'Incredible trading! Are you secretly a hedge fund?'
  ],
  end: [
    'And the closing bell rings! What a session!'
  ]
};

// ---------- 設定（存在瀏覽器裡） ----------
function loadSetting(name) {
  try { return localStorage.getItem('ms_' + name) || ''; } catch (e) { return ''; }
}
function saveSetting(name, value) {
  try { localStorage.setItem('ms_' + name, value); } catch (e) { /* 有些環境不能存，沒關係 */ }
}
const setting = id => document.getElementById(id).value.trim();

let lastSpoken = 0;        // 上次說話的時間，避免一直講個不停
let speaking = false;

// 對外只有這一個函式：發生了某件事 → 播報員講一句話
//   event：'horror' | 'heaven' | 'calm' | 'spike' | 'marginCall' | 'bigWin' | 'end'
//   facts：給 Gemini 參考的市場資訊（時間、價格、漲跌了幾 pip、玩家的錢）
async function narrate(event, facts, force) {
  if (!document.getElementById('narratorOn').checked) return;
  const now = Date.now();
  if (!force && (speaking || now - lastSpoken < 6000)) return;   // 至少間隔 6 秒
  lastSpoken = now;
  speaking = true;

  let line = pickLine(event);
  try {
    if (setting('geminiKey')) line = await askGemini(event, facts) || line;
  } catch (e) { console.warn('Gemini failed, using built-in line', e); }

  document.getElementById('narratorText').textContent = '🎙 ' + line;
  try {
    if (setting('elevenKey')) await speakEleven(line);
    else await speakBrowser(line);
  } catch (e) {
    console.warn('ElevenLabs failed, using browser voice', e);
    await speakBrowser(line);
  }
  speaking = false;
}

function pickLine(event) {
  const list = LINES[event] || LINES.calm;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Gemini：寫一句即時評論 ----------
async function askGemini(event, facts) {
  const model = setting('geminiModel') || 'gemini-2.5-flash';
  const prompt =
    'You are an over-the-top, funny sports-style commentator narrating a live EUR/USD currency market ' +
    'for a hackathon game. Write ONE short sentence (max 15 words), dramatic and silly, family friendly. ' +
    'Event: ' + event + '. Facts: ' + JSON.stringify(facts) + '. Reply with the sentence only.';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
              ':generateContent?key=' + encodeURIComponent(setting('geminiKey'));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!response.ok) throw new Error('Gemini HTTP ' + response.status);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim().replace(/^"|"$/g, '') : null;
}

// ---------- ElevenLabs：把句子變成聲音 ----------
async function speakEleven(line) {
  const voice = setting('elevenVoice') || '21m00Tcm4TlvDq8ikWAM';
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': setting('elevenKey') },
    body: JSON.stringify({ text: line, model_id: 'eleven_multilingual_v2' })
  });
  if (!response.ok) throw new Error('ElevenLabs HTTP ' + response.status);
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  await audio.play();
  await new Promise(resolve => { audio.onended = resolve; });
}

// ---------- 備案：瀏覽器內建語音（免費） ----------
function speakBrowser(line) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const voice = new SpeechSynthesisUtterance(line);
    voice.lang = 'en-GB';
    voice.rate = 1.05;
    voice.pitch = 0.8;            // 低一點，比較有戲劇感
    voice.onend = resolve;
    voice.onerror = resolve;
    speechSynthesis.speak(voice);
  });
}

// ---------- 設定欄位：打開網頁時讀回上次存的值，修改時存起來 ----------
['geminiKey', 'geminiModel', 'elevenKey', 'elevenVoice'].forEach(id => {
  const input = document.getElementById(id);
  input.value = loadSetting(id) || input.value;
  input.addEventListener('change', () => saveSetting(id, input.value.trim()));
});
document.getElementById('testNarrator').addEventListener('click', () =>
  narrate('heaven', { time: '12:31', movePips: 42, balance: 10000 }, true));
