import { sendPageView, sendSubscribe } from '../server/facebookCapi';

async function main() {
  console.log(JSON.stringify({
    metaPixelPresent: Boolean(process.env.META_PIXEL_ID),
    metaTokenPresent: Boolean(process.env.META_CONVERSIONS_TOKEN),
    metaPixelTail: process.env.META_PIXEL_ID ? process.env.META_PIXEL_ID.slice(-6) : null,
  }, null, 2));

  const pageViewResult = await sendPageView({
    visitorId: 'diag_live_visitor',
    eventId: `diag_pv_${Date.now()}`,
    eventSourceUrl: 'https://mister-b.club/',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    clientIpAddress: '8.8.8.8',
    fbp: `fb.1.${Date.now()}.1234567890`,
    source: 'landing',
  });

  const subscribeResult = await sendSubscribe({
    visitorId: 'diag_live_subscriber',
    eventId: `diag_sub_${Date.now()}`,
    eventSourceUrl: 'https://mister-b.club/',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    clientIpAddress: '1.1.1.1',
    fbp: `fb.1.${Date.now()}.9876543210`,
    source: 'telegram_group_button',
    customData: {
      value: 1,
      currency: 'EUR',
      predicted_ltv: 1,
    },
  });

  console.log(JSON.stringify({ pageViewResult, subscribeResult }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
