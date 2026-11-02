// Live panels: price ticker, live-scores strip, markets page and sidebar auto-refresh, ticking clocks, local times.
(function () {
  var live = document.body.getAttribute('data-live') === '1';
  function fmtPrice(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var a = Math.abs(n);
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: a < 10 ? 4 : 2, maximumFractionDigits: a < 10 ? 4 : 2 });
  }
  function fmtPct(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function cls(n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; }
  function el(tag, c, txt) { var e = document.createElement(tag); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; }

  // local clocks for each world market
  function tickClocks() {
    document.querySelectorAll('.clock[data-tz]').forEach(function (n) {
      try { n.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: n.getAttribute('data-tz'), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); } catch (e) {}
    });
  }
  tickClocks(); setInterval(tickClocks, 15000);

  // server renders game times in US Eastern; show them in the viewer's own time zone
  function localize(root) {
    (root || document).querySelectorAll('time.lt[datetime]').forEach(function (t) {
      var d = new Date(t.getAttribute('datetime')); if (isNaN(d)) return;
      var compact = !!t.closest('.sc');
      try { t.textContent = new Intl.DateTimeFormat(undefined, compact ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d); } catch (e) {}
    });
  }
  window.PickPostLocalize = localize;
  localize();
  if (!live) return;

  // ---- price ticker (every .tickerTrack; there can be two in split view) ----
  function renderTicker(snap) {
    var by = {}; snap.sections.forEach(function (s) { by[s.key] = s.items; });
    var items = [].concat((by.indices || []).slice(0, 3), (by.crypto || []).slice(0, 3), (by.forex || []).slice(0, 2), (by.stocks || []).slice(0, 4));
    if (!items.length) return;
    document.querySelectorAll('.tickerTrack').forEach(function (track) {
      track.textContent = '';
      items.forEach(function (t) {
        var s = el('a', 'tk'); s.href = t.ysym ? '/t/' + encodeURIComponent(t.ysym) : '/markets';
        s.appendChild(el('b', '', t.symbol)); s.appendChild(document.createTextNode(' ' + fmtPrice(t.price) + ' '));
        s.appendChild(el('i', cls(t.changePct), fmtPct(t.changePct))); track.appendChild(s);
      });
    });
  }
  function renderSideWorld(snap) {
    var ul = document.getElementById('sideWorld'); if (!ul || !snap.world) return;
    ul.textContent = '';
    snap.world.forEach(function (w) {
      var li = el('li'), a = el('a'); a.href = '/markets/' + w.key;
      a.appendChild(el('span', 'dot ' + w.status.state)); a.appendChild(el('span', 'wn', w.flag + ' ' + w.name));
      var v = el('span', 'wv'); var i = w.indices && w.indices[0];
      if (i) v.appendChild(el('i', cls(i.changePct), fmtPct(i.changePct))); else v.textContent = w.status.label;
      a.appendChild(v); li.appendChild(a); ul.appendChild(li);
    });
  }
  function renderMarketCards(snap) {
    var grid = document.getElementById('mgrid'); if (!grid) return;
    snap.world.forEach(function (w) {
      var card = grid.querySelector('[data-key="' + w.key + '"]'); if (!card || !w.indices.length) return;
      card.querySelectorAll('.idx').forEach(function (n) { n.remove(); });
      var anchor = card.querySelector('.clockrow');
      w.indices.forEach(function (i) {
        var r = el('div', 'idx'); r.appendChild(el('span', '', i.name || i.symbol)); r.appendChild(el('b', '', fmtPrice(i.price))); r.appendChild(el('i', cls(i.changePct), fmtPct(i.changePct)));
        card.insertBefore(r, anchor);
      });
    });
    document.querySelectorAll('.mcard .pill').forEach(function (p) {
      var key = p.closest('.mcard').getAttribute('data-key'); var w = snap.world.filter(function (x) { return x.key === key; })[0]; if (!w) return;
      p.className = 'pill ' + w.status.state; p.textContent = ''; p.appendChild(el('span', 'dot ' + w.status.state)); p.appendChild(document.createTextNode(w.status.label));
    });
    var u = document.getElementById('mktUpdated'); if (u && snap.updatedAt) u.textContent = 'Updated ' + snap.updatedAt.slice(11, 19) + ' UTC';
  }
  function pollMarkets() {
    fetch('/api/markets', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (snap) {
      renderTicker(snap); renderSideWorld(snap); renderMarketCards(snap);
    }).catch(function () {});
  }
  pollMarkets(); setInterval(pollMarkets, 60000);

  // ---- live-scores strip (every .strack) ----
  function renderStrip(snap) {
    var all = []; snap.leagues.forEach(function (l) { all = all.concat(l.games); });
    var liveG = all.filter(function (g) { return g.state === 'in'; });
    var pre = all.filter(function (g) { return g.state === 'pre'; }).sort(function (a, b) { return a.starts_at < b.starts_at ? -1 : 1; });
    var post = all.filter(function (g) { return g.state === 'post'; }).sort(function (a, b) { return a.starts_at < b.starts_at ? 1 : -1; });
    var items = liveG.concat(pre.slice(0, 10), post.slice(0, liveG.length + pre.length < 6 ? 6 : 3)).slice(0, 16);
    document.querySelectorAll('.sstrip').forEach(function (strip) {
      var lbl = strip.querySelector('.striplabel'); if (lbl) lbl.textContent = liveG.length ? '🔴 LIVE' : '🏟️ SCORES';
      var track = strip.querySelector('.strack'); if (!track) return;
      track.textContent = '';
      if (!items.length) { track.appendChild(el('span', 'sc muted', 'No games on the board right now.')); return; }
      items.forEach(function (g) {
        var a = el('a', 'sc ' + g.state); a.href = '/game/' + g.id;
        if (g.state === 'in') a.appendChild(el('span', 'lv', 'LIVE')); else if (g.state === 'post') a.appendChild(el('span', 'fin', 'FINAL'));
        a.appendChild(el('small', 'lgn', g.leagueLabel));
        a.appendChild(el('b', '', g.away.abbr));
        a.appendChild(document.createTextNode(g.state === 'pre' ? ' @ ' : ' ' + g.away.score + ' – ' + g.home.score + ' '));
        a.appendChild(el('b', '', g.home.abbr));
        var sm = el('small', 'muted');
        if (g.state === 'pre') { var t = el('time', 'lt', ''); t.setAttribute('datetime', g.starts_at); sm.appendChild(t); } else if (g.state === 'in') sm.textContent = g.detail;
        a.appendChild(sm); track.appendChild(a);
      });
      localize(track);
    });
  }
  function renderSideLive(snap) {
    var box = document.getElementById('sideLive'); if (!box) return;
    box.textContent = '';
    var l = snap.live.slice(0, 5);
    if (!l.length) { box.appendChild(el('p', 'muted small', 'No games in progress right now.')); return; }
    l.forEach(function (g) {
      var a = el('a', 'mini'); a.href = '/game/' + g.id;
      a.appendChild(el('span', 'lg', g.leagueLabel));
      var s = el('span'); s.textContent = g.away.abbr + ' '; s.appendChild(el('b', '', g.away.score)); s.appendChild(document.createTextNode(' – ')); s.appendChild(el('b', '', g.home.score)); s.appendChild(document.createTextNode(' ' + g.home.abbr));
      a.appendChild(s); a.appendChild(el('small', '', g.detail)); box.appendChild(a);
    });
  }
  function pollScores() {
    if (document.hidden) return;
    fetch('/api/scores', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (snap) {
      renderStrip(snap); renderSideLive(snap);
      var u = document.getElementById('scoresUpdated'); if (u) u.textContent = 'Updated ' + new Date().toLocaleTimeString();
      if (window.PickPostRefreshCards) window.PickPostRefreshCards();
    }).catch(function () {});
  }
  setInterval(pollScores, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pollScores(); });
})();
