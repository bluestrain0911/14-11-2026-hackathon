// =====================================================================
// Dramatic narrator
//
// Three levels; uses whatever is available:
//   1. No API key: built-in funny lines + the browser's built-in voice (free, no setup)
//   2. Gemini key: Gemini writes an over-the-top line in real time based on the current market
//   3. ElevenLabs key: read it out with an ElevenLabs movie-trailer voice
// If any step fails, it automatically falls back to the level below, so the game never breaks.
//
// ⚠️ API keys are stored only in your own browser — never put a key in the code or push it to GitHub.
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

// Professional lines (for Live monitor): short, clear, no jokes, like real trading alerts
// Each line is a function so the current price and volatility can be filled in
const PRO_LINES = {
  heaven: f => 'EUR/USD is rising' + (f.price ? ', now ' + f.price : '') + '.',
  horror: f => 'EUR/USD is falling' + (f.price ? ', now ' + f.price : '') + '.',
  calm: f => 'EUR/USD is stable. No significant moves.',
  stormWarning: f => 'Volatility alert. Price movement is ' + (f.volatilityTimesNormal || 'several') + ' times normal.' +
    (f.myPositionCouldSwingIn10MinUSD ? ' Your position could swing about ' + f.myPositionCouldSwingIn10MinUSD.toLocaleString('en-GB') + ' dollars in the next ten minutes.' : ''),
  spike: f => 'Sharp price move detected' + (f.price ? ' at ' + f.price : '') + '.'
};
// Are we in "professional mode": yes whenever Live monitor is running
const proMode = () => typeof liveActive !== 'undefined' && liveActive;

// ---------- Settings (stored in the browser) ----------
function loadSetting(name) {
  try { return localStorage.getItem('ms_' + name) || ''; } catch (e) { return ''; }
}
function saveSetting(name, value) {
  try { localStorage.setItem('ms_' + name, value); } catch (e) { /* Some environments can't store data; that's fine */ }
}
const setting = id => document.getElementById(id).value.trim();

let lastSpoken = 0;        // When we last spoke, so it doesn't talk non-stop
let speaking = false;

// The only public function: something happened → the narrator says one line
//   event: 'horror' | 'heaven' | 'calm' | 'spike' | 'marginCall' | 'bigWin' | 'end'
//   facts: market info for Gemini (time, price, pips moved, the player's money)
async function narrate(event, facts, force) {
  if (!document.getElementById('narratorOn').checked) return;
  const now = Date.now();
  if (!force && (speaking || now - lastSpoken < 3500)) return;   // At least 3.5 seconds apart, chatty like a football commentator
  // Important moments cut in straight away (speakLine handles interrupting the previous line)
  lastSpoken = now;
  speaking = true;

  // Live monitor quiet mode: say nothing
  if (proMode() && typeof liveQuiet !== 'undefined' && liveQuiet) { speaking = false; return; }
  // Live monitor: use professional alerts, no Gemini jokes (alerts should be steady and predictable)
  if (proMode()) {
    const make = PRO_LINES[event];
    if (!make) { speaking = false; return; }
    await speakLine(make(facts || {}), 'pro');
    speaking = false;
    return;
  }

  let line = pickLine(event);
  try {
    if (setting('geminiKey')) line = await askGemini(event, facts) || line;
  } catch (e) { console.warn('Gemini failed, using built-in line', e); }

  // End-of-match commentary and the post-match report queue up instead of interrupting each other
  await speakLine(line, event, ['end', 'endLoss', 'newBest'].includes(event));
  speaking = false;
}

