// Progressive Web App: manifest (built from config so rebranding "just works"), service worker, offline page.
module.exports = function (app, ctx) {
  const { config } = ctx;
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').json({
      name: config.appName, short_name: config.appName.slice(0, 12), description: config.tagline,
      start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait-primary',
      background_color: '#0e1118', theme_color: config.accentColor,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'New post', url: '/post/new' }, { name: 'Markets', url: '/markets' }, { name: 'Live scores', url: '/scores' }, { name: 'Groups', url: '/groups' },
      ],
    });
  });
  app.get('/sw.js', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('application/javascript').sendFile(require('path').join(__dirname, '..', 'public', 'sw.js')); });
  app.get('/offline', (req, res) => res.render('offline', { pageTitle: 'Offline', sidebar: false }));
};
