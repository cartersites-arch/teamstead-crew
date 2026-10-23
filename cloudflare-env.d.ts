declare namespace Cloudflare {
  interface Env {
    STRIPE_MODE?: 'test' | 'live';
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PRICE_CHAT_MONTH?: string;
    STRIPE_PRICE_CHAT_YEAR?: string;
    STRIPE_PRICE_HUB_MONTH?: string;
    STRIPE_PRICE_HUB_YEAR?: string;
    STRIPE_PRICE_COMBINED_MONTH?: string;
    STRIPE_PRICE_COMBINED_YEAR?: string;
    STRIPE_PRICE_PARTS_MONTH?: string;
    STRIPE_PRICE_PARTS_YEAR?: string;
    STRIPE_PRICE_CHAT_PARTS_MONTH?: string;
    STRIPE_PRICE_CHAT_PARTS_YEAR?: string;
    STRIPE_PRICE_HUB_PARTS_MONTH?: string;
    STRIPE_PRICE_HUB_PARTS_YEAR?: string;
    STRIPE_PRICE_COMPLETE_MONTH?: string;
    STRIPE_PRICE_COMPLETE_YEAR?: string;
    SERPAPI_API_KEY?: string;
    STRIPE_SUCCESS_URL?: string;
    STRIPE_CANCEL_URL?: string;
    BOT_RUNNER_TOKEN_HASH?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    MAINTENANCE_LINK_KEY?: string;
    BOOTSTRAP_ACCESS_HASH?: string;
    BOOTSTRAP_ACCESS_EXPIRES_AT?: string;
    WEBAUTHN_RP_ID?: string;
    WEBAUTHN_ORIGIN?: string;
    DB?: D1Database;
    CHAT_PHOTOS?: R2Bucket;
    MAINTENANCE_PHOTOS?: R2Bucket;
    ASSETS: Fetcher;
  }
}
