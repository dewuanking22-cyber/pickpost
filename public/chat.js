// Real-time channel chat (socket.io). Falls back to a normal form POST if sockets are unavailable.
(function () {
  var root = document.querySelector('.chat'); if (!root || typeof io === 'undefined') return;
  var chId = Number(root.getAttribute('data-channel')), meName = root.getAttribute('data-me');
  var staff = root.getAttribute('data-staff') === '1', gid = root.getAttribute('data-group'), csrf = root.getAttribute('data-csrf');
  var msgs = document.getElementById('msgs'), input = document.getElementById('msgInput'), form = document.getElementById('composer');
  var errBox = document.getElementById('chatErr'), conn = document.getElementById('conn');
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; }
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function showErr(m) { errBox.textContent = m; errBox.hidden = !m; }
  scroll();

  function addMessage(m) {
    if (m.channelId !== chId || msgs.querySelector('[data-id="' + m.id + '"]')) return;
    var empty = document.getElementById('emptyMsg'); if (empty) empty.remove();
    var d = el('div', 'msg'); d.setAttribute('data-id', m.id);
    var h = el('div', 'mhead'), a = el('a', 'who', '@' + m.username); a.href = '/u/' + encodeURIComponent(m.username); h.appendChild(a);
    if (m.role === 'owner' || m.role === 'mod') { h.appendChild(document.createTextNode(' ')); h.appendChild(el('span', 'role ' + m.role, m.role)); }
    h.appendChild(document.createTextNode(' ')); h.appendChild(el('span', 'muted small', 'just now'));
    if (staff || m.username === meName) {
      var f = el('form', 'inline'); f.method = 'post'; f.action = '/g/' + gid + '/c/' + chId + '/m/' + m.id + '/delete';
      var i = el('input'); i.type = 'hidden'; i.name = '_csrf'; i.value = csrf; f.appendChild(i);
      var b = el('button', 'linkbtn muted small', '✕'); b.setAttribute('aria-label', 'Delete message'); f.appendChild(b); h.appendChild(document.createTextNode(' ')); h.appendChild(f);
    }
    d.appendChild(h); if (m.body) d.appendChild(el('div', 'mbody', m.body));
    if (m.card && /^\//.test(m.card.href)) {
      var k = el('a', 'vcard-embed s-' + m.card.status); k.href = m.card.href;
      k.appendChild(el('span', 'vc-kind', m.card.kind === 'game' ? '🏟️ Game vote' : '📈 Market vote')); k.appendChild(el('b', '', m.card.title)); k.appendChild(el('span', '', m.card.pick));
      k.appendChild(el('span', 'status s-' + m.card.status, m.card.status === 'open' ? 'Pending' : m.card.status)); d.appendChild(k);
    }
    var atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    msgs.appendChild(d); if (atBottom || m.username === meName) scroll();
  }

  var socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', function () { conn.className = 'conn on'; conn.title = 'Connected'; socket.emit('join', chId, function (r) { if (!r || !r.ok) showErr('Could not join this channel.'); }); });
  socket.on('disconnect', function () { conn.className = 'conn off'; conn.title = 'Reconnecting…'; });
  socket.on('connect_error', function () { conn.className = 'conn off'; });
  socket.on('message', addMessage);
  socket.on('deleted', function (d) { var n = msgs.querySelector('[data-id="' + d.id + '"]'); if (n) n.remove(); });
  socket.on('channel-removed', function (d) { if (d.channelId === chId) window.location.href = '/g/' + gid; });

  form.addEventListener('submit', function (e) {
    if (!socket.connected) return; // normal POST fallback
    e.preventDefault();
    var body = input.value.trim(); if (!body) return;
    socket.emit('message', { channelId: chId, body: body }, function (r) {
      if (r && r.ok) { input.value = ''; showErr(''); } else showErr((r && r.error) || 'Could not send.');
    });
  });
})();
