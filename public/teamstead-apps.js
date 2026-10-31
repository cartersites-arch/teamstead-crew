(() => {
  const host = location.hostname;
  const onHub = host === 'pms-company-hub.pages.dev';
  const onParts = !onHub && location.pathname.startsWith('/parts');
  const current = onHub ? 'hub' : onParts ? 'parts' : 'chat';
  const planProducts = {
    chat: { chat: true, hub: false, parts: false },
    hub: { chat: false, hub: true, parts: false },
    parts: { chat: false, hub: false, parts: true },
    combined: { chat: true, hub: true, parts: false },
    chat_parts: { chat: true, hub: false, parts: true },
    hub_parts: { chat: false, hub: true, parts: true },
    complete: { chat: true, hub: true, parts: true },
  };
  let productPromise;

  function companyId() {
    if (onHub) {
      try { return sessionStorage.getItem('hub-chat-return-company') || 'main'; } catch { return 'main'; }
    }
    return new URLSearchParams(location.search).get('company') || 'main';
  }

  function companyQuery() {
    const company = companyId();
    return company === 'main' ? '' : `?company=${encodeURIComponent(company)}`;
  }

  function destinations() {
    const query = companyQuery();
    if (onHub) return {
      chat: `https://teamstead-crew.pages.dev/${query}`,
      hub: location.href,
      parts: `https://teamstead-crew.pages.dev/parts/${query}#search`,
    };
    return {
      chat: `/${query}`,
      hub: `/maintenance/open${query}`,
      parts: `/parts/${query}#search`,
    };
  }

  function signedInChat() {
    if (current !== 'chat') return true;
    return [...document.querySelectorAll('button')].some(button => /^(log out|sign out|cerrar sesi[oó]n)$/i.test(button.textContent.trim()));
  }

  function hideDuplicateChatLinks() {
    if (current !== 'chat') return;
    for (const button of document.querySelectorAll('button')) {
      const text = button.textContent.trim();
      const label = button.getAttribute('aria-label') || '';
      if (text === 'Maintenance' || text === 'Parts Finder' || label === 'Maintenance Hub' || label === 'Parts Finder') {
        (button.closest('li') || button).dataset.teamsteadRedundantAppLink = 'true';
      }
    }
    document.querySelectorAll('.crew-hub-link').forEach(node => { node.dataset.teamsteadRedundantAppLink = 'true'; });
  }

  async function products() {
    if (onHub) {
      const plan = new URLSearchParams(location.search).get('teamsteadPlan');
      return planProducts[plan] || null;
    }
    if (!productPromise) {
      const query = companyQuery();
      productPromise = fetch(`/api/chat${query ? `${query}&action=state` : '?action=state'}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(response => response.ok ? response.json() : null)
        .then(data => data && data.products ? data.products : null)
        .catch(() => null);
    }
    return productPromise;
  }

  function makeItem(key, label, href) {
    if (key === current) {
      const item = document.createElement('span');
      item.setAttribute('aria-current', 'page');
      item.textContent = label;
      return item;
    }
    const item = document.createElement('a');
    item.href = href;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.textContent = label;
    return item;
  }

  async function install() {
    hideDuplicateChatLinks();
    if (!signedInChat() || document.getElementById('teamstead-app-switcher')) return;
    const enabled = await products();
    if (!enabled || !signedInChat() || document.getElementById('teamstead-app-switcher')) return;
    const available = [
      enabled.chat && ['chat', 'Chat'],
      enabled.hub && ['hub', 'Maintenance Hub'],
      enabled.parts && ['parts', 'Parts Finder'],
    ].filter(Boolean);
    if (available.length < 2 || !available.some(([key]) => key !== current)) return;
    const links = destinations();
    const details = document.createElement('details');
    details.id = 'teamstead-app-switcher';
    details.className = 'teamstead-app-switcher';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', 'Open Teamstead Apps menu');
    summary.textContent = 'Teamstead Apps';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Teamstead apps');
    nav.append(...available.map(([key, label]) => makeItem(key, label, links[key])));
    details.append(summary, nav);
    document.body.append(details);
  }

  const start = () => {
    void install();
    new MutationObserver(() => { void install(); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
