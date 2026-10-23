import { env } from "cloudflare:workers";
import { currentPerson } from "./access";

const priceCache = new Map();
const storeCache = new Map();
const stockCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 40;

const contentTypes = {
  "/index.html": "text/html; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
  "/app-icon.svg": "image/svg+xml; charset=utf-8",
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders,
      ...extraHeaders,
    },
  });
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), "https://www.google.com");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parseDeliveryCost(delivery) {
  const text = String(delivery || "");
  if (/free/i.test(text)) return 0;
  const match = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1]) : 0;
}

function normalizePriceResult(item, index) {
  const price = Number(item?.extracted_price);
  if (!Number.isFinite(price) || price < 0) return null;
  const delivery = String(item?.delivery || item?.shipping || "Shipping not shown").slice(0, 120);
  return {
    id: String(item?.product_id || item?.position || index),
    productId: String(item?.product_id || "").slice(0, 80),
    pageToken: String(item?.immersive_product_page_token || "").slice(0, 5000),
    title: String(item?.title || "Part listing").slice(0, 180),
    seller: String(item?.source || item?.seller || "Online seller").slice(0, 80),
    price,
    priceText: String(item?.price || "").slice(0, 40),
    delivery,
    shipping: parseDeliveryCost(delivery),
    link: safeUrl(item?.product_link || item?.link),
    rating: Number.isFinite(Number(item?.rating)) ? Number(item.rating) : null,
    reviews: Number.isFinite(Number(item?.reviews)) ? Number(item.reviews) : null,
  };
}

