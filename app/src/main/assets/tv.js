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

  var totals = {};        // id -> { judge: total }
  var prevAvg = {};       // id -> last average (to flash changes)
  var prevRank = {};      // id -> last rank
  var moves = {};         // id -> { dir:'up'|'down', until:time }
  var flashes = {};       // id -> until time
  var lastOk = 0, online = false, firstLoad = true;

  function poll() {
    fetch(API, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      var next = {};
      (json.data || []).forEach(function (row) {
        if (!byId[row.contestant_id]) return;          // skip picks / favourites rows
        var s = row.scores || {};
        var t = roster.fields.reduce(function (sum, f) { return sum + (Number(s[f[0]]) || 0); }, 0);
        (next[row.contestant_id] = next[row.contestant_id] || {})[row.judge] = t;
      });
      totals = next; online = true; lastOk = Date.now();
      render();
    }).catch(function () { online = false; renderFoot(); });
  }

  function entries() {
    var J = roster.judges;
    return roster.candidates.map(function (c) {
      var t = totals[c.id] || {};
      var sum = 0; J.forEach(function (j) { sum += t[j] || 0; });
      return { c: c, t: t, avg: sum / J.length };
    }).filter(function (x) { return x.avg > 0; })
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
    return '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'src="' + esc(c.photo || 'logo.png') + '" onerror="this.onerror=null;this.src=\'logo.png\'" alt="">';
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

    var mv = function (id) {
      var m = moves[id]; if (!m || m.until < now) return '';
      return '<span class="mv ' + m.dir + '">' + (m.dir === 'up' ? '▲' : '▼') + '</span>';
    };

    if (!list.length) {
      $('leader').innerHTML = '<div class="lead-tag">Leader</div><div class="b-empty" style="padding:.6rem 0;text-align:left">Waiting for the first scores from the judges…</div>';
      $('list').innerHTML = '<div class="b-empty">' + roster.candidates.length + ' delegates · ' + roster.fields.length + ' categories · ' + roster.judges.length + ' judges.<br>The leaderboard fills in as scores land.</div>';
    } else {
      var L = list[0];
      $('leader').innerHTML =
        '<div class="lead-tag">★ Current leader' + mv(L.c.id) + '</div>' +
        '<div class="lead' + (flashes[L.c.id] > now ? ' flash' : '') + '">' + photo(L.c) +
        '<div class="lead-info"><div class="lead-name">' + esc(L.c.name) + '</div>' +
        '<div class="lead-country">' + flag(L.c) + esc(L.c.country) + '</div>' +
        '<div class="lead-score">' + L.avg.toFixed(1) + '<small>/ ' + maxTotal + '</small></div>' +
        judgesHtml(L) + '</div></div>';
      $('list').innerHTML = list.slice(1).map(function (x, i) {
        var r = i + 2;
        return '<div class="srow r' + r + (flashes[x.c.id] > now ? ' flash' : '') + '">' +
          '<span class="rk">' + r + '</span>' + photo(x.c) +
          '<div class="who"><div class="nm">' + esc(x.c.name) + '</div>' +
          '<div class="ct">' + flag(x.c) + esc(x.c.country) + '</div>' + judgesHtml(x) + '</div>' +
          '<span class="sc">' + x.avg.toFixed(1) + mv(x.c.id) + '</span></div>';
      }).join('') || '<div class="b-empty">More delegates appear here as they are scored.</div>';
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
    $('foot').innerHTML = '<span>' + scoredCount + ' / ' + roster.candidates.length + ' scored</span><span>' +
      (online ? 'Updated ' + when : (lastOk ? 'Reconnecting… last ' + when : 'Connecting…')) + '</span>';
  }

  // Gentle auto-scroll when the leaderboard is longer than the panel.
  var scroll = { phase: 'top', until: 0, y: 0, last: 0 };
  function autoScroll(t) {
    var wrap = $('listWrap'), max = wrap.scrollHeight - wrap.clientHeight;
    var dt = scroll.last ? Math.min(100, t - scroll.last) : 16; scroll.last = t;
    if (max <= 4) { scroll.phase = 'top'; scroll.y = 0; scroll.until = t + 5000; }
    else if (scroll.phase === 'top' && t > scroll.until) scroll.phase = 'run';
    else if (scroll.phase === 'run') {
      scroll.y += dt * wrap.clientHeight / 22000;      // ~22 s to scroll one panel height
      if (scroll.y >= max) { scroll.y = max; scroll.phase = 'bottom'; scroll.until = t + 5000; }
    } else if (scroll.phase === 'bottom' && t > scroll.until) { scroll.y = 0; scroll.phase = 'top'; scroll.until = t + 6000; }
    wrap.scrollTop = scroll.y;
    requestAnimationFrame(autoScroll);
  }

  function setBoard(on) {
    document.body.classList.toggle('board-off', !on);
    store.set('boardOn', on);
  }

  /* =====================================================================
   * EVENTS (which YouTube video to play)
   * ===================================================================== */
  var events = store.get('events', []);
  var currentId = store.get('current', null);
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

  var osdTimer, osdTick;
  function showOsd(stay) {
    var ev = currentEvent(); if (!ev) return;
    var o = $('osd'); o.classList.add('on');
    var upd = function () {
      if (!playerReady || !player.getCurrentTime) return;
      var t = player.getCurrentTime() || 0, d = player.getDuration() || 0;
      $('osdTitle').textContent = ev.name;
      $('osdFill').style.width = (isLive ? 100 : d ? Math.min(100, t / d * 100) : 0) + '%';
      $('osdTime').textContent = isLive ? '● LIVE' : fmt(t) + ' / ' + fmt(d);
      $('osdState').textContent = playing ? '▶ Playing' : '❚❚ Paused';
    };
    upd(); clearInterval(osdTick); osdTick = setInterval(upd, 500);
    clearTimeout(osdTimer);
    if (!stay) osdTimer = setTimeout(function () { o.classList.remove('on'); clearInterval(osdTick); }, 4000);
  }

  function togglePlay() {
    if (!playerReady) return;
    if (playing) player.pauseVideo(); else player.playVideo();
    setTimeout(function () { showOsd(!playing); }, 250);
  }
  function seek(delta) {
    if (!playerReady || !player.getCurrentTime) return;
    var d = player.getDuration() || 0, t = player.getCurrentTime() + delta;
    t = Math.max(0, d ? Math.min(t, d - 1) : t);
    player.seekTo(t, true);
    toast((delta > 0 ? '⏩ +' : '⏪ −') + Math.abs(delta) + 's', 900);
    showOsd();
  }

  /* =====================================================================
   * RECAP — the judging site's own Recap page, shown full screen
   * ===================================================================== */
  var RECAP_CSS = '#roleModal,header,.sidebar,.topline,#toast,#fireworksCanvas,.page-actions{display:none!important}' +
    '.layout{display:block!important;max-width:none!important;padding:0!important;margin:0!important}' +
    '.main{max-width:none!important;margin:0!important;padding:24px 28px 28vw!important}' +
    'html,body{overflow-x:hidden!important}';
  var recapScroller = null;

  function openRecap() {
    setMode('recap');
    var f = $('recapFrame');
    $('recapMsg').innerHTML = '<div><b>Loading recap…</b></div>'; $('recapMsg').classList.add('on');
    f.onload = function () {
      try {
        var w = f.contentWindow, d = w.document;
        if (typeof w.go !== 'function') throw new Error('no recap');
        var st = d.createElement('style'); st.textContent = RECAP_CSS; d.head.appendChild(st);
        w.go('recap');
        var main = d.querySelector('.main');
        recapScroller = main && main.scrollHeight > main.clientHeight + 10 && /auto|scroll/.test(w.getComputedStyle(main).overflowY) ? main : (d.scrollingElement || d.documentElement);
        $('recapMsg').classList.remove('on');
      } catch (e) {
        $('recapMsg').innerHTML = '<div><b>Recap unavailable</b>Couldn’t open the recap page on globe2026.ollpot.life.<small>Press Back to return.</small></div>';
      }
    };
    f.src = SITE + '/?tv=recap&t=' + Date.now();
  }
  function closeRecap() {
    $('recapFrame').src = 'about:blank'; recapScroller = null;
    setMode('main');
  }
  function scrollRecap(dir) {
    if (!recapScroller) return;
    var h = $('recapFrame').clientHeight * 0.45;
    try { recapScroller.scrollBy({ top: dir * h, behavior: 'smooth' }); } catch (e) { recapScroller.scrollTop += dir * h; }
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
      if (k === 'up') { scrollRecap(-1); return true; }
      if (k === 'down') { scrollRecap(1); return true; }
    }
    switch (k) {
      case 'ok': case 'playpause': togglePlay(); return true;
      case 'play': if (playerReady) player.playVideo(); showOsd(); return true;
      case 'pause': if (playerReady) player.pauseVideo(); showOsd(true); return true;
      case 'left': seek(-10); return true;
      case 'right': seek(10); return true;
      case 'rew': seek(-30); return true;
      case 'ff': seek(30); return true;
      case 'up': if (mode === 'main') { var on = document.body.classList.contains('board-off'); setBoard(on); toast(on ? 'Scoreboard on' : 'Scoreboard hidden · ▲ to show', 1500); } return true;
      case 'down': if (mode === 'main') openRecap(); return true;
      case 'menu': openMenu(); return true;
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
  render();
  poll(); setInterval(poll, POLL_MS);
  setInterval(renderFoot, 1000);
  loadRoster();
  requestAnimationFrame(autoScroll);
  setMode('main');
  if (!events.length) openMenu(true);
  else videoMsg('<div><b>Loading YouTube…</b>If this stays here, check the Firestick is online.</div>');
})();
