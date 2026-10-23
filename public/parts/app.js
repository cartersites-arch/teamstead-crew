(() => {
const viewTitles = {
  search: "Find a part",
  results: "Internet prices",
  suppliers: "Stores",
  shopping: "Shopping list",
};

const STORAGE_KEY = "parts-search-helper:last-search";
const QUOTE_STORAGE_KEY = "parts-search-helper:price-quotes";
const SHOPPING_STORAGE_KEY = "parts-search-helper:shopping-list";
const STORE_STORAGE_KEY = "parts-search-helper:nearby-stores";
const APPEARANCE_KEY = "pms-appearance-v1";
const devicePrefersDark = window.matchMedia("(prefers-color-scheme: dark)");
function savedTheme() {
  let preference = "device";
  try { preference = localStorage.getItem(APPEARANCE_KEY) || "device"; } catch {}
  if (preference === "light" || preference === "dark") return preference;
  return devicePrefersDark.matches ? "dark" : "light";
}
let results = [];
const state = { theme: savedTheme(), hasSearched: false, location: null, activeSearch: null, quotes: [], shopping: [], nearbyStores: [], storeAreaLabel: "", storesLoading: false, storeError: "", storeRequestId: 0, pricesLoading: false, priceError: "", priceRequestId: 0, stockChecks: new Map(), stockLoading: new Set() };
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function teamsteadApi(path, params = new URLSearchParams()) {
  const url = new URL(path, window.location.origin);
  const company = new URLSearchParams(window.location.search).get("company");
  if (company) url.searchParams.set("company", company);
  params.forEach((value, key) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}

function partsApi(endpoint, params = new URLSearchParams()) {
  return teamsteadApi(`/api/parts-${endpoint}`, params);
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
}

async function loadCompanyBranding() {
  try {
    const response = await fetch(teamsteadApi("/api/branding"), { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const brand = await response.json();
    const name = String(brand.companyName || "Teamstead Crew");
    qs("#company-brand-name").textContent = name.toUpperCase();
    qs("#company-workspace-name").textContent = name;
    qs("#company-badge").textContent = name;
    qs("#viewer-avatar").textContent = initials(brand.viewerName);
    document.title = `${name} Parts Finder`;
    if (brand.hasLogo && brand.logoUrl) {
      const logo = qs("#company-logo");
      logo.src = brand.logoUrl;
      logo.alt = `${name} logo`;
      logo.hidden = false;
      qs("#company-logo-fallback").hidden = true;
    }
  } catch { /* Keep the Teamstead fallback branding if this optional request is interrupted. */ }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function showView(name, focus = true) {
  if (!viewTitles[name]) return;
  if (!state.hasSearched && (name === "results" || name === "suppliers")) {
    showToast("Find a part first, then internet prices and stores will appear here");
    name = "search";
  }
  qsa('[data-view-panel]').forEach(panel => panel.classList.toggle("is-active", panel.dataset.viewPanel === name));
  qsa('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  qs("#view-title").textContent = viewTitles[name];
  history.replaceState(null, "", `#${name}`);
  if (focus) window.scrollTo({ top: 0, behavior: "smooth" });
}

function statusClass(status) {
  return `status status-${status}`;
}

function getNearbyStoresUrl() {
  const area = state.location
    ? `${state.location.latitude.toFixed(5)},${state.location.longitude.toFixed(5)}`
    : state.activeSearch?.zip && state.activeSearch.zip !== "your area"
      ? state.activeSearch.zip
      : "";
  const query = area ? `auto parts stores near ${area}` : "auto parts stores near me";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getOnlinePricesUrl(search) {
  const machine = [search.make, search.model].filter(Boolean).join(" ");
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(`"${search.query}" ${machine}`.trim())}`;
}

function renderResults() {
  const stack = qs("#result-stack");
  if (state.pricesLoading) {
    stack.innerHTML = `<article class="result-card result-message-card is-best"><div><span class="best-badge">SEARCHING</span><h3>Looking for current prices…</h3><p class="part-label">This normally takes a few seconds.</p></div><div class="price-loader" aria-hidden="true"></div></article>`;
    return;
  }
  if (state.priceError) {
    const fallback = state.activeSearch ? getOnlinePricesUrl(state.activeSearch) : "https://www.google.com/search?tbm=shop";
    stack.innerHTML = `<article class="result-card result-message-card"><div><span class="status status-needs">TRY AGAIN</span><h3>Live prices are not available right now</h3><p class="part-label">${escapeHTML(state.priceError)}</p></div><div class="result-actions"><button class="primary-button" type="button" data-retry-prices>Try again</button><a class="secondary-button" href="${fallback}" target="_blank" rel="noopener">Open Google Shopping</a></div></article>`;
    return;
  }
  if (!results.length) {
    stack.innerHTML = `<article class="result-card result-message-card"><div><h3>No priced listings were found</h3><p class="part-label">Try a part number, brand, or a more specific description.</p></div>${state.activeSearch ? `<a class="secondary-button" href="${getOnlinePricesUrl(state.activeSearch)}" target="_blank" rel="noopener">Open Google Shopping</a>` : ""}</article>`;
    return;
  }
  stack.innerHTML = results.map((item, index) => {
    const listing = safeListingUrl(item.link);
    const rating = item.rating ? `${item.rating.toFixed(1)} stars${item.reviews ? ` · ${item.reviews.toLocaleString()} reviews` : ""}` : "Seller listing";
    const stockKey = getStockKey(item);
    const stock = stockKey ? state.stockChecks.get(stockKey) : null;
    const stockLoading = stockKey ? state.stockLoading.has(stockKey) : false;
    return `
      <article class="result-card${index === 0 ? " is-best" : ""}">
        <div>
          <header>
            ${index === 0 ? '<span class="best-badge">FIRST RESULT</span>' : ""}
            <span class="status status-listed">LIVE PRICE</span>
            <h3>${escapeHTML(item.title)}</h3>
            <span class="part-label">Sold by ${escapeHTML(item.seller)}</span>
          </header>
          <div class="result-meta">
            <span>${icon("search")} ${escapeHTML(rating)}</span>
            <span>${icon("clock")} ${escapeHTML(item.delivery)}</span>
          </div>
        </div>
        <div class="result-price">
          <div><strong>${formatMoney(item.price)}</strong><small>${escapeHTML(item.delivery)}</small></div>
          <div class="result-actions">
            <button class="primary-button" type="button" data-live-price-index="${index}">Add to List</button>${stockKey ? `<button class="secondary-button" type="button" data-stock-index="${index}"${stockLoading ? " disabled" : ""}>${stockLoading ? "Checking…" : "Check Online Stock"}</button>` : ""}${listing ? `<a class="secondary-button" href="${listing}" target="_blank" rel="noopener">View listing</a>` : ""}
          </div>
        </div>
        ${stockPanelHTML(stock, stockLoading)}
      </article>`;
  }).join("");
}

function quoteKey(query) {
  return String(query || "").trim().toLowerCase();
}

function readQuoteBook() {
  try {
    const saved = JSON.parse(localStorage.getItem(QUOTE_STORAGE_KEY));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveQuotes() {
  if (!state.activeSearch) return;
  try {
    const book = readQuoteBook();
    book[quoteKey(state.activeSearch.query)] = state.quotes;
    localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(book));
  } catch {
    showToast("This browser could not save the prices");
  }
}

function safeListingUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safePhoneUrl(value) {
  const phone = String(value || "").replace(/[^\d+]/g, "");
  return phone.length >= 7 ? `tel:${phone}` : "";
}

function getStockKey(item) {
  return String(item?.pageToken || item?.productId || "");
}

function normalizeStockData(stock) {
  if (!stock || typeof stock !== "object") return null;
  const offers = Array.isArray(stock.offers) ? stock.offers.slice(0, 8).map((offer, index) => ({
    id: String(offer?.id || index),
    seller: String(offer?.seller || "Online seller"),
    title: String(offer?.title || "Product offer"),
    price: offer?.price !== null && offer?.price !== "" && Number.isFinite(Number(offer?.price)) ? Number(offer.price) : null,
    priceText: String(offer?.priceText || ""),
    status: String(offer?.status || "Stock not reported"),
    details: Array.isArray(offer?.details) ? offer.details.map(value => String(value)).slice(0, 6) : [],
    link: safeListingUrl(offer?.link),
  })) : [];
  return {
    title: String(stock.title || "Product"),
    summary: String(stock.summary || "Online stock was not confirmed"),
    offers,
    checkedAt: String(stock.checkedAt || new Date().toISOString()),
    error: String(stock.error || ""),
  };
}

function stockPanelHTML(stock, loading = false) {
  if (loading) return '<div class="stock-panel is-loading"><div class="price-loader" aria-hidden="true"></div><strong>Checking seller stock…</strong></div>';
  if (!stock) return "";
  if (stock.error) return `<div class="stock-panel is-error"><strong>Stock could not be confirmed</strong><span>${escapeHTML(stock.error)}</span></div>`;
  const checked = Number.isNaN(Date.parse(stock.checkedAt)) ? "just now" : new Date(stock.checkedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  const offers = stock.offers.length ? stock.offers.slice(0, 4).map(offer => {
    const price = offer.price != null ? formatMoney(offer.price) : offer.priceText;
    return `<div class="stock-offer"><div><strong>${escapeHTML(offer.seller)}</strong><span>${escapeHTML(offer.status)}</span></div><div>${price ? `<b>${escapeHTML(price)}</b>` : ""}${offer.link ? `<a href="${offer.link}" target="_blank" rel="noopener">Open seller</a>` : ""}</div></div>`;
  }).join("") : '<p>No seller supplied a stock status for this product.</p>';
  return `<div class="stock-panel"><header><div><span class="stock-kicker">ONLINE STOCK</span><strong>${escapeHTML(stock.summary)}</strong></div><small>Checked ${escapeHTML(checked)}</small></header>${offers}<p class="stock-note">Seller-reported status can change. Open the seller before buying.</p></div>`;
}

async function requestOnlineStock(item) {
  const params = new URLSearchParams();
  if (item?.pageToken) params.set("page_token", item.pageToken);
  else if (item?.productId) params.set("product_id", item.productId);
  else throw new Error("Stock information is not available for this listing.");
  const response = await fetch(partsApi("stock", params), { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The stock check did not finish.");
  return normalizeStockData(data);
}

async function checkResultStock(index) {
  const item = results[index];
  const key = getStockKey(item);
  if (!item || !key || state.stockLoading.has(key)) return;
  state.stockLoading.add(key);
  renderResults();
  try {
    state.stockChecks.set(key, await requestOnlineStock(item));
  } catch (error) {
    state.stockChecks.set(key, normalizeStockData({ error: error instanceof Error ? error.message : "Please try again." }));
  } finally {
    state.stockLoading.delete(key);
    renderResults();
  }
}

async function checkShoppingStock(index) {
  const item = state.shopping[index];
  const key = getStockKey(item);
  if (!item || !key || state.stockLoading.has(key)) return;
  state.stockLoading.add(key);
  renderShoppingList();
  try {
    item.stock = await requestOnlineStock(item);
  } catch (error) {
    item.stock = normalizeStockData({ error: error instanceof Error ? error.message : "Please try again." });
  } finally {
    state.stockLoading.delete(key);
    saveShoppingList();
    renderShoppingList();
  }
}

function normalizeNearbyStore(store) {
  const title = String(store?.title || "").trim();
  if (!title) return null;
  return {
    id: String(store.id || title),
    title,
    type: String(store.type || "Parts store"),
    address: String(store.address || "Address not shown"),
    phone: String(store.phone || ""),
    rating: Number.isFinite(Number(store.rating)) ? Number(store.rating) : null,
    reviews: Number.isFinite(Number(store.reviews)) ? Number(store.reviews) : null,
    openState: String(store.openState || "Hours not shown"),
    directions: safeListingUrl(store.directions),
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function createItemId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeShoppingItem(item) {
  const price = Number(item?.price);
  const shipping = Number(item?.shipping);
  const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(shipping) || shipping < 0) return null;
  return {
    id: String(item.id || createItemId()),
    part: String(item.part || "Part"),
    equipment: String(item.equipment || ""),
    seller: String(item.seller || "Seller not added"),
    location: String(item.location || ""),
    price,
    shipping,
    quantity,
    url: safeListingUrl(item.url),
    productId: String(item.productId || "").slice(0, 80),
    pageToken: String(item.pageToken || "").slice(0, 5000),
    stock: normalizeStockData(item.stock),
    notes: String(item.notes || ""),
    fitConfirmed: Boolean(item.fitConfirmed),
    bought: Boolean(item.bought),
    addedAt: String(item.addedAt || new Date().toISOString()),
  };
}

function loadShoppingList() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOPPING_STORAGE_KEY));
    state.shopping = Array.isArray(saved) ? saved.map(normalizeShoppingItem).filter(Boolean) : [];
  } catch {
    state.shopping = [];
  }
  renderShoppingList();
}

function saveShoppingList() {
  try {
    localStorage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(state.shopping));
  } catch {
    showToast("This browser could not save the shopping list");
  }
}

function saveNearbyStores() {
  try {
    localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify({ stores: state.nearbyStores, areaLabel: state.storeAreaLabel, savedAt: new Date().toISOString() }));
  } catch {
    showToast("This browser could not save nearby stores");
  }
}

function loadNearbyStores() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_STORAGE_KEY));
    state.nearbyStores = Array.isArray(saved?.stores) ? saved.stores.map(normalizeNearbyStore).filter(Boolean) : [];
    state.storeAreaLabel = String(saved?.areaLabel || "");
  } catch {
    state.nearbyStores = [];
    state.storeAreaLabel = "";
  }
  renderNearbyStores();
}

function nearbyStoreCard(store) {
  const directions = safeListingUrl(store.directions);
  const phone = safePhoneUrl(store.phone);
  const rating = store.rating ? `${store.rating.toFixed(1)} stars${store.reviews ? ` · ${store.reviews.toLocaleString()} reviews` : ""}` : store.type;
  return `
    <article class="nearby-store-card">
      <div class="nearby-store-copy"><span class="store-number">${icon("pin")}</span><div><h4>${escapeHTML(store.title)}</h4><p>${escapeHTML(store.address)}</p><small>${escapeHTML(rating)} · ${escapeHTML(store.openState)}</small>${store.phone ? `<small>${escapeHTML(store.phone)}</small>` : ""}</div></div>
      <div class="nearby-store-actions">${directions ? `<a class="primary-button" href="${directions}" target="_blank" rel="noopener">Directions</a>` : ""}${phone ? `<a class="secondary-button" href="${phone}">Call</a>` : ""}</div>
    </article>`;
}

function renderNearbyStores() {
  const lists = [qs("#nearby-store-list"), qs("#shopping-nearby-store-list")].filter(Boolean);
  const statuses = [qs("#nearby-store-status"), qs("#shopping-store-status")].filter(Boolean);
  if (state.storesLoading) {
    statuses.forEach(status => { status.textContent = "Looking for stores near you…"; });
    lists.forEach(list => { list.innerHTML = '<article class="nearby-store-message"><div class="price-loader" aria-hidden="true"></div><strong>Finding nearby parts stores…</strong></article>'; });
    return;
  }
  if (state.storeError) {
    statuses.forEach(status => { status.textContent = state.storeError; });
    lists.forEach(list => { list.innerHTML = `<article class="nearby-store-message"><strong>Location needed</strong><span>${escapeHTML(state.storeError)}</span></article>`; });
    return;
  }
  if (!state.nearbyStores.length) {
    statuses.forEach(status => { status.textContent = "Use your current location or enter a ZIP code to add nearby stores."; });
    lists.forEach(list => { list.innerHTML = '<article class="nearby-store-message"><strong>No nearby stores saved yet</strong><span>Choose a location, then press Find Nearby Stores.</span></article>'; });
    return;
  }
  const label = `${state.nearbyStores.length} stores near ${state.storeAreaLabel || "your search area"}`;
  statuses.forEach(status => { status.textContent = `${label}. Call ahead to confirm the exact part.`; });
  const cards = state.nearbyStores.map(nearbyStoreCard).join("");
  lists.forEach(list => { list.innerHTML = cards; });
}

function getStoreSearchParams() {
  const params = new URLSearchParams();
  if (state.location) {
    params.set("lat", state.location.latitude.toFixed(6));
    params.set("lon", state.location.longitude.toFixed(6));
    return params;
  }
  const activeZip = state.activeSearch?.zip;
  const zip = activeZip && activeZip !== "your area" ? activeZip : qs("#zip-code")?.value.trim();
  if (/^\d{5}$/.test(zip || "")) params.set("zip", zip);
  return params;
}

async function fetchNearbyStores() {
  const params = getStoreSearchParams();
  if (![...params.keys()].length) {
    state.storeError = "Use your current location or enter a five-digit ZIP code on the Find page.";
    state.storesLoading = false;
    renderNearbyStores();
    return;
  }
  const requestId = ++state.storeRequestId;
  state.storesLoading = true;
  state.storeError = "";
  renderNearbyStores();
  try {
    const response = await fetch(partsApi("stores", params), { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The nearby-store search did not finish.");
    if (requestId !== state.storeRequestId) return;
    state.nearbyStores = Array.isArray(data.stores) ? data.stores.map(normalizeNearbyStore).filter(Boolean) : [];
    state.storeAreaLabel = String(data.areaLabel || "your search area");
    state.storeError = state.nearbyStores.length ? "" : "No nearby parts stores were found. Try a different ZIP code.";
    saveNearbyStores();
  } catch (error) {
    if (requestId !== state.storeRequestId) return;
    state.storeError = error instanceof Error ? error.message : "Please try again.";
  } finally {
    if (requestId === state.storeRequestId) {
      state.storesLoading = false;
      renderNearbyStores();
      renderShoppingList();
    }
  }
}

function shoppingItemTotal(item) {
  return (item.price * item.quantity) + item.shipping;
}

function getDirectionsUrl(seller, location) {
  const query = [seller, location].filter(Boolean).join(" ") || "parts store";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderShoppingList() {
  const list = qs("#shopping-list");
  if (!list) return;
  const openItems = state.shopping.filter(item => !item.bought);
  const openCount = openItems.reduce((sum, item) => sum + item.quantity, 0);
  const boughtCount = state.shopping.filter(item => item.bought).reduce((sum, item) => sum + item.quantity, 0);
  const total = openItems.reduce((sum, item) => sum + shoppingItemTotal(item), 0);
  const storeKeys = new Set([
    ...state.shopping.map(item => `${item.seller.toLowerCase()}|${item.location.toLowerCase()}`),
    ...state.nearbyStores.map(store => `nearby|${store.title.toLowerCase()}|${store.address.toLowerCase()}`),
  ]);
  qs("#shopping-open-count").textContent = String(openCount);
  qs("#shopping-store-count").textContent = String(storeKeys.size);
  qs("#shopping-total").textContent = formatMoney(total);
  qs("#shopping-bought-count").textContent = String(boughtCount);
  qs("#download-shopping-list").disabled = state.shopping.length === 0 && state.nearbyStores.length === 0;

  if (!state.shopping.length) {
    list.innerHTML = `<article class="shopping-empty">${icon("cart")}<h3>Your list is empty</h3><p>Add a saved price from the Prices page.</p><button class="primary-button" type="button" data-go="search">Find a Part</button></article>`;
    return;
  }

  const groups = new Map();
  state.shopping.forEach((item, index) => {
    const key = `${item.seller.toLowerCase()}|${item.location.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { seller: item.seller, location: item.location, items: [] });
    groups.get(key).items.push({ item, index });
  });

  list.innerHTML = [...groups.values()].map(group => {
    const groupTotal = group.items.filter(({ item }) => !item.bought).reduce((sum, { item }) => sum + shoppingItemTotal(item), 0);
    const locationLabel = group.location || "Location not added";
    return `
      <section class="shopping-store-group">
        <header class="shopping-store-heading">
          <div><p class="eyebrow">STORE</p><h3>${escapeHTML(group.seller)}</h3><span>${escapeHTML(locationLabel)}</span></div>
          <div><strong>${formatMoney(groupTotal)}</strong><small>still to buy</small><a class="secondary-button" href="${getDirectionsUrl(group.seller, group.location)}" target="_blank" rel="noopener">Directions</a></div>
        </header>
        <div class="shopping-store-items">
          ${group.items.map(({ item, index }) => {
            const listing = safeListingUrl(item.url);
            return `
              <article class="shopping-item${item.bought ? " is-bought" : ""}">
                <label class="shopping-check"><input type="checkbox" data-shopping-toggle="${index}"${item.bought ? " checked" : ""}${!item.fitConfirmed && !item.bought ? " disabled" : ""}><span>${item.bought ? "Bought" : item.fitConfirmed ? "Need" : "Confirm fit"}</span></label>
                <div class="shopping-item-copy"><h4>${escapeHTML(item.part)}</h4><p>${escapeHTML(item.equipment || "Machine not specified")}</p>${item.notes ? `<small>${escapeHTML(item.notes)}</small>` : ""}<label class="fit-check"><input type="checkbox" data-shopping-fit="${index}"${item.fitConfirmed ? " checked" : ""}><span>${item.fitConfirmed ? "Fit confirmed" : "Confirm this part fits before buying"}</span></label></div>
                <label class="shopping-quantity"><span>Qty</span><input type="number" inputmode="numeric" min="1" max="99" value="${item.quantity}" data-shopping-quantity="${index}"></label>
                <div class="shopping-item-price"><strong>${formatMoney(shoppingItemTotal(item))}</strong><small>${formatMoney(item.price)} each + ${formatMoney(item.shipping)} shipping</small></div>
                <div class="shopping-item-actions">${getStockKey(item) ? `<button class="secondary-button" type="button" data-shopping-stock="${index}"${state.stockLoading.has(getStockKey(item)) ? " disabled" : ""}>${state.stockLoading.has(getStockKey(item)) ? "Checking…" : "Check Online Stock"}</button>` : ""}${listing ? `<a class="secondary-button" href="${listing}" target="_blank" rel="noopener">Listing</a>` : ""}<button class="text-button remove-shopping-item" type="button" data-shopping-remove="${index}">Remove</button></div>
                ${stockPanelHTML(item.stock, state.stockLoading.has(getStockKey(item)))}
              </article>`;
          }).join("")}
        </div>
      </section>`;
  }).join("");
}

function addQuoteToShoppingList(index) {
  const quote = state.quotes[index];
  const search = state.activeSearch;
  if (!quote || !search) return;
  const location = quote.location || (search.zip !== "your area" ? search.zip : "");
  const duplicate = state.shopping.find(item =>
    item.part.toLowerCase() === search.query.toLowerCase()
    && item.seller.toLowerCase() === quote.seller.toLowerCase()
    && item.location.toLowerCase() === location.toLowerCase()
    && item.price === quote.price
    && item.shipping === quote.shipping
  );
  if (duplicate) duplicate.quantity += 1;
  else state.shopping.push(normalizeShoppingItem({
    id: createItemId(),
    part: search.query,
    equipment: search.equipment,
    seller: quote.seller,
    location,
    price: quote.price,
    shipping: quote.shipping,
    quantity: 1,
    url: quote.url,
    notes: `${search.needed} · ${search.category}`,
    bought: false,
    addedAt: new Date().toISOString(),
  }));
  saveShoppingList();
  renderShoppingList();
  showView("shopping");
  showToast(`${search.query} added to the shopping list`);
}

function saveLivePriceToShoppingList(index, { automatic = false, navigate = true } = {}) {
  const priceResult = results[index];
  const search = state.activeSearch;
  if (!priceResult || !search) return false;
  const seller = String(priceResult.seller || "Online seller");
  const location = search.zip !== "your area" ? `Online · ${search.zip}` : "Online";
  const shipping = Number.isFinite(Number(priceResult.shipping)) ? Number(priceResult.shipping) : 0;
  const listing = safeListingUrl(priceResult.link);
  const duplicate = state.shopping.find(item =>
    (listing && safeListingUrl(item.url) === listing)
    || (item.part.toLowerCase() === String(priceResult.title).toLowerCase()
      && item.seller.toLowerCase() === seller.toLowerCase())
  );
  if (duplicate && automatic) {
    duplicate.location = location;
    duplicate.price = Number(priceResult.price);
    duplicate.shipping = shipping;
    duplicate.url = listing;
    duplicate.productId = String(priceResult.productId || "");
    duplicate.pageToken = String(priceResult.pageToken || "");
    duplicate.notes = `Best price found automatically for ${search.query} · ${priceResult.delivery || "Verify shipping"}`;
    duplicate.addedAt = new Date().toISOString();
  }
  else if (duplicate) duplicate.quantity += 1;
  else state.shopping.push(normalizeShoppingItem({
    id: createItemId(),
    part: priceResult.title,
    equipment: search.equipment,
    seller,
    location,
    price: Number(priceResult.price),
    shipping,
    quantity: 1,
    url: listing,
    productId: priceResult.productId,
    pageToken: priceResult.pageToken,
    notes: automatic ? `Best price found automatically for ${search.query} · ${priceResult.delivery || "Verify shipping"}` : `Searched for ${search.query} · ${priceResult.delivery || "Verify shipping"}`,
    bought: false,
    addedAt: new Date().toISOString(),
  }));
  saveShoppingList();
  renderShoppingList();
  if (navigate) showView("shopping");
  if (!automatic) showToast("Price added to your shopping list");
  return true;
}

function addLivePriceToShoppingList(index) {
  saveLivePriceToShoppingList(index);
}

function saveBestLivePriceAutomatically() {
  if (!results.length) return false;
  const bestIndex = results.reduce((best, item, index) => {
    const total = Number(item.price) + (Number(item.shipping) || 0);
    const bestTotal = Number(results[best].price) + (Number(results[best].shipping) || 0);
    return total < bestTotal ? index : best;
  }, 0);
  return saveLivePriceToShoppingList(bestIndex, { automatic: true, navigate: false });
}

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadShoppingList() {
  if (!state.shopping.length && !state.nearbyStores.length) return;
  const rows = [["Part", "Equipment", "Quantity", "Seller", "Location", "Price", "Shipping", "Estimated total", "Fit confirmed", "Bought", "Online stock", "Listing", "Notes"]];
  state.shopping.forEach(item => rows.push([
    item.part,
    item.equipment,
    item.quantity,
    item.seller,
    item.location,
    item.price.toFixed(2),
    item.shipping.toFixed(2),
    shoppingItemTotal(item).toFixed(2),
    item.fitConfirmed ? "Yes" : "No",
    item.bought ? "Yes" : "No",
    item.stock?.summary || "Not checked",
    item.url,
    item.notes,
  ]));
  if (state.nearbyStores.length) {
    rows.push([], ["Nearby Stores"], ["Store", "Type", "Address", "Phone", "Rating", "Reviews", "Open / hours", "Directions"]);
    state.nearbyStores.forEach(store => rows.push([
      store.title,
      store.type,
      store.address,
      store.phone,
      store.rating ?? "",
      store.reviews ?? "",
      store.openState,
      store.directions,
    ]));
  }
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.href = blobUrl;
  link.download = `parts-shopping-list-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  showToast("Shopping list backup downloaded");
}

function renderPriceQuotes() {
  const list = qs("#price-list");
  const best = qs("#best-price");
  if (!list || !best) return;
  if (!state.quotes.length) {
    list.innerHTML = '<p class="empty-prices">No prices saved for this part yet.</p>';
    best.innerHTML = "<span>Lowest total</span><strong>—</strong><small>Add a price below</small>";
    return;
  }

  const totals = state.quotes.map(quote => quote.price + quote.shipping);
  const lowest = Math.min(...totals);
  const lowestIndex = totals.indexOf(lowest);
  best.innerHTML = `<span>Lowest total</span><strong>${formatMoney(lowest)}</strong><small>${escapeHTML(state.quotes[lowestIndex].seller)}</small>`;
  list.innerHTML = state.quotes.map((quote, index) => {
    const total = quote.price + quote.shipping;
    const listing = safeListingUrl(quote.url);
    const location = escapeHTML(quote.location || "Location not added");
    return `
      <article class="price-row${index === lowestIndex ? " is-lowest" : ""}">
        <div><strong>${escapeHTML(quote.seller)}</strong><small>${location} · ${index === lowestIndex ? "Lowest saved total" : "Saved price"}</small></div>
        <dl><div><dt>Part</dt><dd>${formatMoney(quote.price)}</dd></div><div><dt>Shipping</dt><dd>${formatMoney(quote.shipping)}</dd></div><div><dt>Total</dt><dd>${formatMoney(total)}</dd></div></dl>
        <div class="price-row-actions"><button class="primary-button add-price-to-list" type="button" data-price-index="${index}">Add to Shopping List</button>${listing ? `<a class="secondary-button" href="${listing}" target="_blank" rel="noopener">View listing</a>` : ""}<button class="text-button remove-price" type="button" data-price-index="${index}">Remove</button></div>
      </article>`;
  }).join("");
}

function loadQuotesForSearch() {
  const book = readQuoteBook();
  const saved = book[quoteKey(state.activeSearch?.query)];
  state.quotes = Array.isArray(saved) ? saved.filter(quote => Number.isFinite(quote.price) && Number.isFinite(quote.shipping)).map(quote => ({ ...quote, location: String(quote.location || "") })) : [];
  renderPriceQuotes();
}

function readSearchDetails() {
  const query = qs("#part-query").value.trim();
  const type = qs("#equipment-type").value;
  const year = qs("#equipment-year").value.trim();
  const make = qs("#equipment-make").value.trim();
  const model = qs("#equipment-model").value.trim();
  const zip = qs("#zip-code").value.trim() || "your area";
  const radius = qs("#radius").value;
  const needed = qs("#needed").value;
  const category = qs("#category").value;
  const vehicle = [year, make].filter(Boolean).join(" ") || type || "";
  const equipment = [vehicle, model].filter(Boolean).join(" · ");
  const locationLabel = state.location ? "your current location" : zip;
  return { query, type, year, make, model, zip, radius, needed, category, vehicle, equipment, locationLabel };
}

function saveSearch(search) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      query: search.query,
      type: search.type,
      year: search.year,
      make: search.make,
      model: search.model,
      zip: search.zip === "your area" ? "" : search.zip,
      radius: search.radius,
      needed: search.needed,
      category: search.category,
    }));
  } catch {
    showToast("This browser could not save the search");
  }
}

function restoreSavedSearch() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.query) return false;
    const fields = {
      "#part-query": saved.query,
      "#equipment-type": saved.type === "Truck / vehicle" && !saved.year && !saved.make && !saved.model ? "" : saved.type,
      "#equipment-year": saved.year,
      "#equipment-make": saved.make,
      "#equipment-model": saved.model,
      "#zip-code": saved.zip,
      "#radius": saved.radius,
      "#needed": saved.needed,
      "#category": saved.category,
    };
    Object.entries(fields).forEach(([selector, value]) => {
      if (value != null && qs(selector)) qs(selector).value = value;
    });
    applySearchDetails(readSearchDetails(), { persist: false });
    state.priceError = "Press Try again to refresh prices for this saved search.";
    renderResults();
    qs("#match-title").textContent = "Saved search ready";
    qs("#match-copy").textContent = "Press Try again to refresh internet prices. The saved search has not been checked yet.";
    qs("#match-confidence").textContent = "Not refreshed";
    qs("#query-help").textContent = "Your last search was restored on this device.";
    return true;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function clearSavedSearch() {
  localStorage.removeItem(STORAGE_KEY);
  qs("#search-form").reset();
  state.location = null;
  state.activeSearch = null;
  state.hasSearched = false;
  state.pricesLoading = false;
  state.priceError = "";
  state.priceRequestId += 1;
  results = [];
  qs("#query-help").textContent = "Example: red hose, 6205 bearing, or 52014734AB";
  qs("#location-status").textContent = "Location helps find nearby stores.";
  qs("#location-status").className = "";
  qs("#use-location").querySelector("span").textContent = "Use my current location";
  renderResults();
  loadQuotesForSearch();
  updateNavigationState();
  showView("search");
  qs("#part-query").focus();
}

async function fetchLivePrices(search) {
  const requestId = ++state.priceRequestId;
  const searchTerms = [search.query, search.year, search.make, search.model].filter(Boolean).join(" ").trim();
  const params = new URLSearchParams({ q: searchTerms });
  if (/^\d{5}$/.test(search.zip)) params.set("location", search.zip);
  state.pricesLoading = true;
  state.priceError = "";
  results = [];
  renderResults();

  try {
    const response = await fetch(partsApi("prices", params), { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The live price search did not finish.");
    if (requestId !== state.priceRequestId) return;
    results = Array.isArray(data.prices) ? data.prices : [];
    const savedBestPrice = saveBestLivePriceAutomatically();
    qs("#match-title").textContent = results.length ? `${results.length} live prices found` : "No priced listings found";
    qs("#match-copy").textContent = savedBestPrice ? "The lowest current total was saved to your shopping list automatically. Add another option only if you want it." : "Try a part number, brand, or more specific description.";
    qs("#match-confidence").textContent = data.cached ? "Recent results" : "Live · free test";
  } catch (error) {
    if (requestId !== state.priceRequestId) return;
    state.priceError = error instanceof Error ? error.message : "Please try again.";
    qs("#match-title").textContent = "Live price search paused";
    qs("#match-copy").textContent = "You can retry or open Google Shopping without losing your search.";
    qs("#match-confidence").textContent = "No charge";
  } finally {
    if (requestId === state.priceRequestId) {
      state.pricesLoading = false;
      renderResults();
    }
  }
}

function applySearchDetails(search, { persist = true } = {}) {
  state.hasSearched = true;
  state.activeSearch = search;
  results = [];
  state.pricesLoading = false;
  state.priceError = "";

  qs("#results-title").textContent = `Internet prices for “${search.query}”`;
  qs("#results-summary").replaceChildren();
  const query = document.createElement("strong");
  query.textContent = search.query;
  qs("#results-summary").append(query);
  if (search.equipment) qs("#results-summary").append(document.createTextNode(` · ${search.equipment}`));
  qs("#fitment-vehicle").textContent = search.vehicle || "Not specified";
  qs("#fitment-engine").textContent = search.model || "Not specified";
  qs("#fitment-part").textContent = search.query;

  qs("#match-title").textContent = "Live internet prices";
  qs("#match-copy").textContent = "Searching the web for current listings and sellers.";
  qs("#match-confidence").textContent = "Free test service";

  qs("#store-area-title").textContent = `Parts stores near ${search.locationLabel}`;
  qs("#nearby-stores-link").href = getNearbyStoresUrl();
  qs("#price-form").reset();
  if (search.zip !== "your area") qs("#quote-location").value = search.zip;
  renderResults();
  loadQuotesForSearch();
  updateNavigationState();
  if (persist) saveSearch(search);
}

function updateNavigationState() {
  qsa('[data-view="results"], [data-view="suppliers"]').forEach(button => {
    button.disabled = !state.hasSearched;
    button.title = state.hasSearched ? "" : "Find a part first";
  });
}

document.documentElement.dataset.theme = state.theme;
renderResults();
updateNavigationState();

qsa('[data-view]').forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));

qs("#theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem(APPEARANCE_KEY, state.theme); } catch {}
});

devicePrefersDark.addEventListener("change", () => {
  let preference = "device";
  try { preference = localStorage.getItem(APPEARANCE_KEY) || "device"; } catch {}
  if (preference !== "device") return;
  state.theme = devicePrefersDark.matches ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
});

qs("#part-query").addEventListener("input", () => {
  qs("#query-help").textContent = "Example: red hose, 6205 bearing, or 52014734AB";
  qs("#query-help").classList.remove("is-error");
});

qsa('[data-example]').forEach(button => button.addEventListener("click", () => {
  qs("#part-query").value = button.dataset.example;
  qs("#query-help").textContent = "Example added. Change it if you need to.";
  qs("#query-help").classList.remove("is-error");
  qs("#part-query").focus();
}));

qs("#use-location").addEventListener("click", () => {
  const button = qs("#use-location");
  const status = qs("#location-status");
  if (!navigator.geolocation) {
    status.textContent = "This device does not provide its location. Type a ZIP code instead.";
    status.className = "is-error";
    return;
  }

  button.disabled = true;
  button.querySelector("span").textContent = "Getting your location…";
  status.textContent = "Your device will ask for permission.";
  status.className = "";

  navigator.geolocation.getCurrentPosition(position => {
    state.location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    qs("#zip-code").value = "";
    button.disabled = false;
    button.querySelector("span").textContent = "Location added";
    status.textContent = "Ready to find stores near you.";
    status.className = "is-ready";
    if (state.hasSearched && state.activeSearch) {
      state.activeSearch.locationLabel = "your current location";
      qs("#store-area-title").textContent = "Parts stores near your current location";
      qs("#nearby-stores-link").href = getNearbyStoresUrl();
      qs("#results-title").textContent = `Internet prices for “${state.activeSearch.query}”`;
      renderResults();
    }
    showToast("Location added");
    void fetchNearbyStores();
  }, error => {
    button.disabled = false;
    button.querySelector("span").textContent = "Use my current location";
    status.textContent = error.code === 1 ? "Location permission was not allowed. Type a ZIP code instead." : "We could not get your location. Type a ZIP code instead.";
    status.className = "is-error";
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
});

qs("#zip-code").addEventListener("input", event => {
  if (!event.target.value) return;
  state.location = null;
  state.storeError = "";
  qs("#use-location").querySelector("span").textContent = "Use my current location";
  qs("#location-status").textContent = "Using your ZIP code.";
  qs("#location-status").className = "is-ready";
});

qs("#search-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!qs("#part-query").value.trim()) {
    qs("#query-help").textContent = "Type a part name or number to continue.";
    qs("#query-help").classList.add("is-error");
    qs("#part-query").focus();
    showToast("Type a part name or number");
    return;
  }
  const search = readSearchDetails();
  const progress = qs("#search-progress");
  const looksLikePartNumber = !search.query.includes(" ") && /^[a-z0-9.-]+$/i.test(search.query);
  qs("#progress-label").textContent = looksLikePartNumber ? "Reading the part number" : "Reading the description";
  qsa("#search-progress li").forEach((item, index) => item.classList.toggle("is-running", index === 0));
  progress.hidden = false;
  applySearchDetails(search);
  showView("results");
  qs("#progress-label").textContent = "Checking current sellers and prices";
  qsa("#search-progress li").forEach((item, index) => item.classList.toggle("is-running", index === 1));
  const storeParams = getStoreSearchParams();
  const storePromise = [...storeParams.keys()].length ? fetchNearbyStores() : Promise.resolve();
  await Promise.all([fetchLivePrices(search), storePromise]);
  progress.hidden = true;
  if (!state.priceError) showToast(results.length ? `${results.length} prices ready` : "No priced listings found");
});

qs("#result-stack").addEventListener("click", async event => {
  const add = event.target.closest("[data-live-price-index]");
  if (add) {
    addLivePriceToShoppingList(Number(add.dataset.livePriceIndex));
    return;
  }
  const stock = event.target.closest("[data-stock-index]");
  if (stock) {
    await checkResultStock(Number(stock.dataset.stockIndex));
    return;
  }
  const retry = event.target.closest("[data-retry-prices]");
  if (retry && state.activeSearch) await fetchLivePrices(state.activeSearch);
});

document.addEventListener("click", event => {
  const navigation = event.target.closest("[data-go]");
  if (navigation) showView(navigation.dataset.go);
  const action = event.target.closest("[data-toast]");
  if (action && !action.closest("#result-stack")) showToast(action.dataset.toast);
});

qs("#price-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!state.activeSearch) return;
  const seller = qs("#quote-seller").value.trim();
  const price = Number(qs("#quote-price").value);
  const shipping = Number(qs("#quote-shipping").value || 0);
  const location = qs("#quote-location").value.trim() || (state.activeSearch.zip !== "your area" ? state.activeSearch.zip : "");
  const rawLink = qs("#quote-link").value.trim();
  const url = safeListingUrl(rawLink);
  if (!seller || !Number.isFinite(price) || price < 0 || !Number.isFinite(shipping) || shipping < 0) {
    showToast("Add a seller and a valid price");
    return;
  }
  if (rawLink && !url) {
    showToast("Use a complete http or https listing link");
    qs("#quote-link").focus();
    return;
  }
  state.quotes.push({ seller, price, shipping, location, url });
  saveQuotes();
  renderPriceQuotes();
  event.currentTarget.reset();
  if (state.activeSearch.zip !== "your area") qs("#quote-location").value = state.activeSearch.zip;
  showToast(`Price saved from ${seller}. Add it to your list below.`);
});

qs("#price-list").addEventListener("click", event => {
  const add = event.target.closest(".add-price-to-list");
  if (add) {
    addQuoteToShoppingList(Number(add.dataset.priceIndex));
    return;
  }
  const button = event.target.closest(".remove-price");
  if (!button) return;
  state.quotes.splice(Number(button.dataset.priceIndex), 1);
  saveQuotes();
  renderPriceQuotes();
  showToast("Price removed");
});

qs("#shopping-list").addEventListener("change", event => {
  const fit = event.target.closest("[data-shopping-fit]");
  if (fit) {
    const item = state.shopping[Number(fit.dataset.shoppingFit)];
    if (!item) return;
    item.fitConfirmed = fit.checked;
    if (!item.fitConfirmed) item.bought = false;
    saveShoppingList();
    renderShoppingList();
    showToast(item.fitConfirmed ? "Fit marked confirmed" : "Fit confirmation removed");
    return;
  }
  const toggle = event.target.closest("[data-shopping-toggle]");
  if (toggle) {
    const item = state.shopping[Number(toggle.dataset.shoppingToggle)];
    if (!item) return;
    item.bought = toggle.checked;
    saveShoppingList();
    renderShoppingList();
    showToast(item.bought ? "Item marked bought" : "Item moved back to the list");
    return;
  }
  const quantity = event.target.closest("[data-shopping-quantity]");
  if (!quantity) return;
  const item = state.shopping[Number(quantity.dataset.shoppingQuantity)];
  if (!item) return;
  item.quantity = Math.max(1, Math.min(99, Math.round(Number(quantity.value) || 1)));
  saveShoppingList();
  renderShoppingList();
});

qs("#shopping-list").addEventListener("click", async event => {
  const stock = event.target.closest("[data-shopping-stock]");
  if (stock) {
    await checkShoppingStock(Number(stock.dataset.shoppingStock));
    return;
  }
  const remove = event.target.closest("[data-shopping-remove]");
  if (!remove) return;
  state.shopping.splice(Number(remove.dataset.shoppingRemove), 1);
  saveShoppingList();
  renderShoppingList();
  showToast("Item removed from shopping list");
});

qs("#download-shopping-list").addEventListener("click", downloadShoppingList);

qs("#find-nearby-stores").addEventListener("click", async () => {
  await fetchNearbyStores();
  if (!state.storeError) showToast(`${state.nearbyStores.length} nearby stores added to your list`);
});

qs("#refresh-shopping-stores").addEventListener("click", async () => {
  await fetchNearbyStores();
  if (!state.storeError) showToast("Nearby stores updated");
});

qs("#clear-search").addEventListener("click", clearSavedSearch);
const aboutDialog = qs("#about-dialog");
function openAboutDialog() {
  if (typeof aboutDialog.showModal === "function") aboutDialog.showModal();
  else aboutDialog.setAttribute("open", "");
}
function closeAboutDialog() {
  if (typeof aboutDialog.close === "function") aboutDialog.close();
  else aboutDialog.removeAttribute("open");
}
qs("#open-about").addEventListener("click", openAboutDialog);
qs("#close-about").addEventListener("click", closeAboutDialog);
qs("#about-done").addEventListener("click", closeAboutDialog);
loadNearbyStores();
loadShoppingList();
restoreSavedSearch();
void loadCompanyBranding();
const initialView = location.hash.slice(1);
showView(viewTitles[initialView] && (state.hasSearched || !["results", "suppliers"].includes(initialView)) ? initialView : "search", false);
})();