async function searchPrices(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  if (!env.SERPAPI_API_KEY) return json({ error: "Live pricing is not configured yet." }, 503);

  const requestUrl = new URL(request.url);
  const query = String(requestUrl.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const location = String(requestUrl.searchParams.get("location") || "").trim();
  if (query.length < 2 || query.length > 120) return json({ error: "Enter a part name or number between 2 and 120 characters." }, 400);
  if (location && !/^\d{5}$/.test(location)) return json({ error: "Use a five-digit ZIP code." }, 400);

  const cacheKey = `${query.toLowerCase()}|${location}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return json({ ...cached.payload, cached: true });
  }

  const providerUrl = new URL("https://serpapi.com/search.json");
  providerUrl.searchParams.set("engine", "google_shopping");
  providerUrl.searchParams.set("q", query);
  providerUrl.searchParams.set("gl", "us");
  providerUrl.searchParams.set("hl", "en");
  if (location) providerUrl.searchParams.set("location", location);
  providerUrl.searchParams.set("api_key", env.SERPAPI_API_KEY);

  let providerResponse;
  try {
    providerResponse = await fetch(providerUrl, { headers: { accept: "application/json" } });
  } catch {
    return json({ error: "The pricing service could not be reached. Try again in a moment." }, 502);
  }

  let providerData;
  try {
    providerData = await providerResponse.json();
  } catch {
    return json({ error: "The pricing service returned an unreadable response." }, 502);
  }

  if (!providerResponse.ok || providerData?.error) {
    const message = String(providerData?.error || "");
    const quota = /limit|quota|searches|credits/i.test(message);
    return json({ error: quota ? "The free monthly price-search allowance has been used. Try the Google Shopping link below." : "Live prices are temporarily unavailable. Try again shortly." }, quota ? 429 : 502);
  }

  const sourceItems = Array.isArray(providerData?.shopping_results)
    ? providerData.shopping_results
    : Array.isArray(providerData?.inline_shopping_results)
      ? providerData.inline_shopping_results
      : [];
  const prices = sourceItems.map(normalizePriceResult).filter(Boolean).slice(0, 10);
  const payload = { query, prices, searchedAt: new Date().toISOString() };

  priceCache.set(cacheKey, { savedAt: Date.now(), payload });
  if (priceCache.size > MAX_CACHE_ENTRIES) priceCache.delete(priceCache.keys().next().value);
  return json(payload);
}

function getMapsLink(item) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", [item?.title, item?.address].filter(Boolean).join(" ") || "parts store");
  if (item?.place_id) url.searchParams.set("query_place_id", String(item.place_id));
  return url.href;
}

function normalizeStoreResult(item, index) {
  const title = String(item?.title || "").trim().slice(0, 120);
  if (!title) return null;
  return {
    id: String(item?.place_id || item?.data_id || item?.position || index),
    title,
    type: String(item?.type || "Parts store").slice(0, 80),
    address: String(item?.address || "Address not shown").slice(0, 180),
    phone: String(item?.phone || "").slice(0, 40),
    rating: Number.isFinite(Number(item?.rating)) ? Number(item.rating) : null,
    reviews: Number.isFinite(Number(item?.reviews)) ? Number(item.reviews) : null,
    openState: String(item?.open_state || "Hours not shown").slice(0, 100),
    directions: getMapsLink(item),
  };
}

async function searchStores(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  if (!env.SERPAPI_API_KEY) return json({ error: "Nearby-store search is not configured yet." }, 503);

  const requestUrl = new URL(request.url);
  const zip = String(requestUrl.searchParams.get("zip") || "").trim();
  const latitudeParam = requestUrl.searchParams.get("lat");
  const longitudeParam = requestUrl.searchParams.get("lon");
  const latitude = Number(latitudeParam);
  const longitude = Number(longitudeParam);
  const hasCoordinates = latitudeParam !== null && longitudeParam !== null && Number.isFinite(latitude) && Number.isFinite(longitude);
  if (zip && !/^\d{5}$/.test(zip)) return json({ error: "Use a five-digit ZIP code." }, 400);
  if (hasCoordinates && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) return json({ error: "The location coordinates are invalid." }, 400);
  if (!zip && !hasCoordinates) return json({ error: "Use your current location or enter a ZIP code first." }, 400);

  const areaKey = zip || `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = storeCache.get(areaKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return json({ ...cached.payload, cached: true });

  const providerUrl = new URL("https://serpapi.com/search.json");
  providerUrl.searchParams.set("engine", "google_maps");
  providerUrl.searchParams.set("type", "search");
  providerUrl.searchParams.set("q", zip ? `auto parts stores near ${zip}` : "auto parts stores near me");
  providerUrl.searchParams.set("hl", "en");
  providerUrl.searchParams.set("gl", "us");
  if (hasCoordinates) {
    providerUrl.searchParams.set("ll", `@${latitude.toFixed(6)},${longitude.toFixed(6)},14z`);
    providerUrl.searchParams.set("nearby", "true");
  }
  providerUrl.searchParams.set("api_key", env.SERPAPI_API_KEY);

  let providerResponse;
  try {
    providerResponse = await fetch(providerUrl, { headers: { accept: "application/json" } });
  } catch {
    return json({ error: "The nearby-store service could not be reached. Try again in a moment." }, 502);
  }

  let providerData;
  try {
    providerData = await providerResponse.json();
  } catch {
    return json({ error: "The nearby-store service returned an unreadable response." }, 502);
  }

  if (!providerResponse.ok || providerData?.error) {
    const message = String(providerData?.error || "");
    const quota = /limit|quota|searches|credits/i.test(message);
    return json({ error: quota ? "The free monthly search allowance has been used. Open Maps instead." : "Nearby stores are temporarily unavailable. Try again shortly." }, quota ? 429 : 502);
  }

  const sourceItems = Array.isArray(providerData?.local_results) ? providerData.local_results : [];
  const stores = sourceItems.map(normalizeStoreResult).filter(Boolean).slice(0, 8);
  const payload = { stores, areaLabel: zip ? `ZIP ${zip}` : "your current location", searchedAt: new Date().toISOString() };
  storeCache.set(areaKey, { savedAt: Date.now(), payload });
  if (storeCache.size > MAX_CACHE_ENTRIES) storeCache.delete(storeCache.keys().next().value);
  return json(payload);
}

function normalizeStockOffer(item, index) {
  const details = Array.isArray(item?.details_and_offers)
    ? item.details_and_offers.map(value => String(value || "").trim().slice(0, 160)).filter(Boolean).slice(0, 6)
    : [];
  const reportedStatus = details.find(value => /\b(in stock|out of stock|available|unavailable|pickup)\b/i.test(value));
  const price = Number(item?.extracted_price);
  return {
    id: String(item?.position || index),
    seller: String(item?.name || "Online seller").slice(0, 100),
    title: String(item?.title || "Product offer").slice(0, 180),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    priceText: String(item?.price || "").slice(0, 40),
    status: String(reportedStatus || "Stock not reported").slice(0, 160),
    details,
    link: safeUrl(item?.link),
  };
}

async function searchStock(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  if (!env.SERPAPI_API_KEY) return json({ error: "Online-stock checks are not configured yet." }, 503);

  const requestUrl = new URL(request.url);
  const productId = String(requestUrl.searchParams.get("product_id") || "").trim();
  const pageToken = String(requestUrl.searchParams.get("page_token") || "").trim();
  if (productId && !/^\d{5,80}$/.test(productId)) return json({ error: "This listing does not have a usable product number." }, 400);
  if (pageToken && (pageToken.length < 16 || pageToken.length > 5000 || /[\u0000-\u001f\u007f]/.test(pageToken))) return json({ error: "This listing does not have a usable stock token." }, 400);
  if (!productId && !pageToken) return json({ error: "Stock information is not available for this listing." }, 400);

  const cacheKey = pageToken || productId;
  const cached = stockCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return json({ ...cached.payload, cached: true });

  const providerUrl = new URL("https://serpapi.com/search.json");
  providerUrl.searchParams.set("engine", "google_product");
  providerUrl.searchParams.set("gl", "us");
  providerUrl.searchParams.set("hl", "en");
  if (pageToken) providerUrl.searchParams.set("page_token", pageToken);
  else {
    providerUrl.searchParams.set("product_id", productId);
    providerUrl.searchParams.set("offer_view", "true");
  }
  providerUrl.searchParams.set("api_key", env.SERPAPI_API_KEY);

  let providerResponse;
  try {
    providerResponse = await fetch(providerUrl, { headers: { accept: "application/json" } });
  } catch {
    return json({ error: "The online-stock service could not be reached. Try again in a moment." }, 502);
  }

  let providerData;
  try {
    providerData = await providerResponse.json();
  } catch {
    return json({ error: "The online-stock service returned an unreadable response." }, 502);
  }

  if (!providerResponse.ok || providerData?.error) {
    const message = String(providerData?.error || "");
    const quota = /limit|quota|searches|credits/i.test(message);
    return json({ error: quota ? "The free monthly search allowance has been used. Open the listing to check stock." : "Online stock is temporarily unavailable. Open the listing or try again shortly." }, quota ? 429 : 502);
  }

  const sourceOffers = Array.isArray(providerData?.product_results?.stores) ? providerData.product_results.stores : [];
  const offers = sourceOffers.map(normalizeStockOffer).slice(0, 8);
  const availableCount = offers.filter(offer => /\bin stock\b|\bavailable\b|\bpickup\b/i.test(offer.status) && !/\bout of stock\b|\bunavailable\b/i.test(offer.status)).length;
  const payload = {
    title: String(providerData?.product_results?.title || "Product").slice(0, 180),
    summary: availableCount ? `${availableCount} seller${availableCount === 1 ? "" : "s"} report availability` : "Online stock was not confirmed",
    offers,
    checkedAt: new Date().toISOString(),
  };
  stockCache.set(cacheKey, { savedAt: Date.now(), payload });
  if (stockCache.size > MAX_CACHE_ENTRIES) stockCache.delete(stockCache.keys().next().value);
  return json(payload);
}

async function authenticated(handler, request) {
  await currentPerson();
  return handler(request, env);
}

export function prices(request) {
  return authenticated(searchPrices, request);
}

export function stores(request) {
  return authenticated(searchStores, request);
}

export function stock(request) {
  return authenticated(searchStock, request);
}
