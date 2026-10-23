(() => {
  const host = location.hostname;
  const onHub = host === 'pms-company-hub.pages.dev';
  const onParts = !onHub && location.pathname.startsWith('/parts');
  const current = onHub ? 'hub' : onParts ? 'parts' : 'chat';

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

  function install() {
    hideDuplicateChatLinks();
    if (!signedInChat() || document.getElementById('teamstead-app-switcher')) return;
    const links = destinations();
    const details = document.createElement('details');
    details.id = 'teamstead-app-switcher';
    details.className = 'teamstead-app-switcher';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', 'Open Teamstead Apps menu');
    summary.textContent = 'Teamstead Apps';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Teamstead apps');
    nav.append(
      makeItem('chat', 'Chat', links.chat),
      makeItem('hub', 'Maintenance Hub', links.hub),
      makeItem('parts', 'Parts Finder', links.parts),
    );
    details.append(summary, nav);
    document.body.append(details);
  }

  const start = () => {
    install();
    new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
