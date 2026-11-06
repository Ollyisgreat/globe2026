/* Miss Globe TV — YouTube on the left, live judging scoreboard on the right.
 *
 * The page is served by the Android app at https://globe2026.ollpot.life/__tv/
 * (from the APK's assets), so it shares an origin with the judging site and
 * can read api.php, the delegate list and the Recap page directly.
 *
 * Remote keys arrive from the app as TV.key('up'|'down'|'left'|'right'|'ok'|
 * 'playpause'|'play'|'pause'|'rew'|'ff'|'menu'|'back'). In a desktop browser
 * the keyboard works too (arrows, Enter, Space, M = menu, Esc = back).
 */
(function () {
  'use strict';

  var SITE = location.origin;
  var API = SITE + '/api.php?action=get&room=mg-2026';
  var POLL_MS = 5000;
  var native = window.Android || { setMode: function () {}, exitApp: function () {}, showKeyboard: function () {}, openYouTube: function () {} };
  var $ = function (id) { return document.getElementById(id); };
  function setHtml(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };

  /* ---------------- Storage ---------------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('tv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tv.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------------- Toast ---------------- */
  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
  }

  /* ---------------- Mode (main | recap | menu) ---------------- */
  var mode = 'main';
  function setMode(m) {
    mode = m;
    setTimeout(function () { if (window.fitPlayer2) fitPlayer2(); }, 50);
    document.body.classList.toggle('recap-on', m === 'recap');
    document.body.classList.toggle('menu-on', m === 'menu');
    try { native.setMode(m); } catch (e) {}
  }

  /* =====================================================================
   * SCOREBOARD
   * ===================================================================== */
  var roster = store.get('roster', null) || window.FALLBACK_ROSTER;
  var byId = {};
  function indexRoster() { byId = {}; roster.candidates.forEach(function (c, i) { c.i = i; byId[c.id] = c; }); }
  indexRoster();

  function loadRoster() {
    // Pull the delegate list from the live site so the TV always matches it.
    return fetch(SITE + '/', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (html) {
      var fresh = window.parseRoster(html);
      if (fresh.candidates.length) { roster = fresh; store.set('roster', fresh); indexRoster(); render(); }
    }).catch(function () { /* keep cached / bundled roster */ });
  }

  var raw = {};           // id -> { judge: { field: score } }
  var totals = {};        // id -> { judge: total }
  var favs = {};          // judge -> contestant id (judges' favourites)
  var picks = {};         // judge -> { top20:[], top10:[], top5:[] }
  var prevAvg = {};       // id -> last average (to flash changes)
  var prevRank = {};      // id -> last rank
  var moves = {};         // id -> { dir:'up'|'down', until:time }
  var flashes = {};       // id -> until time
  var lastOk = 0, online = false, firstLoad = true, havePolled = false;
  var leaderNow = null, leaderPrev = null, leaderSince = 0;

  function poll() {
    fetch(API, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      var next = {}, nextTotals = {}, nextFavs = {}, nextPicks = {};
      (json.data || []).forEach(function (row) {
        var id = row.contestant_id, s = row.scores || {};
        if (id.indexOf('FAV_') === 0) { if (s.fav && byId[s.fav]) nextFavs[id.slice(4)] = s.fav; return; }
        if (id.indexOf('PICKS_') === 0) { nextPicks[id.slice(6)] = s; return; }
        if (!byId[id]) return;
        var card = {}, t = 0;
        roster.fields.forEach(function (f) { var v = Number(s[f[0]]) || 0; card[f[0]] = v; t += v; });
        (next[id] = next[id] || {})[row.judge] = card;
        (nextTotals[id] = nextTotals[id] || {})[row.judge] = t;
      });
      var votes = havePolled ? diffVotes(raw, next) : [];
      raw = next; totals = nextTotals; favs = nextFavs; picks = nextPicks;
      online = true; lastOk = Date.now(); havePolled = true;
      render();
      announce(votes);
      if (mode === 'recap') renderRecap();
    }).catch(function () { online = false; renderFoot(); });
  }

  // Every category score that changed since the last check = one "vote".
  function diffVotes(before, after) {
    var out = [];
    Object.keys(after).forEach(function (id) {
      Object.keys(after[id]).forEach(function (j) {
        var a = after[id][j], b = (before[id] || {})[j] || {};
        roster.fields.forEach(function (f) {
          var was = Number(b[f[0]]) || 0, now = a[f[0]];
          if (now && now !== was) out.push({ id: id, judge: j, field: f[0], label: f[1], was: was, v: now, t: Date.now() });
        });
      });
    });
    return out;
  }

  function scoreOf(id, j, f) { return ((raw[id] || {})[j] || {})[f] || 0; }
  function allEntries() {
    var J = roster.judges;
    return roster.candidates.map(function (c) {
      var t = totals[c.id] || {};
      var sum = 0; J.forEach(function (j) { sum += t[j] || 0; });
      return { c: c, t: t, avg: sum / J.length };
    });
  }
  function entries() {
    return allEntries().filter(function (x) { return x.avg > 0; })
      .sort(function (a, b) { return b.avg - a.avg || a.c.i - b.c.i; });
  }

  function flag(c) { return roster.emoji[c.id] ? roster.emoji[c.id] + ' ' : ''; }
  function judgesHtml(x) {
    return '<div class="judges">' + roster.judges.map(function (j) {
      var v = x.t[j];
      return '<span class="' + (v ? '' : 'none') + '">' + esc(j) + '<b>' + (v ? v : '–') + '</b></span>';
    }).join('') + '</div>';
  }
  function photo(c, cls) {
    return '<img decoding="async" ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + esc(c.photo || 'logo.png') + '" onerror="this.onerror=null;this.src=\'logo.png\'" alt="">';
  }

  function render() {
    var list = entries(), now = Date.now();
    var maxTotal = roster.fields.length * 10;

    // Track changes since the last poll: flash rows whose score moved, arrows for rank moves.
    list.forEach(function (x, i) {
      var id = x.c.id, r = i + 1;
      if (!firstLoad) {
        if (prevAvg[id] !== undefined && prevAvg[id] !== x.avg) flashes[id] = now + 3500;
        if (prevAvg[id] === undefined) flashes[id] = now + 3500;
        if (prevRank[id] && prevRank[id] !== r) moves[id] = { dir: r < prevRank[id] ? 'up' : 'down', until: now + 60000 };
      }
      prevAvg[id] = x.avg; prevRank[id] = r;
    });
    if (list.length) firstLoad = false;
    var lid = list[0] ? list[0].c.id : null;
    if (lid && lid !== leaderNow) { if (leaderNow && havePolled) { leaderPrev = leaderNow; leaderSince = now; } leaderNow = lid; }

    var mv = function (id) {
      var m = moves[id]; if (!m || m.until < now) return '';
      return '<span class="mv ' + m.dir + '">' + (m.dir === 'up' ? '▲' : '▼') + '</span>';
    };

    if (!list.length) {
      setHtml($('leader'), '<div class="lead-tag">Leader</div><div class="b-empty" style="padding:.6rem 0;text-align:left">Waiting for the first scores from the judges…</div>');
      setHtml($('list'), '<div class="b-empty">' + roster.candidates.length + ' delegates · ' + roster.fields.length + ' categories · ' + roster.judges.length + ' judges.<br>The leaderboard fills in as scores land.</div>');
    } else {
      var L = list[0];
      setHtml($('leader'),
        '<div class="lead-tag">★ Current leader' + mv(L.c.id) + '</div>' +
        '<div class="lead' + (flashes[L.c.id] > now ? ' flash' : '') + '">' + photo(L.c) +
        '<div class="lead-info"><div class="lead-name">' + esc(L.c.name) + '</div>' +
        '<div class="lead-country">' + flag(L.c) + esc(L.c.country) + '</div>' +
        '<div class="lead-score">' + L.avg.toFixed(1) + '<small>/ ' + maxTotal + '</small></div>' +
        judgesHtml(L) + '</div></div>');
      setHtml($('list'), list.slice(1).map(function (x, i) {
        var r = i + 2;
        return '<div class="srow r' + r + (flashes[x.c.id] > now ? ' flash' : '') + '">' +
          '<span class="rk">' + r + '</span>' + photo(x.c) +
          '<div class="who"><div class="nm">' + esc(x.c.name) + '</div>' +
          '<div class="ct">' + flag(x.c) + esc(x.c.country) + '</div>' + judgesHtml(x) + '</div>' +
          '<span class="sc">' + x.avg.toFixed(1) + mv(x.c.id) + '</span></div>';
      }).join('') || '<div class="b-empty">More delegates appear here as they are scored.</div>');
    }
    renderFoot(list.length);
    setTimeout(clearFlashes, 3600);
  }
  function clearFlashes() {
    var now = Date.now();
    Array.prototype.forEach.call(document.querySelectorAll('.flash'), function (el) { el.classList.remove('flash'); });
    Object.keys(flashes).forEach(function (k) { if (flashes[k] < now) delete flashes[k]; });
  }
  var scoredCount = 0;
  function renderFoot(n) {
    if (typeof n === 'number') scoredCount = n;
    var live = $('live');
    live.classList.toggle('off', !online);
    live.lastChild.nodeValue = online ? 'LIVE' : 'OFFLINE';
    var when = lastOk ? new Date(lastOk).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    setHtml($('foot'), '<span>' + scoredCount + ' / ' + roster.candidates.length + ' scored</span><span>' +
      (online ? 'Updated ' + when : (lastOk ? 'Reconnecting… last ' + when : 'Connecting…')) + '</span>');
  }

  // Flip through the leaderboard a page at a time (cheap for the Firestick's GPU).
  var page = 0;
  setInterval(function () {
    var wrap = $('listWrap'), list = $('list'), max = list.offsetHeight - wrap.clientHeight + 24;
    if (max <= 30) { if (page) { page = 0; list.style.transform = ''; } return; }
    var step = wrap.clientHeight * 0.85, y = (page + 1) * step;
    if (page && (page * step) >= max) { page = 0; y = 0; } else { page++; y = Math.min(y, max); }
    list.style.transform = y ? 'translateY(-' + Math.round(y) + 'px)' : '';
  }, 7000);

  function setBoard(on) {
    document.body.classList.toggle('board-off', !on);
    setTimeout(function () { if (window.fitPlayer2) fitPlayer2(); }, 400);
    store.set('boardOn', on);
  }

  /* =====================================================================
   * EVENTS (which YouTube video to play)
   * ===================================================================== */
  var events = store.get('events', []);
  var currentId = store.get('current', null);

  // Built-in Miss Globe 2026 shows. Added once on first launch (or after an
  // update), skipping any the user already has; they can be edited or deleted.
  var BUILT_IN = [
    { id: 'mg26-final', name: 'Miss Globe 2026 · Final', videoId: 'Rtxqt4FCwSA' },
    { id: 'mg26-swimsuit', name: 'Miss Globe 2026 · Swimsuit', videoId: 'xX6WihqaprQ' },
    { id: 'mg26-semi', name: 'Miss Globe 2026 · Semi final', videoId: 'YmYxJ4uUBi4' }
  ];
  if (!store.get('builtInAdded', false)) {
    BUILT_IN.forEach(function (b) {
      if (events.some(function (e) { return e.videoId === b.videoId; })) return;
      events.push({ id: b.id, name: b.name, url: 'https://www.youtube.com/live/' + b.videoId, videoId: b.videoId });
    });
    if (!currentId && events.length) currentId = events[0].id;
    store.set('events', events); store.set('current', currentId); store.set('builtInAdded', true);
  }
  function currentEvent() {
    for (var i = 0; i < events.length; i++) if (events[i].id === currentId) return events[i];
    return events[0] || null;
  }
  function saveEvents() { store.set('events', events); store.set('current', currentId); }

  function parseYouTube(s) {
    s = String(s || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:live|embed|shorts|v)\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  /* =====================================================================
   * VIDEO (YouTube IFrame Player) + resume where you left off
   * ===================================================================== */
  var player = null, playerReady = false, playing = false, isLive = false;
  var progress = store.get('progress', {});

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, fs: 0, disablekb: 1, origin: location.origin },
      events: {
        onReady: function () { playerReady = true; playCurrent(); },
        onStateChange: onState,
        onError: onError
      }
    });
  };

  function videoMsg(html) { var m = $('videoMsg'); m.innerHTML = html || ''; m.classList.toggle('on', !!html); }

  function playCurrent(fromStart) {
    var ev = currentEvent();
    if (!ev) { if (playerReady) player.stopVideo(); videoMsg('<div><b>No event chosen yet</b>Press ≡ Menu on the remote to add the Miss Globe YouTube link.</div>'); return; }
    if (!playerReady) { videoMsg('<div><b>Loading YouTube…</b>If this stays here, check the Firestick is online.</div>'); return; }
    videoMsg('');
    var p = progress[ev.videoId], start = 0;
    if (!fromStart && p && p.t > 15 && (!p.d || p.t < p.d - 30)) start = Math.floor(p.t - 3);
    if (fromStart) { delete progress[ev.videoId]; store.set('progress', progress); }
    player.loadVideoById({ videoId: ev.videoId, startSeconds: start });
    if (start) toast('Resuming “' + ev.name + '” from ' + fmt(start) + ' · Menu → Start over to restart', 4500);
    else toast('Playing “' + ev.name + '”');
  }

  function onState(e) {
    playing = e.data === 1;
    if (e.data === 1) {
      var vd = player.getVideoData ? player.getVideoData() : null;
      isLive = !!(vd && vd.isLive);
      videoMsg('');
    }
    if (e.data === 0) { // ended
      var ev = currentEvent(); if (ev) { delete progress[ev.videoId]; store.set('progress', progress); }
      showOsd();
    }
    if (e.data === 2) showOsd(true);
  }

  function onError(e) {
    var ev = currentEvent(), code = e.data;
    var why = code === 101 || code === 150 || code === 152
      ? 'The video owner has turned off playing this video inside other apps.'
      : code === 100 ? 'This video is private, removed, or the link is wrong.'
      : code === 2 ? 'That link doesn’t look like a valid YouTube video.'
      : code === 153 ? 'YouTube refused the player (missing referrer).'
      : 'YouTube reported error ' + code + '.';
    videoMsg('<div><b>Can’t play this video here</b>' + esc(why) +
      '<small>Press ≡ Menu to pick a different event or link. Error ' + code + (ev ? ' · video ' + esc(ev.videoId) : '') + '</small></div>');
  }

  // Remember the playback position every few seconds (not for live streams).
  setInterval(function () {
    if (!playerReady || !playing || isLive) return;
    var ev = currentEvent(); if (!ev) return;
    var t = player.getCurrentTime(), d = player.getDuration();
    if (t > 0) { progress[ev.videoId] = { t: t, d: d, at: Date.now() }; store.set('progress', progress); }
  }, 5000);

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }


  /* ---------------- Video quality ----------------
   * YouTube chooses its stream quality from the player's size on screen, so for
   * 720p / 480p the player is laid out at that size and scaled up to fill the
   * video area. Less to decode = smoother on a Firestick. */
  var QUALITIES = ['720', '480', 'auto'];
  var quality = store.get('quality', '720');
  function fitPlayer() {
    var v = $('video'), box = $('playerBox'), W = v.clientWidth, H = v.clientHeight;
    if (!W || !H) return;
    var dpr = window.devicePixelRatio || 1, target = quality === 'auto' ? 0 : Number(quality);
    var videoH = Math.min(H, W * 9 / 16);          // height of the 16:9 picture itself
    var s = target ? Math.min(1, target / (videoH * dpr)) : 1;
    box.style.width = (W * s) + 'px'; box.style.height = (H * s) + 'px';
    box.style.transform = s < 1 ? 'scale(' + (1 / s) + ')' : '';
  }
  function setQuality(q) {
    quality = q; store.set('quality', q); fitPlayer();
    $('qBtn').textContent = 'Video quality: ' + (q === 'auto' ? 'Auto (best)' : q + 'p');
  }
  $('qBtn').addEventListener('click', function () {
    setQuality(QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]);
    toast('Video quality: ' + (quality === 'auto' ? 'Auto' : quality + 'p') + ' — takes effect in a few seconds', 2500);
  });
  window.fitPlayer2 = fitPlayer;
  window.addEventListener('resize', fitPlayer);
  $('video').addEventListener('transitionend', fitPlayer);

  /* ---------------- Player control bar ----------------
   * OK shows the bar (and plays/pauses). With the bar open, ◀ ▶ move between
   * buttons and OK presses one. With it closed, ◀ ▶ skip 10 s — keep tapping
   * or hold and it speeds up to 30 s jumps. Presses add up on screen and the
   * video only jumps once you stop, so there's no re-buffering per tap. */
  var CTL = ['b30', 'b10', 'pp', 'f10', 'f30', 'scores', 'recap', 'events', 'restart'];
  var ctlOpen = false, ctlNav = false, ctlFocus = 2, ctlHideTimer = null, ctlTick = null;
  var seekTarget = null, seekBase = 0, seekTimer = null, seekShown = null, rep = { dir: 0, n: 0, at: 0 };

  function realTime() { return playerReady && player.getCurrentTime ? player.getCurrentTime() || 0 : 0; }
  function curTime() {
    if (seekTarget != null) return seekTarget;
    var t = realTime();
    if (seekShown && Date.now() < seekShown.until && Math.abs(t - seekShown.t) > 2) return seekShown.t;
    return t;
  }
  function updCtl() {
    if (!playerReady || !player.getDuration) return;
    var ev = currentEvent(), d = player.getDuration() || 0, t = curTime(), f = d ? Math.min(1, t / d) : 0;
    $('ctlTitle').textContent = ev ? ev.name : '';
    $('ctlFill').style.transform = 'scaleX(' + f + ')';
    $('ctlBuf').style.transform = 'scaleX(' + (player.getVideoLoadedFraction ? player.getVideoLoadedFraction() || 0 : 0) + ')';
    $('ctlKnob').style.left = (f * 100) + '%';
    $('ctlTime').textContent = fmt(t);
    $('ctlDur').textContent = isLive ? '● LIVE' : fmt(d);
    var diff = seekTarget != null ? Math.round(seekTarget - seekBase) : 0;
    $('ctlSeek').textContent = seekTarget != null && diff ? (diff > 0 ? '⏩ +' : '⏪ −') + fmtShort(Math.abs(diff)) : '';
    $('ctlPP').textContent = playing ? '❚❚' : '▶';
  }
  function fmtShort(s) { return s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '') : s + 's'; }
  function paintFocus() {
    var bs = document.querySelectorAll('#ctl [data-a]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('focus', ctlNav && i === ctlFocus);
  }
  // nav=true: buttons are selectable (after OK). nav=false: just show progress (seeking, pause).
  function showCtl(nav) {
    if (!ctlOpen) { ctlOpen = true; $('ctl').classList.add('on'); }
    if (nav && !ctlNav) { ctlNav = true; ctlFocus = 2; }
    $('ctl').classList.toggle('nav', ctlNav);
    paintFocus(); updCtl();
    clearInterval(ctlTick); ctlTick = setInterval(updCtl, 500);
    armHide();
  }
  function armHide() {
    clearTimeout(ctlHideTimer);
    ctlHideTimer = setTimeout(function () { if (playing && seekTarget == null) hideCtl(); else armHide(); }, 5000);
  }
  function hideCtl() { ctlOpen = false; ctlNav = false; $('ctl').classList.remove('on'); clearInterval(ctlTick); clearTimeout(ctlHideTimer); paintFocus(); }
  function showOsd() { showCtl(false); }   // used by player state changes

  function ctlAction(a) {
    switch (a) {
      case 'b30': seek(-30); break;
      case 'b10': seek(-10); break;
      case 'f10': seek(10); break;
      case 'f30': seek(30); break;
      case 'pp': togglePlay(); break;
      case 'scores': toggleBoard(); break;
      case 'recap': hideCtl(); openRecap(); break;
      case 'events': hideCtl(); openMenu(); break;
      case 'restart':
        if (!playerReady) break;
        seekTarget = null; clearTimeout(seekTimer); player.seekTo(0, true); player.playVideo();
        seekShown = { t: 0, until: Date.now() + 2000 }; toast('Back to the start', 1200); break;
    }
  }
  function togglePlay() {
    if (!playerReady) return;
    var want = !playing; playing = want;
    if (want) player.playVideo(); else player.pauseVideo();
    showCtl(false); updCtl();
  }
  function seek(delta) {
    if (!playerReady || !player.getCurrentTime) return;
    if (seekTarget == null) seekBase = curTime();
    var d = player.getDuration() || 0, t = curTime() + delta;
    seekTarget = Math.max(0, d ? Math.min(t, d - 1) : t);
    showCtl(false); updCtl();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      seekShown = { t: seekTarget, until: Date.now() + 2500 };
      player.seekTo(seekTarget, true); seekTarget = null; updCtl();
    }, 650);
  }
  function stepSeek(dir) {   // tap = 10 s; keep tapping / hold = 30 s jumps
    var now = Date.now();
    rep.n = rep.dir === dir && now - rep.at < 700 ? rep.n + 1 : 0;
    rep.dir = dir; rep.at = now;
    seek(dir * (rep.n >= 3 ? 30 : 10));
  }
  function toggleBoard() {
    var on = document.body.classList.contains('board-off');
    setBoard(on); toast(on ? 'Scoreboard on' : 'Scoreboard hidden · ▲ to show', 1500);
  }

  /* =====================================================================
   * VOTE POP-UPS — "Olly voted Débora Santos a 10 for Swimwear"
   * ===================================================================== */
  var feed = store.get('feed', []);   // latest votes, newest first (shown in the Recap)
  var voteQueue = [], voteBusy = false;

  function announce(votes) {
    if (!votes.length) return;
    feed = votes.slice().reverse().concat(feed).slice(0, 40); store.set('feed', feed);
    // "Sync all" or a reset can change dozens of scores at once: summarise those.
    var byJudge = {};
    votes.forEach(function (v) { (byJudge[v.judge] = byJudge[v.judge] || []).push(v); });
    Object.keys(byJudge).forEach(function (j) {
      var vs = byJudge[j];
      if (vs.length > 6) voteQueue.push({ bulk: true, judge: j, n: vs.length });
      else vs.forEach(function (v) { voteQueue.push(v); });
    });
    if (voteQueue.length > 10) voteQueue = voteQueue.slice(-10);
    nextVote();
  }
  function nextVote() {
    if (voteBusy || !voteQueue.length) return;
    var v = voteQueue.shift(), el = $('vote');
    voteBusy = true;
    el.innerHTML = voteHtml(v);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    setTimeout(function () {
      el.classList.remove('on');
      setTimeout(function () { voteBusy = false; nextVote(); }, 500);
    }, voteQueue.length ? 3500 : 5500);
  }
  function rankLine(id) {
    var list = entries(), max = roster.fields.length * 10;
    for (var i = 0; i < list.length; i++) if (list[i].c.id === id) return 'Now #' + (i + 1) + ' · ' + list[i].avg.toFixed(1) + ' / ' + max;
    return '';
  }
  function voteHtml(v) {
    if (v.bulk) return '<img src="logo.png" alt=""><div class="vt"><div class="vk">Score sync</div>' +
      '<div class="vl"><b>' + esc(v.judge) + '</b> updated ' + v.n + ' scores</div></div>';
    var c = byId[v.id];
    return photo(c) + '<div class="vt"><div class="vk">' + (v.was ? 'Score changed' : 'New vote') + ' · ' + esc(v.label) + '</div>' +
      '<div class="vl"><b>' + esc(v.judge) + '</b> voted <b>' + esc(c.name) + '</b> a <b class="vn">' + v.v + '</b> for <b>' + esc(v.label) + '</b>' +
      (v.was ? ' <span class="vw">(was ' + v.was + ')</span>' : '') + '</div>' +
      '<div class="vr">' + flag(c) + esc(c.country) + ' · ' + rankLine(v.id) + '</div></div>' +
      '<div class="vs' + (v.v >= 10 ? ' ten' : '') + '">' + v.v + '</div>';
  }

  /* =====================================================================
   * RECAP — built for the TV from the judging data, two pages (▲ ▼)
   * ===================================================================== */
  var recapPage = 0, RECAP_PAGES = 2, recapTouched = 0;
  function openRecap() { recapPage = 0; recapTouched = Date.now(); setMode('recap'); renderRecap(); }
  function closeRecap() { setMode('main'); }
  function recapTurn(d) { recapPage = (recapPage + d + RECAP_PAGES) % RECAP_PAGES; recapTouched = Date.now(); renderRecap(); }
  setInterval(function () { if (mode === 'recap' && Date.now() - recapTouched > 30000) recapTurn(1); }, 1000);

  function f1(n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
  function ago(t) { var s = Math.max(0, (Date.now() - t) / 1000); return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; }
  function nm(c) { return esc(c.name) + ' (' + flag(c) + esc(c.country) + ')'; }

  function recapData() {
    var J = roster.judges, F = roster.fields, all = allEntries(), list = entries(), rank = {};
    list.forEach(function (x, i) { rank[x.c.id] = i + 1; });
    var entered = 0;
    all.forEach(function (x) { J.forEach(function (j) { F.forEach(function (f) { if (scoreOf(x.c.id, j, f[0])) entered++; }); }); });
    var joint = function (id, f) { var s = 0; J.forEach(function (j) { s += scoreOf(id, j, f); }); return s / J.length; };
    var catLead = F.map(function (f) {
      var best = null;
      all.forEach(function (x) { var v = joint(x.c.id, f[0]); if (v > 0 && (!best || v > best.v)) best = { x: x, v: v }; });
      return { f: f, x: best && best.x, v: best ? best.v : 0 };
    });
    var p = function (j, k) { return ((picks[j] || {})[k]) || []; };
    var agree5 = J.length > 1 ? p(J[0], 'top5').filter(function (id) { return p(J[1], 'top5').indexOf(id) >= 0; }).length : 0;
    return {
      J: J, F: F, MAX: F.length * 10, all: all, list: list, rank: rank, joint: joint, catLead: catLead, p: p, agree5: agree5,
      entered: entered, maxEntered: all.length * J.length * F.length,
      both: all.filter(function (x) { return J.every(function (j) { return x.t[j] > 0; }); }),
      fieldAvg: list.length ? list.reduce(function (s, x) { return s + x.avg; }, 0) / list.length : 0
    };
  }

  function lede(d) {
    var L = d.list[0], pct = d.entered / d.maxEntered, P = Math.round(pct * 100), k, t, b;
    if (!L) return { k: 'Before the sash', t: 'The stage is set', b: d.all.length + ' delegates, ' + d.F.length + ' categories, ' + d.J.length + ' judges — and not a single score yet. The first vote writes the first headline.' };
    var S = d.list[1], gap = S ? L.avg - S.avg : 0;
    if (pct < 0.25) { k = 'Early days · ' + P + '% scored'; t = esc(L.c.name) + ' sets the early pace'; }
    else if (pct < 0.75) { k = 'The race takes shape · ' + P + '% scored'; t = esc(L.c.name) + ' leads a field finding its order'; }
    else if (pct < 1) { k = 'Final stretch · ' + P + '% scored'; t = esc(L.c.name) + ' is in the box seat'; }
    else { k = 'All scores in'; t = esc(L.c.name) + ' tops the judging'; }
    b = nm(L.c) + ' leads on ' + f1(L.avg) + ' / ' + d.MAX + (S ? (gap > 0 ? ', ' + f1(gap) + ' clear of ' + esc(S.c.name) : ', level with ' + esc(S.c.name)) : '') + '.' +
      (d.list[2] ? ' ' + esc(d.list[2].c.name) + ' completes the podium on ' + f1(d.list[2].avg) + '.' : '');
    return { k: k, t: t, b: b };
  }

  // Storylines, following the same rules as the judging site's Recap.
  function stories(d) {
    var S = [], add = function (o) { S.push(o); }, J = d.J, list = d.list, MAX = d.MAX, now = Date.now();
    var A = J[0], B = J[1];
    if (list.length === 1) add({ p: 100, k: 'First on the board', t: esc(list[0].c.name) + ' sets the pace', b: nm(list[0].c) + ' is the only delegate scored so far, on ' + f1(list[0].avg) + ' / ' + MAX + '.', c: list[0].c });
    if (list.length >= 2) {
      var a = list[0], b2 = list[1], m = a.avg - b2.avg;
      var kk = m === 0 ? 'Dead heat' : m < 1 ? 'Photo finish' : m < 3 ? 'Leader' : 'Runaway leader';
      var tt = m === 0 ? esc(a.c.name) + ' and ' + esc(b2.c.name) + ' can’t be split' : m < 1 ? esc(a.c.name) + ' leads by a whisker' : m < 3 ? esc(a.c.name) + ' edges ahead' : esc(a.c.name) + ' is pulling away';
      add({ p: 100, k: kk, t: tt, b: nm(a.c) + ' leads on ' + f1(a.avg) + ' / ' + MAX + (m > 0 ? ', ' + f1(m) + ' clear of ' + esc(b2.c.name) : ', level with ' + esc(b2.c.name)) + '.', c: a.c });
    }
    if (leaderPrev && leaderNow && leaderPrev !== leaderNow && now - leaderSince < 20 * 60000 && byId[leaderPrev]) {
      add({ p: 98, k: 'Change at the top · ' + ago(leaderSince), t: esc(byId[leaderNow].name) + ' takes the lead', b: esc(byId[leaderNow].name) + ' has overtaken ' + nm(byId[leaderPrev]) + ' at the top of the leaderboard.', c: byId[leaderNow] });
    }
    var last = feed[0];
    if (last && now - last.t < 30 * 60000 && byId[last.id]) {
      add({ p: 96, k: 'Just in · ' + ago(last.t), t: esc(last.judge) + ' gives ' + esc(byId[last.id].name) + ' a ' + last.v, b: 'A ' + last.v + ' for ' + esc(last.label) + (last.was ? ', up from ' + last.was : '') + '. ' + rankLine(last.id) + '.', c: byId[last.id] });
    }
    if (B && d.both.length) {
      var s = d.both.slice().sort(function (x, y) { return Math.abs(y.t[A] - y.t[B]) - Math.abs(x.t[A] - x.t[B]); })[0], gap = Math.abs(s.t[A] - s.t[B]);
      if (gap >= 5) { var hi = s.t[A] > s.t[B] ? A : B, lo = hi === A ? B : A; add({ p: 90, k: 'Split decision', t: 'The judges can’t agree on ' + esc(s.c.name), b: esc(hi) + ' has ' + nm(s.c) + ' on ' + s.t[hi] + ', ' + esc(lo) + ' on ' + s.t[lo] + ' — a ' + gap + '-point gap.', c: s.c }); }
      var same = d.both.filter(function (x) { return x.t[A] === x.t[B] && x.t[A] >= MAX * 0.7; }).sort(function (x, y) { return y.t[A] - x.t[A]; })[0];
      if (same) add({ p: 60, k: 'Of one mind', t: 'Total agreement on ' + esc(same.c.name), b: esc(A) + ' and ' + esc(B) + ' both landed on exactly ' + same.t[A] + ' / ' + MAX + ' for ' + nm(same.c) + '.', c: same.c });
      var ea = 0, ob = 0, n = 0;
      d.all.forEach(function (x) { d.F.forEach(function (f) { var u = scoreOf(x.c.id, A, f[0]), w = scoreOf(x.c.id, B, f[0]); if (u && w) { ea += u; ob += w; n++; } }); });
      if (n >= 5 && Math.abs(ea - ob) / n >= 0.4) { var tough = ea < ob ? A : B, kind = tough === A ? B : A; add({ p: 70, k: 'Tough marker', t: esc(tough) + ' is the harder judge', b: esc(tough) + ' averages ' + f1((tough === A ? ea : ob) / n) + ' per category against ' + esc(kind) + '’s ' + f1((tough === A ? ob : ea) / n) + '.' }); }
    }
    var wins = {};
    d.catLead.forEach(function (cl) { if (cl.x) (wins[cl.x.c.id] = wins[cl.x.c.id] || []).push(cl.f[1]); });
    var multi = Object.keys(wins).filter(function (id) { return wins[id].length >= 2; }).sort(function (x, y) { return wins[y].length - wins[x].length; })[0];
    if (multi) add({ p: 85, k: wins[multi].length >= 3 ? 'Triple threat' : 'Double threat', t: esc(byId[multi].name) + ' rules ' + wins[multi].length + ' categories', b: 'Top joint score in ' + wins[multi].map(esc).join(', ') + '.', c: byId[multi] });
    if (list.length >= 8) {
      var dh = d.catLead.filter(function (cl) { return cl.x && (d.rank[cl.x.c.id] || 99) > 5; }).sort(function (x, y) { return y.v - x.v; })[0];
      if (dh) add({ p: 75, k: 'Dark horse', t: esc(dh.x.c.name) + ' owns ' + esc(dh.f[1]), b: 'Nobody beats her ' + f1(dh.v) + ' in ' + esc(dh.f[1]) + ', yet ' + nm(dh.x.c) + ' sits #' + d.rank[dh.x.c.id] + ' overall.', c: dh.x.c });
    }
    var tens = {}, nt = 0;
    d.all.forEach(function (x) { J.forEach(function (j) { d.F.forEach(function (f) { if (scoreOf(x.c.id, j, f[0]) === 10) { nt++; tens[x.c.id] = (tens[x.c.id] || 0) + 1; } }); }); });
    if (nt) { var tt10 = Object.keys(tens).sort(function (x, y) { return tens[y] - tens[x]; })[0]; add({ p: 65, k: 'Perfect tens', t: nt + ' perfect ' + (nt === 1 ? 'ten' : 'tens') + ' so far', b: esc(byId[tt10].name) + ' has collected the most, with ' + tens[tt10] + '.', c: byId[tt10] }); }
    if (B && favs[A] && favs[A] === favs[B]) add({ p: 88, k: 'Shared favourite', t: 'Both judges have fallen for ' + esc(byId[favs[A]].name), b: esc(A) + ' and ' + esc(B) + ' have both starred ' + nm(byId[favs[A]]) + '.', c: byId[favs[A]] });
    else J.forEach(function (j) { var id = favs[j]; if (id && d.rank[id] === 1) add({ p: 68, k: esc(j) + '’s favourite', t: 'Heart and head agree', b: esc(j) + '’s favourite ' + nm(byId[id]) + ' is also leading the scores.', c: byId[id] }); });
    if (list.length > 20) { var a20 = list[19], b21 = list[20], g20 = a20.avg - b21.avg; add({ p: g20 < 1 ? 78 : 56, k: 'Top 20 bubble', t: g20 < 1 ? esc(b21.c.name) + ' is knocking on the door' : 'The Top 20 line sits at ' + f1(a20.avg), b: '#20 ' + esc(a20.c.name) + ' (' + f1(a20.avg) + ') holds off #21 ' + esc(b21.c.name) + ' (' + f1(b21.avg) + ').', c: b21.c }); }
    if (B && d.p(A, 'top20').length && d.p(B, 'top20').length) { var sh = d.p(A, 'top20').filter(function (id) { return d.p(B, 'top20').indexOf(id) >= 0; }).length; add({ p: 57, k: 'Ballot watch', t: esc(A) + ' and ' + esc(B) + ' share ' + sh + ' of their Top 20', b: d.agree5 + ' of 5 names match on the Top 5 shortlists so far.' }); }
    var none = d.all.filter(function (x) { return x.avg === 0; }).length;
    if (list.length && none) add({ p: 45, k: 'Waiting in the wings', t: none + ' delegate' + (none === 1 ? '' : 's') + ' still unscored', b: list.length + ' of ' + d.all.length + ' delegates have at least one score.' });
    return S.sort(function (x, y) { return y.p - x.p; });
  }

  function personRow(x, i, d) {
    return '<div class="rc-row">' + (i != null ? '<span class="rc-rk">' + (i + 1) + '</span>' : '') + photo(x.c) +
      '<div class="rc-who"><b>' + esc(x.c.name) + '</b><span>' + flag(x.c) + esc(x.c.country) + '</span>' + judgesHtml(x) + '</div>' +
      '<span class="rc-sc">' + x.avg.toFixed(1) + '</span></div>';
  }

  function renderRecap() {
    var d = recapData(), L = lede(d), html;
    $('rcPage').textContent = (recapPage + 1) + ' / ' + RECAP_PAGES + ' · ▲ ▼ change page · Back to return';
    if (recapPage === 0) {
      var tiles = [
        [d.list[0] ? d.list[0].avg.toFixed(1) : '—', 'Leader / ' + d.MAX],
        [d.fieldAvg ? d.fieldAvg.toFixed(1) : '—', 'Field average'],
        [d.both.length + '', 'Fully scored'],
        [Math.round(d.entered / d.maxEntered * 100) + '%', 'Scores entered'],
        [d.agree5 + ' / 5', 'Top 5 agreement']
      ].map(function (t) { return '<div class="rc-tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>'; }).join('');
      var top = d.list.slice(0, 5).map(function (x, i) { return personRow(x, i, d); }).join('') || '<div class="rc-empty">Scores appear here once judging begins.</div>';
      var cats = d.catLead.map(function (cl) {
        return '<div class="rc-cat">' + (cl.x ? photo(cl.x.c) : '<img src="logo.png" alt="">') + '<div class="rc-who"><span class="rc-catn">' + esc(cl.f[1]) + '</span><b>' + (cl.x ? esc(cl.x.c.name) : 'Awaiting scores') + '</b>' +
          (cl.x ? '<span>' + flag(cl.x.c) + esc(cl.x.c.country) + '</span>' : '') + '</div><span class="rc-sc">' + (cl.x ? f1(cl.v) : '—') + '</span></div>';
      }).join('');
      var wire = feed.filter(function (v) { return byId[v.id]; }).slice(0, 5).map(function (v) {
        var c = byId[v.id];
        return '<div class="rc-wire">' + photo(c) + '<div class="rc-who"><b>' + esc(v.judge) + ' → ' + esc(c.name) + '</b><span>' + esc(v.label) + ' · ' + ago(v.t) + '</span></div><span class="rc-vs' + (v.v >= 10 ? ' ten' : '') + '">' + v.v + '</span></div>';
      }).join('') || '<div class="rc-empty">Votes appear here the moment either judge scores.</div>';
      var favHtml = d.J.map(function (j) {
        var c = favs[j] && byId[favs[j]];
        return '<div class="rc-fav">' + (c ? photo(c) : '<img src="logo.png" alt="">') + '<div class="rc-who"><span class="rc-catn">★ ' + esc(j) + '’s favourite</span><b>' + (c ? esc(c.name) : 'Not chosen yet') + '</b>' + (c ? '<span>' + flag(c) + esc(c.country) + (d.rank[c.id] ? ' · #' + d.rank[c.id] : '') + '</span>' : '') + '</div></div>';
      }).join('');
      html = '<div class="rc-grid">' +
        '<div class="rc-lede"><div class="rc-kick">' + L.k + '</div><h1>' + L.t + '</h1><p>' + L.b + '</p><div class="rc-tiles">' + tiles + '</div></div>' +
        '<div class="rc-card rc-c1"><h3>Crown watch · Top 5</h3>' + top + '</div>' +
        '<div class="rc-card rc-c2"><h3>Category leaders</h3>' + cats + '</div>' +
        '<div class="rc-side"><div class="rc-card"><h3>Latest votes</h3>' + wire + '</div><div class="rc-card"><h3>Judges’ favourites</h3>' + favHtml + '</div></div>' +
        '</div>';
    } else {
      var st = stories(d).slice(0, 6).map(function (s) {
        return '<div class="rc-story">' + (s.c ? photo(s.c) : '') + '<div><div class="rc-kick">' + s.k + '</div><h4>' + s.t + '</h4><p>' + s.b + '</p></div></div>';
      }).join('') || '<div class="rc-empty">Storylines appear as soon as the first scores are in.</div>';
      var cover = d.J.map(function (j) {
        var n = 0; d.all.forEach(function (x) { d.F.forEach(function (f) { if (scoreOf(x.c.id, j, f[0])) n++; }); });
        var max = d.all.length * d.F.length, pc = Math.round(n / max * 100);
        return '<div class="rc-cov"><div><b>' + esc(j) + '</b><span>' + n + ' / ' + max + ' · ' + pc + '%</span></div><i><u style="width:' + pc + '%"></u></i></div>';
      }).join('');
      var low = d.list.length > 5 ? d.list.slice(-5).reverse().map(function (x) { return personRow(x, d.rank[x.c.id] - 1, d); }).join('') : '<div class="rc-empty">Appears once more delegates are scored.</div>';
      html = '<div class="rc-grid rc-p2">' +
        '<div class="rc-card rc-stories"><h3>Storylines <small>rewrite themselves as votes land</small></h3><div class="rc-sgrid">' + st + '</div></div>' +
        '<div class="rc-side"><div class="rc-card"><h3>Judge coverage</h3>' + cover + '</div><div class="rc-card"><h3>Pressure watch · Bottom 5</h3>' + low + '</div></div>' +
        '</div>';
    }
    setHtml($('rcBody'), html);
  }

  /* =====================================================================
   * EVENTS MENU
   * ===================================================================== */
  var editingId = null;

  function openMenu(showForm) {
    setMode('menu');
    renderMenu();
    if (showForm || !events.length) openForm(null);
    else focusEl(document.querySelector('.ev.current .play') || document.querySelector('#menu [data-nav]'));
  }
  function closeMenu() { closeForm(); setMode('main'); }

  function renderMenu() {
    var cur = currentEvent();
    $('evList').innerHTML = events.length ? events.map(function (ev) {
      var p = progress[ev.videoId];
      return '<div class="ev' + (cur && cur.id === ev.id ? ' current' : '') + '" data-id="' + esc(ev.id) + '">' +
        '<button class="btn play" data-nav data-act="play">' + esc(ev.name) +
        '<small>' + esc(ev.url) + (p && p.t > 15 ? ' · watched to ' + fmt(p.t) : '') + '</small></button>' +
        '<button class="btn" data-nav data-act="restart">⟲ Start over</button>' +
        '<button class="btn" data-nav data-act="edit">Edit</button>' +
        '<button class="btn" data-nav data-act="del">Delete</button></div>';
    }).join('') : '<div class="empty-ev">No events yet. Add the YouTube link for the Miss Globe show you want to watch.</div>';
  }

  $('evList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.closest('.ev').getAttribute('data-id'), act = b.getAttribute('data-act');
    var ev = events.filter(function (x) { return x.id === id; })[0]; if (!ev) return;
    if (act === 'play' || act === 'restart') { currentId = id; saveEvents(); closeMenu(); playCurrent(act === 'restart'); }
    if (act === 'edit') openForm(ev);
    if (act === 'del') {
      if (b.getAttribute('data-confirm')) {
        var wasCurrent = currentEvent() === ev;
        events = events.filter(function (x) { return x.id !== id; });
        if (wasCurrent) currentId = events[0] ? events[0].id : null;
        saveEvents(); renderMenu(); focusEl(document.querySelector('#menu [data-nav]'));
        if (wasCurrent) playCurrent();
      } else { b.setAttribute('data-confirm', '1'); b.textContent = 'Press again to delete'; }
    }
  });
  $('evAdd').addEventListener('click', function () { openForm(null); });
  $('fCancel').addEventListener('click', function () { closeForm(); focusEl($('evAdd')); });

  function openForm(ev) {
    editingId = ev ? ev.id : null;
    $('fHead').textContent = ev ? 'Edit event' : 'Add an event';
    $('fName').value = ev ? ev.name : (events.length ? '' : 'Miss Globe 2026');
    $('fUrl').value = ev ? ev.url : '';
    $('fErr').textContent = '';
    $('evForm').classList.add('on');
    focusEl(ev || events.length ? $('fName') : $('fUrl'));
  }
  function closeForm() { $('evForm').classList.remove('on'); editingId = null; }

  $('evForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('fName').value.trim(), url = $('fUrl').value.trim(), vid = parseYouTube(url);
    if (!name) { $('fErr').textContent = 'Please enter a name.'; focusEl($('fName')); return; }
    if (!vid) { $('fErr').textContent = 'That doesn’t look like a YouTube link. Try e.g. https://youtu.be/abc123XYZ00'; focusEl($('fUrl')); return; }
    if (editingId) {
      events.forEach(function (x) { if (x.id === editingId) { x.name = name; x.url = url; x.videoId = vid; } });
      currentId = editingId;
    } else {
      var id = 'ev' + Date.now().toString(36);
      events.push({ id: id, name: name, url: url, videoId: vid });
      currentId = id;
    }
    saveEvents(); closeMenu(); playCurrent();
  });

  /* ---- D-pad focus movement inside the menu ---- */
  function focusEl(el) {
    if (!el) return;
    Array.prototype.forEach.call(document.querySelectorAll('.focus'), function (x) { x.classList.remove('focus'); });
    el.focus(); el.classList.add('focus');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function navTargets() {
    return Array.prototype.filter.call(document.querySelectorAll('#menu [data-nav]'), function (el) { return el.offsetParent !== null; });
  }
  function moveFocus(dir) {
    var all = navTargets(), cur = document.activeElement;
    if (all.indexOf(cur) < 0) { focusEl(all[0]); return; }
    var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bestScore = 1e9;
    all.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, dx = bx - ax, dy = by - ay, main, side;
      var gx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), gy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      if (dir === 'up') { if (b.bottom > a.top + 2) return; main = -dy; side = gx; }
      if (dir === 'down') { if (b.top < a.bottom - 2) return; main = dy; side = gx; }
      if (dir === 'left') { if (b.right > a.left + 2 || Math.abs(dy) > a.height) return; main = -dx; side = gy; }
      if (dir === 'right') { if (b.left < a.right - 2 || Math.abs(dy) > a.height) return; main = dx; side = gy; }
      var score = Math.round(main / 4) + side * 2.5;  // rows: nearest row first, then the first button that overlaps
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focusEl(best);
  }

  /* =====================================================================
   * REMOTE KEYS
   * ===================================================================== */
  var backAt = 0;
  function key(k) {
    if (mode === 'menu') {
      if (k === 'back') { if ($('evForm').classList.contains('on') && events.length) { closeForm(); focusEl($('evAdd')); } else if (events.length) closeMenu(); else exitSoon(); return true; }
      if (k === 'menu') { if (events.length) closeMenu(); return true; }
      if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { moveFocus(k); return true; }
      if (k === 'ok') {
        var el = document.activeElement;
        if (el && el.tagName === 'INPUT') { native.showKeyboard(); return true; }
        if (el && el.click) el.click();
        return true;
      }
      return false;
    }
    if (mode === 'recap') {
      if (k === 'back' || k === 'menu') { closeRecap(); if (k === 'menu') openMenu(); return true; }
      if (k === 'up') { recapTurn(-1); return true; }
      if (k === 'down') { recapTurn(1); return true; }
    }
    if (mode === 'main' && ctlNav) {
      armHide();
      if (k === 'left') { ctlFocus = Math.max(0, ctlFocus - 1); paintFocus(); return true; }
      if (k === 'right') { ctlFocus = Math.min(CTL.length - 1, ctlFocus + 1); paintFocus(); return true; }
      if (k === 'ok') { ctlAction(CTL[ctlFocus]); return true; }
      if (k === 'up' || k === 'down' || k === 'back') { hideCtl(); return true; }
    }
    switch (k) {
      case 'ok': if (mode === 'main') { showCtl(true); return true; } togglePlay(); return true;
      case 'playpause': togglePlay(); return true;
      case 'play': if (playerReady) player.playVideo(); showOsd(); return true;
      case 'pause': if (playerReady) player.pauseVideo(); showOsd(); return true;
      case 'left': stepSeek(-1); return true;
      case 'right': stepSeek(1); return true;
      case 'rew': seek(-30); return true;
      case 'ff': seek(30); return true;
      case 'up': if (mode === 'main') toggleBoard(); return true;
      case 'down': if (mode === 'main') openRecap(); return true;
      case 'menu': hideCtl(); openMenu(); return true;
      case 'back': exitSoon(); return true;
    }
    return false;
  }
  function exitSoon() {
    if (Date.now() - backAt < 2500) { native.exitApp(); return; }
    backAt = Date.now(); toast('Press Back again to exit', 2500);
  }

  // Keyboard (desktop testing, and D-pad inside the menu on the Firestick).
  var KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'playpause',
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaRewind: 'rew', MediaFastForward: 'ff',
    ContextMenu: 'menu', m: 'menu', M: 'menu', Escape: 'back', GoBack: 'back', BrowserBack: 'back' };
  document.addEventListener('keydown', function (e) {
    var k = KEYMAP[e.key]; if (!k) return;
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (inInput && (k === 'left' || k === 'right' || k === 'playpause' || k === 'menu' && e.key.length === 1)) return; // let the text box use them
    if (inInput && k === 'ok') { e.preventDefault(); key('ok'); return; }  // open the on-screen keyboard
    if (mode === 'menu' && k === 'ok') return;  // native click on the focused button
    if (key(k)) e.preventDefault();
  }, true);

  // Entry point for the Android app.
  window.TV = { key: key };

  /* ---------------- Start ---------------- */
  setBoard(store.get('boardOn', true));
  setQuality(quality);
  render();
  poll(); setInterval(poll, POLL_MS);
  setInterval(renderFoot, 5000);
  loadRoster();
  setMode('main');
  if (!events.length) openMenu(true);
  else videoMsg('<div><b>Loading YouTube…</b>If this stays here, check the Firestick is online.</div>');
})();
