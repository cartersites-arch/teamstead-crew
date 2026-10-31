export function checkoutParameters(price: string, successUrl: string, cancelUrl: string) {
  return new URLSearchParams({
    ui_mode: 'hosted_page',
    mode: 'subscription',
    'subscription_data[trial_period_days]': '30',
    billing_address_collection: 'auto',
    'phone_number_collection[enabled]': 'false',
    'automatic_tax[enabled]': 'false',
    allow_promotion_codes: 'false',
    payment_method_collection: 'always',
    submit_type: 'auto',
    integration_identifier: 'hosted_web_0001',
    origin_context: 'web',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
  });
}
