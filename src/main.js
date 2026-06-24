import './main.css';

/**
 * Theme behaviors. `Drupal` and `once` are runtime globals provided by core
 * before theme scripts load; referenced via window to avoid ESM import issues.
 */
(({ behaviors } = window.Drupal ?? {}) => {
  if (!behaviors) return;
  const once = window.once;

  /**
   * Slide-out primary menu on phone widths. Lightest-footprint approach: the
   * button toggles `data-open` / `aria-expanded`; all motion is CSS transitions
   * (see src/main.css). No framework, no inline styles.
   */
  behaviors.themeMenu = {
    attach(context) {
      const toggles = once
        ? once('theme-menu', '[data-menu-toggle]', context)
        : [...(context.querySelectorAll?.('[data-menu-toggle]') ?? [])];

      toggles.forEach((btn) => {
        const nav = document.getElementById(btn.getAttribute('aria-controls'));
        if (!nav) return;
        const backdrop = document.querySelector('[data-menu-backdrop]');

        const setOpen = (open) => {
          btn.setAttribute('aria-expanded', String(open));
          nav.dataset.open = String(open);
          if (backdrop) backdrop.dataset.open = String(open);
        };

        btn.addEventListener('click', () => setOpen(nav.dataset.open !== 'true'));
        backdrop?.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') setOpen(false);
        });
      });
    },
  };
})();