// Read out a given line
// Only one voice at a time, with a short pause between lines (like a person taking a breath):
//   a new line waits for the previous one to finish; while waiting, only "the newest line" is kept (older ones are dropped so it doesn't pile up and fall behind)
//   lines with keep = true (end-of-match commentary, post-match report) are always read in order
const BREATH_MS = 450;
let speechToken = 0;
let currentAudio = null;
let speechQueue = [];
let speechBusy = false;
function stopSpeech() {
  speechToken++;
  speechQueue.forEach(p => p.resolve()); speechQueue = [];
  if (currentAudio) { currentAudio.pause(); if (currentAudio.onended) currentAudio.onended(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function speakLine(line, event, keep) {
  return new Promise(resolve => {
    if (!keep) speechQueue = speechQueue.filter(p => { if (p.keep) return true; p.resolve(); return false; });
    speechQueue.push({ line, event, keep, resolve });
    if (!speechBusy) pumpSpeech();
  });
}
async function pumpSpeech() {
  speechBusy = true;
  while (speechQueue.length) {
    const p = speechQueue.shift();
    const my = speechToken;
    document.getElementById('narratorText').textContent = '🎙 ' + p.line;
    try {
      if (setting('elevenKey')) await speakEleven(p.line, p.event, my);
      else await speakBrowser(p.line, p.event);
    } catch (e) {
      if (my === speechToken) { console.warn('ElevenLabs failed, using browser voice', e); await speakBrowser(p.line, p.event); }
    }
    p.resolve();
    await new Promise(r => setTimeout(r, BREATH_MS));   // Take a breath
  }
  speechBusy = false;
}

function pickLine(event) {
  const list = LINES[event] || LINES.calm;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Gemini: write a live comment ----------
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

// Call Gemini: send a prompt, get text back (used by both commentary and the post-match report)
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

// ---------- ElevenLabs: turn a line into speech ----------
// On the free plan, the API rejects old "legacy" voices (e.g. the default Rachel) with HTTP 402.
// On a 402, automatically find a free-to-use default voice in the account, remember it and use it from then on.
let elevenVoiceFixTried = false;
async function findFreeVoice() {
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': setting('elevenKey') } });
  if (!r.ok) return null;
  const voices = (await r.json()).voices || [];
  // First look for the user's "own" voices (made with Voice Design, or cloned); the free-plan API can only use these
  const own = voices.find(v => ['generated', 'cloned', 'professional'].includes(v.category));
  const ok = v => v.category === 'premade' && !v.is_legacy;
  const pick = own || voices.find(v => ok(v) && /^(George|Sarah|Brian|Alice|Daniel|Charlotte)$/i.test(v.name)) ||
               voices.find(ok) || voices.find(v => !v.is_legacy) || null;
  return pick;
}

async function speakEleven(line, event, my = speechToken) {
  const voice = setting('elevenVoice') || 'JBFqnCBsd6RMkjVDRZzb';
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voice, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': setting('elevenKey') },
    // Lower stability = more ups and downs and more emotion; higher style = more exaggerated
    body: JSON.stringify({ text: line, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: event === 'pro' ? 0.8 : event === 'calm' ? 0.5 : 0.25, similarity_boost: 0.8,
                        style: event === 'pro' ? 0 : event === 'calm' ? 0.2 : 0.7, use_speaker_boost: true } })
  });
  if (response.status === 402 && !elevenVoiceFixTried) {   // Only switch automatically once per page load
    elevenVoiceFixTried = true;
    const pick = await findFreeVoice();
    if (pick && pick.voice_id !== voice) {
      saveSetting('elevenVoice', pick.voice_id);
      document.getElementById('elevenVoice').value = pick.voice_id;
      document.getElementById('narratorText').textContent = '🔁 Switched ElevenLabs voice to ' + pick.name + ' (free-plan voice)';
      return speakEleven(line, event, my);
    }
  }
  if (!response.ok) {
    // Show the reason ElevenLabs gave (e.g. key lacks permission, free plan blocked)
    let detail = '';
    try { const j = await response.json(); detail = (j.detail && (j.detail.message || j.detail.status || JSON.stringify(j.detail))) || ''; } catch (e) {}
    const msg = 'ElevenLabs HTTP ' + response.status + (detail ? ' — ' + detail : '');
    document.getElementById('narratorText').textContent = '⚠️ ' + msg + ' (using browser voice instead)';
    throw new Error(msg);
  }
  const blob = await response.blob();
  if (my !== speechToken) return;          // A newer line arrived while downloading: don't play this one, so two voices never overlap
  const audio = new Audio(URL.createObjectURL(blob));
  currentAudio = audio;
  const done = new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; });
  await audio.play();
  await done;
  if (currentAudio === audio) currentAudio = null;
}

// ---------- Fallback: the browser's built-in voice (free) ----------
// Each mood uses a different rate and pitch: horror = slow and low; spike = fast and excited; heaven = light and a little higher
const MOOD_VOICE = {
  pro:          { rate: 1.0, pitch: 1.0 },      // Professional mode: steady tone
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

// Computer voices vary in quality. Names with Natural / Neural / Online / Google usually sound more human.
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
  speechSynthesis.onvoiceschanged = fillVoiceMenu;   // Some browsers need a moment before the voice list is available
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
    speechSynthesis.speak(utterance);  // Only one line is queued at a time (controlled by speakLine's queue), so they never overlap
  });
}

// ---------- Settings fields: load saved values when the page opens, save on change ----------
['geminiKey', 'geminiModel', 'elevenKey', 'elevenVoice'].forEach(id => {
  const input = document.getElementById(id);
  input.value = loadSetting(id) || input.value;
  input.addEventListener('change', () => saveSetting(id, input.value.trim()));
});
document.getElementById('testNarrator').addEventListener('click', () =>
  narrate('heaven', { time: '12:31', movePips: 42, balance: 10000 }, true));
