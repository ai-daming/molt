/* Runs synchronously in <head> so the theme is applied before the body
   paints — avoids a flash of the default palette on reload.

   A stored theme means the user picked one manually — it always wins.
   With no stored choice we follow the OS color scheme (dark → midnight,
   light → warm) without persisting anything, so a later OS switch can
   still change the theme. */
(function () {
  try {
    var t = localStorage.getItem('tab-out-theme');
    if (!t) {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'midnight'
        : 'warm';
    }
    document.documentElement.dataset.theme = t;
  } catch (e) { /* localStorage unavailable — fall back to default */ }
})();
