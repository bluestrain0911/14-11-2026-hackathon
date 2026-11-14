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
    "Oh no. Oh no no no... the euro's falling!",
    "Hold on to something, folks... this is getting ugly.",
    "Sell! Sell! Somebody call my mum!",
    "Ooh, I can hear the charts screaming from here.",
    "That's not a dip, mate... that's a cliff."
  ],
  heaven: [
    "Oh, would you look at that! The euro's taking off!",
    "Up, up and away! Can you hear the angels?",
    "Buy it all! Buy the building!",
    "Green as far as the eye can see... beautiful.",
    "Somebody's getting a very nice bonus this year!"
  ],
  calm: [
    "And... we're calm. Suspiciously calm.",
    "Nothing's happening. Everyone's eating sandwiches.",
    "The market's having a little nap, bless it.",
    "Quiet... a bit too quiet, if you ask me."
  ],
  spike: [
    "Whoa, whoa, whoa! Who pressed the big red button?!",
    "Did you see that?! My coffee just evaporated!",
    "That candle went straight up the wall!"
  ],
  marginCall: [
    "Ooh... margin call. Your broker's on the phone, and they're not happy.",
    "And that's game over. The bank's taken your lunch money."
  ],
  bigWin: [
    "Look at you go! The Wolf of Durham Street!",
    "Brilliant trading! Are you secretly a hedge fund?"
  ],
  end: [
    "And there's the final whistle! What a performance, folks!",
    "Full time! They've walked away with the profits!"
  ],
  endLoss: [
    "Full time... and it's a painful one, I'm afraid.",
    "The final whistle blows. The market wins this one."
  ],
  kickoff: [
    "And we're live! Kick-off in the euro dollar market!",
    "Welcome, everybody! The markets are open... let's play!"
  ],
  goal: [
    "GOOOAL! What a trade! The crowd goes wild!",
    "Oh, it's in the back of the net! Beautiful trading!",
    "Unbelievable! Right into the top corner!"
  ],
  losing: [
    "Ooh! That's gone horribly wrong!",
    "Oh dear... that one's going to hurt in the morning.",
    "A howler! The crowd can't believe it!"
  ],
  streak: [
    "They're on fire! Can anybody stop them?!",
    "Another one! This is a masterclass!"
  ],
  playerLong: [
    "They're going long! Bold move!",
    "Buying in! They smell a rally!"
  ],
  playerShort: [
    "They're going short! Betting on the fall!",
    "Selling! Brave, very brave!"
  ],
  stormWarning: [
    "Storm warning! It's getting wild out there... protect yourself!",
    "Hold on! The volatility just tripled! Shields up?",
    "The storm is coming! This is not the time to be brave!"
  ],
  shield: [
    "Saved by the shield! What a defensive play!",
    "The stop-loss kicks in! Disaster averted!"
  ],
  newBest: [
    "A new personal best! Absolutely sensational!",
    "That's a new record! Take a bow!"
  ],
  playerCash: [
    "Back to cash. Playing it safe.",
    "They've pulled out! Sitting on the bench for now."
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
  if (!force && (speaking || now - lastSpoken < 3500)) return;   // 至少間隔 3.5 秒，像球評一樣講不停
  if (force && 'speechSynthesis' in window) speechSynthesis.cancel(); // 重要時刻直接插話
  lastSpoken = now;
  speaking = true;

  let line = pickLine(event);
  try {
    if (setting('geminiKey')) line = await askGemini(event, facts) || line;
  } catch (e) { console.warn('Gemini failed, using built-in line', e); }

  await speakLine(line, event);
  speaking = false;
}

// 直接唸出一句指定的話（賽後報告會用到）
async function speakLine(line, event) {
  document.getElementById('narratorText').textContent = '🎙 ' + line;
  try {
    if (setting('elevenKey')) await speakEleven(line, event);
    else await speakBrowser(line, event);
  } catch (e) {
    console.warn('ElevenLabs failed, using browser voice', e);
    await speakBrowser(line, event);
  }
}

