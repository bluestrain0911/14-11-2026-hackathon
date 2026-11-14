// =====================================================================
// 賽後報告：像足球賽後的「球員評分」
//
// 沒有 Gemini key：用規則算出評分和建議（一定能用）
// 有 Gemini key：讓 Gemini 看完你整局的交易紀錄，寫一份像球評一樣的個人化報告
// =====================================================================

const money$ = n => (n >= 0 ? '+$' : '-$') + Math.abs(Math.round(n)).toLocaleString();
const escapeHtml = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 用規則打分數（1～10 分）
function ruleRating(stats) {
  let rating = 5 + stats.profit / 1000;                  // 每賺 $1,000 加 1 分
  if (stats.followedMusicPercent >= 60) rating += 0.5;   // 有在聽音樂
  rating += Math.min(1, stats.shieldSaves * 0.5);        // 懂得用停損
  if (stats.wentBroke) rating -= 1;
  return Math.max(1, Math.min(10, Math.round(rating * 2) / 2));
}

// 用規則寫建議
function ruleTips(stats) {
  const tips = [];
  if (stats.trades === 0) {
    tips.push('You never traded! Sitting in cash is safe, but you can\'t win either. Try buying when the heaven music starts.');
  }
  if (stats.followedMusicPercent < 40 && stats.trades > 0) {
    tips.push('You followed the music only ' + stats.followedMusicPercent + '% of the time. Heaven music → buy, horror music → sell, calm → cash.');
  } else if (stats.followedMusicPercent >= 60) {
    tips.push('Great ears! You traded with the music ' + stats.followedMusicPercent + '% of the time.');
  }
  if (stats.worstTrade && stats.worstTrade.pnl < -shieldLimit() && stats.shieldsUsed === 0) {
    tips.push('Your worst trade (' + stats.worstTrade.side + ', ' + stats.worstTrade.from + '–' + stats.worstTrade.to +
              ') lost ' + money$(stats.worstTrade.pnl) + '. A 🛡 shield (stop-loss) would have capped it at $' + shieldLimit() + '.');
  }
  if (stats.stormWarnings > 0) {
    tips.push('There were ' + stats.stormWarnings + ' storm warning(s); you were protected in ' + stats.stormWarningsProtected +
              '. When volatility jumps, it usually stays high for a while — that\'s the time to use a shield or go to cash.');
  }
  if (stats.shieldSaves > 0) {
    tips.push('Your shield saved you ' + stats.shieldSaves + ' time(s). That\'s exactly what professional traders call a stop-loss.');
  }
  if (stats.trades > 15) {
    tips.push('You made ' + stats.trades + ' trades. Each switch costs $' + SWITCH_COST + ' — wait for the music to really change before you jump.');
  }
  if (stats.bestTrade && stats.bestTrade.pnl > 0) {
    tips.push('Best moment: going ' + stats.bestTrade.side + ' from ' + stats.bestTrade.from + ' to ' + stats.bestTrade.to +
              ' for ' + money$(stats.bestTrade.pnl) + '.');
  }
  return tips.slice(0, 5);
}

async function showReport(stats) {
  const box = document.getElementById('reportBox');
  const rating = ruleRating(stats);
  const statLine = (label, value) =>
    '<div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #20242e;">' +
    '<span style="color:#9aa0a6">' + label + '</span><b>' + value + '</b></div>';

  box.innerHTML =
    '<div style="display:flex; align-items:center; gap:16px; margin-bottom:12px;">' +
      '<div style="font-size:44px; font-weight:800; color:' + (rating >= 7 ? '#3ecf8e' : rating >= 5 ? '#f5c542' : '#ff4d4f') + '">' +
        rating + '<span style="font-size:18px; color:#9aa0a6">/10</span></div>' +
      '<div><div style="font-size:20px; font-weight:700;">📋 Match report</div>' +
      '<div style="color:#9aa0a6">EUR/USD · ' + stats.from + '–' + stats.to + '</div></div>' +
    '</div>' +
    statLine('Profit', money$(stats.profit)) +
    statLine('Trades', stats.trades) +
    statLine('Followed the music', stats.followedMusicPercent + '%') +
    statLine('Goals ⚽ / Big losses 😱', stats.goals + ' / ' + stats.bigLosses) +
    statLine('Shields used / saves', stats.shieldsUsed + ' / ' + stats.shieldSaves) +
    statLine('Storm warnings / protected', stats.stormWarnings + ' / ' + stats.stormWarningsProtected) +
    statLine('Lowest balance', '$' + stats.lowestBalance.toLocaleString()) +
    '<div id="coachText" style="margin-top:12px; line-height:1.6;">' +
      ruleTips(stats).map(t => '• ' + escapeHtml(t)).join('<br>') +
    '</div>';
  box.classList.remove('hidden');

  // 語音：分數 + 前兩條建議（不看螢幕也聽得到）
  const spokenTips = ruleTips(stats).slice(0, 2).map(tip => tip.replace(/[🛡→]/g, ' ').replace(/\s+/g, ' '));
  let spoken = 'Player rating: ' + rating + ' out of ten. ' + spokenTips.join(' ');

  // 有 Gemini key：換成 Gemini 寫的個人化報告
  if (setting('geminiKey')) {
    const coach = document.getElementById('coachText');
    coach.innerHTML += '<br><i style="color:#9aa0a6">Gemini is writing your match report…</i>';
    try {
      const prompt =
        'You are a witty British football pundit giving a post-match analysis, but the "match" was a trading game ' +
        'where a beginner traded EUR/USD while listening to music (heaven music = rising, horror music = falling, ' +
        'calm = flat). The game shows storm warnings when recent volatility is 2x or 3.5x normal. ' +
        'They could buy (long), sell (short) or hold cash, and use up to 3 "shields" (stop-loss at -$' +
        shieldLimit() + '). Each pip = $100, start balance $10,000.\n' +
        'Here are the match stats as JSON: ' + JSON.stringify(stats) + '\n' +
        'Write: first line exactly "Player rating: X/10" (X between 1 and 10, may use .5). Then exactly 3 short bullet ' +
        'points starting with "- ": one thing they did well, one mistake (mention a specific time from the trade log ' +
        'if possible), and one tip that teaches a real trading idea (stop-loss, following the trend, overtrading, ' +
        'risk) linked to the music cues. Under 90 words total, fun but genuinely educational, no markdown bold.';
      const text = await geminiGenerate(prompt);
      if (text) {
        const lines = text.trim().split('\n').filter(l => l.trim());
        coach.innerHTML = '<div style="color:#7ec8ff; margin-bottom:6px;">✨ Coach\'s analysis (Gemini)</div>' +
          lines.map(l => escapeHtml(l.replace(/^[-*]\s*/, '• '))).join('<br>');
        const first = lines[0] || '';
        const match = first.match(/(\d+(\.\d)?)\s*\/\s*10/);
        if (match) spoken = 'Player rating: ' + match[1] + ' out of ten. ' +
          lines.slice(1, 4).map(l => l.replace(/^[-*•]\s*/, '')).join(' ');      // 唸出全部三條建議
      }
    } catch (e) {
      console.warn('Gemini report failed, keeping the built-in tips', e);
      coach.innerHTML = coach.innerHTML.replace(/<br><i[^>]*>Gemini is writing.*<\/i>/, '');
    }
  }

  if (document.getElementById('narratorOn').checked) speakLine(spoken, rating >= 6 ? 'end' : 'endLoss', true);   // 排在終場評論後面講
}
