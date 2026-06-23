import './main.css';

/**
 * Drupal behaviors are attached via the global Drupal object which core loads
 * before theme scripts. Vite bundles this module; the Drupal object is a
 * runtime global so we reference it via window to avoid ESM import issues.
 */
(({ behaviors, announce } = window.Drupal ?? {}) => {
  if (!behaviors) return;

  behaviors.theme = {
    attach(context) {
      // Place theme-specific DOM interactions here.
      // `context` is the DOM subtree being processed (may be a partial page
      // update from AJAX), so always scope queries to it.
    },
  };
})();