function pickLine(event) {
  const list = LINES[event] || LINES.calm;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Gemini：寫一句即時評論 ----------
async function askGemini(event, facts) {
  const prompt =
    'You are an excited British football commentator doing live play-by-play of a EUR/USD currency market ' +
    'as if it were a match; the player is the trader. ' +
    'for a hackathon game. Write ONE short line (max 15 words) that sounds natural when spoken aloud: ' +
    'use contractions, interjections like "oh no" or "wow", and an ellipsis or exclamation for emotion. ' +
    'Dramatic and silly, family friendly. ' +
    'Event: ' + event + '. Facts: ' + JSON.stringify(facts) + '. Reply with the sentence only.';
  const text = await geminiGenerate(prompt);
  return text ? text.trim().replace(/^"|"$/g, '') : null;
}

// 呼叫 Gemini：送出一段提示，拿回一段文字（播報和賽後報告都用這個）
async function geminiGenerate(prompt) {
  const model = setting('geminiModel') || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
              ':generateContent?key=' + encodeURIComponent(setting('geminiKey'));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!response.ok) throw new Error('Gemini HTTP ' + response.status);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ---------- ElevenLabs：把句子變成聲音 ----------
async function speakEleven(line, event) {
  const voice = setting('elevenVoice') || '21m00Tcm4TlvDq8ikWAM';
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': setting('elevenKey') },
    // stability 越低，語氣起伏越大、越有情緒；style 越高，越誇張
    body: JSON.stringify({ text: line, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: event === 'calm' ? 0.5 : 0.25, similarity_boost: 0.8,
                        style: event === 'calm' ? 0.2 : 0.7, use_speaker_boost: true } })
  });
  if (!response.ok) throw new Error('ElevenLabs HTTP ' + response.status);
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  await audio.play();
  await new Promise(resolve => { audio.onended = resolve; });
}

// ---------- 備案：瀏覽器內建語音（免費） ----------
// 每種情緒用不同的語速和音高：恐怖 = 慢、低沉；暴衝 = 快、激動；天堂 = 輕快、高一點
const MOOD_VOICE = {
  stormWarning: { rate: 1.2, pitch: 0.9 },
  shield:      { rate: 1.2,  pitch: 1.1 },
  newBest:     { rate: 1.25, pitch: 1.3 },
  goal:        { rate: 1.3,  pitch: 1.3 },
  losing:      { rate: 1.1,  pitch: 0.8 },
  streak:      { rate: 1.25, pitch: 1.2 },
  kickoff:     { rate: 1.1,  pitch: 1.1 },
  endLoss:     { rate: 0.9,  pitch: 0.75 },
  playerLong:  { rate: 1.15, pitch: 1.1 },
  playerShort: { rate: 1.15, pitch: 1.0 },
  playerCash:  { rate: 1.0,  pitch: 1.0 },
  horror:     { rate: 0.9,  pitch: 0.7 },
  heaven:     { rate: 1.1,  pitch: 1.15 },
  calm:       { rate: 0.95, pitch: 1.0 },
  spike:      { rate: 1.25, pitch: 1.2 },
  marginCall: { rate: 0.85, pitch: 0.6 },
  bigWin:     { rate: 1.15, pitch: 1.2 },
  end:        { rate: 1.0,  pitch: 1.0 }
};

// 電腦裡的語音有好有壞。名字裡有 Natural / Neural / Online / Google 的，通常比較像真人。
function bestVoices() {
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')) : [];
  const score = v => (/natural|neural/i.test(v.name) ? 3 : 0) + (/online|google/i.test(v.name) ? 2 : 0) +
                     (v.lang === 'en-GB' ? 1 : 0);
  return all.sort((a, b) => score(b) - score(a));
}

function fillVoiceMenu() {
  const menu = document.getElementById('browserVoice');
  const saved = loadSetting('browserVoice');
  menu.innerHTML = '';
  bestVoices().forEach(v => {
    const option = document.createElement('option');
    option.value = v.name;
    option.textContent = v.name + ' (' + v.lang + ')';
    menu.appendChild(option);
  });
  if (saved && [...menu.options].some(o => o.value === saved)) menu.value = saved;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = fillVoiceMenu;   // 有些瀏覽器要等一下才拿得到語音清單
  fillVoiceMenu();
}
document.getElementById('browserVoice').addEventListener('change', e => saveSetting('browserVoice', e.target.value));

function speakBrowser(line, event) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(line);
    const chosen = bestVoices().find(v => v.name === document.getElementById('browserVoice').value);
    if (chosen) utterance.voice = chosen;
    utterance.lang = chosen ? chosen.lang : 'en-GB';
    const style = MOOD_VOICE[event] || MOOD_VOICE.calm;
    utterance.rate = style.rate;
    utterance.pitch = style.pitch;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.cancel();          // 舊的還沒講完就直接換新的，不要排隊
    speechSynthesis.speak(utterance);
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
