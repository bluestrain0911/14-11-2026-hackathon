# 🎵 Market Symphony

**Hear the FX market before you see it.**
Built solo at **DurHack 2026** (theme: *Composition*) for the SGX FX challenges.

Market Symphony turns the EUR/USD exchange rate into live music, so traders can follow the market without staring at a chart:

| Market | What you hear |
|---|---|
| 😇 Rising | Heavenly choir and climbing bells. Steeper rises raise the key and the tempo |
| 👻 Falling | Horror-film drone, eerie high notes and a racing heartbeat |
| 😌 Flat | A calm, gentle melody |
| ⚡ Spike | A whoosh or a boom when the price jumps over 5× a normal move |
| 🟡 / 🔴 Storm | An alarm when volatility reaches 2× / 3.5× normal |

## Why
In the SGX FX EUR/USD data, the **direction** of the next move is basically a coin flip (46–51% hit rate), but **volatility clusters** (0.78–0.90 correlation between the last and next 10 minutes). So Market Symphony doesn't predict prices. It warns you when risk is rising.

## Four modes
1. **Replay** – listen to the biggest real storms in the data.
2. **Guess by Ear** – a blind test: the chart is hidden, so you judge rising, flat or falling by sound alone. It also makes market data accessible to people with visual impairments.
3. **Survive the Storm** – a trading game that feels like a live sports match. Start with $10,000, follow the music, raise a stop-loss shield (E) on storm warnings, and get a post-match report (with a personalised Gemini coaching analysis if a key is set).
4. **Live Monitor** – a simulated live feed that only uses past data. The **My position** panel shows your profit and loss, how much your position could swing in the next 10 minutes, and today's worst one-minute hit.

## How to run
1. Download or clone this repository.
2. Open `index.html` in Chrome or Edge (an internet connection is needed to load Chart.js and Tone.js).
3. Click a mode and press play. Headphones recommended.

**Game controls:** `W` Buy · `S` Sell · `Space` Cash · `E` Shield · `B` Status · `P` Pause

**Optional keys** (Survive the Storm → Narrator settings):
- **ElevenLabs API key** – a natural narrator voice (free plan: use a voice made with Voice Design).
- **Gemini API key** – a personalised post-match coaching report.

🔒 Keys are stored only in your own browser (localStorage). They are never in the code or on GitHub. Without keys, the app uses built-in lines and the browser's voice.

## Built with
- JavaScript, HTML, CSS (single page, no backend)
- [Tone.js](https://tonejs.github.io/) – real-time music engine
- [Chart.js](https://www.chartjs.org/) – colour-coded price chart
- [ElevenLabs](https://elevenlabs.io/) – narrator voice
- [Google Gemini API](https://ai.google.dev/) – post-match coaching report
- SGX FX EUR/USD 1-month forward, 1-minute data (1 Jul – 31 Aug 2026)
- Built with the help of AI coding assistants

## Files
| File | What it does |
|---|---|
| `index.html` | Page layout, data analysis, music engine and chart |
| `survive.js` | Survive the Storm game |
| `live.js` | Live Monitor and the My position panel |
| `narrator.js` | Narrator (built-in lines, ElevenLabs, Gemini) |
| `report.js` | Post-match report |
| `data.js` | SGX FX EUR/USD data |

> ⚠️ A learning and risk-awareness tool, not trading advice.
