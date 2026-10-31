(() => {
  'use strict';
  const plans = {
    chat: { name: 'Crew Chat', price: 15, description: 'Company channels and direct messages' },
    hub: { name: 'Maintenance Hub', price: 29, description: 'Work requests, equipment and repair records' },
    parts: { name: 'Parts Finder', price: 19, description: 'Parts research and shared shopping lists' },
    combined: { name: 'Chat + Maintenance', price: 39, description: 'Conversations connected to maintenance work' },
    chat_parts: { name: 'Chat + Parts', price: 29, description: 'Conversations and shared parts research' },
    hub_parts: { name: 'Maintenance + Parts', price: 39, description: 'Repair records and parts research' },
    complete: { name: 'Complete suite', price: 49, description: 'Crew Chat, Maintenance Hub and Parts Finder' },
  };
  const radios = [...document.querySelectorAll('input[name="plan"]')];
  function selectPlan(key) {
    const selected = Object.hasOwn(plans, key) ? key : 'complete';
    const plan = plans[selected];
    radios.forEach(radio => { radio.checked = radio.value === selected; });
    document.getElementById('summary-name').textContent = plan.name;
    document.getElementById('summary-description').textContent = plan.description;
    document.getElementById('summary-price').textContent = '$' + plan.price;
    document.getElementById('summary-renewal').textContent = `After the trial, $${plan.price} USD is billed monthly unless canceled. Any applicable tax and the final terms are shown before you subscribe.`;
    const destination = new URL('https://teamstead-crew.pages.dev/signup/');
    destination.searchParams.set('plan', selected);
    document.getElementById('continue-checkout').href = destination.href;
    const page = new URL(location.href);
    page.search = '';
    page.hash = '';
    page.searchParams.set('plan', selected);
    history.replaceState(null, '', page.pathname + page.search);
  }
  radios.forEach(radio => radio.addEventListener('change', () => selectPlan(radio.value)));
  selectPlan(new URLSearchParams(location.search).get('plan'));
})();
