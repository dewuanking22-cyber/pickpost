// Vote cards: click-to-vote without a page reload, share forms, live card refresh, swipe/tap between Markets and Sports.
// Everything degrades to normal form posts when JavaScript is off.
(function () {
  function csrfOf(form) { var i = form.querySelector('input[name=_csrf]'); return i ? i.value : ''; }

  function swapCard(oldEl, html) {
    var tmp = document.createElement('div'); tmp.innerHTML = html;
    var fresh = tmp.firstElementChild; if (!fresh) return;
    // keep an open share box open
    var open = oldEl.querySelector('details.sharebox[open]'); if (open) { var d = fresh.querySelector('details.sharebox'); if (d) d.open = true; }
    oldEl.replaceWith(fresh);
    if (window.PickPostLocalize) window.PickPostLocalize(fresh);
    fresh.classList.add('flash');
    setTimeout(function () { fresh.classList.remove('flash'); }, 900);
  }
  function note(card, msg, ok) {
    var n = card.querySelector('.vmsg');
    if (!n) { n = document.createElement('p'); n.className = 'vmsg'; n.setAttribute('role', 'status'); card.querySelector('.vnote').before(n); }
    n.textContent = msg; n.classList.toggle('ok', !!ok);
  }

  document.addEventListener('submit', function (e) {
    var form = e.target; if (!form.matches) return;
    var isVote = form.matches('form[data-vote]'), isShare = form.matches('form[data-share]');
    if (!isVote && !isShare) return;
    if (e.defaultPrevented) return;
    var card = form.closest('.gcard, .mvcard, .card');
    var fd = new FormData(form);
    if (e.submitter && e.submitter.name) fd.set(e.submitter.name, e.submitter.value);
    e.preventDefault();
    var body = new URLSearchParams(); fd.forEach(function (v, k) { body.append(k, v); });
    fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'X-Requested-With': 'fetch' }, body: body.toString() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (isVote) {
          if (!res.ok) { note(card, res.j.error || 'Could not save your vote.', false); return; }
          swapCard(card, res.j.html);
        } else {
          if (!res.ok) { note(card, res.j.error || 'Could not share.', false); return; }
          note(card, res.j.message || 'Shared!', true);
          var det = form.closest('details'); if (det) det.open = false;
        }
      })
      .catch(function () { form.submit(); });
  });

  // refresh visible cards every 30s (splits, status, scores) unless the user is typing in one
  window.PickPostRefreshCards = function () {
    var cards = document.querySelectorAll('article.gcard[data-gid]');
    if (cards.length > 12) return;
    cards.forEach(function (c) {
      if (c.contains(document.activeElement) && document.activeElement.matches('input,select')) return;
      if (c.querySelector('details[open]')) return;
      var back = c.querySelector('input[name=back]'); var u = '/game/' + encodeURIComponent(c.getAttribute('data-gid')) + '/card' + (back ? '?back=' + encodeURIComponent(back.value) : '');
      fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) { if (html && document.body.contains(c)) swapCard(c, html); }).catch(function () {});
    });
  };

  // ---- Markets / Sports split: tabs on narrow screens ----
  var split = document.getElementById('split');
  function setPane(name) {
    if (!split) return;
    split.setAttribute('data-pane', name);
    split.querySelectorAll('[data-pane-btn]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pane-btn') === name); });
  }
  if (split) split.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-pane-btn]'); if (b) setPane(b.getAttribute('data-pane-btn')); });

  // ---- swipe left/right to switch side on touch screens ----
  var sx = 0, sy = 0, st = 0, ignore = false;
  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now();
    ignore = !!(e.target.closest && e.target.closest('.strip, .chips, .tablewrap, input, select, textarea, .chat, .vbtns, details[open]'));
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (ignore || window.innerWidth > 900) return;
    var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 90 || Math.abs(dy) > 60 || Date.now() - st > 700) return;
    var left = dx < 0; // swipe left => go to the right-hand side (Sports); swipe right => Markets
    var target = left ? 'sports' : 'markets';
    if (split) { setPane(target); return; }
    var mode = document.body.getAttribute('data-mode');
    if (mode === 'split' || mode === target) return;
    var link = document.querySelector('.sw-' + target); if (link) window.location.href = link.getAttribute('href');
  }, { passive: true });
})();
