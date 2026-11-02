// Tiny progressive enhancement. The site works without JavaScript.
(function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  // select-all on click for copyable fields
  document.addEventListener('click', function (e) { if (e.target.classList && e.target.classList.contains('copybox')) e.target.select(); });
  // confirm destructive actions
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // new-post form: show the fields for the chosen market
  var cat = document.getElementById('category');
  if (!cat) return;
  var form = document.getElementById('postform');
  function apply() {
    var opt = cat.options[cat.selectedIndex];
    var kind = opt.getAttribute('data-kind');
    document.getElementById('subjectLabel').textContent = opt.getAttribute('data-label');
    var subj = document.getElementById('subject');
    subj.placeholder = opt.getAttribute('data-ph');
    form.querySelectorAll('div[data-kind]').forEach(function (d) {
      var on = d.getAttribute('data-kind') === kind;
      d.hidden = !on;
      d.querySelectorAll('input,select').forEach(function (i) { i.disabled = !on; });
    });
    if (kind === 'trading') {
      var isOpt = cat.value === 'options';
      var sel = document.getElementById('pickTrading');
      Array.prototype.forEach.call(sel.options, function (o) {
        var show = (o.getAttribute('data-opt') === 'yes') === isOpt;
        o.hidden = !show; o.disabled = !show;
      });
      if (sel.options[sel.selectedIndex].disabled) {
        for (var i = 0; i < sel.options.length; i++) if (!sel.options[i].disabled) { sel.selectedIndex = i; break; }
      }
      document.getElementById('optHint').hidden = !isOpt;
    }
  }
  cat.addEventListener('change', apply);
  apply();
})();
