import step1 from '@/assets/step1.jpg';
import step2 from '@/assets/step2.jpg';
import step3 from '@/assets/step3.jpg';
import step4 from '@/assets/step4.jpg';

export const steps = [
  { title: 'Set up basics', text: 'Add your store name, business details and preferences.', image: step1 },
  { title: 'Add your products', text: 'Upload photos, set prices and stock, or send them on WhatsApp.', image: step2 },
  { title: 'Choose a template', text: 'Pick a layout and preview it on desktop and mobile.', image: step3 },
  { title: 'Launch your store', text: 'Connect payments and delivery, then share your link.', image: step4 },
];
export const features = [
  ['WhatsApp-first management', 'Add products, check orders and update stock by sending a message.'],
  ['AI product creation', 'Send a photo or a few keywords and review a product draft.'],
  ['Fast store setup', 'The essentials to take your business online.'],
  ['Live store designer', 'Make your store yours with colors, fonts and layouts.'],
  ['Product & catalog management', 'Products, photos, prices, sale prices and stock in one place.'],
  ['Smooth checkout & payments', 'Cart, cash on delivery and online payments via Razorpay.'],
  ['Orders & customers', 'Keep orders, customer details and history together.'],
  ['Analytics & growth tools', 'Sales insights, visitor tracking and GST reports for your next chapter.'],
];
export const pageHead = (title: string, description: string) => ({ meta: [
  { title: `${title} · STORVA` }, { name: 'description', content: description },
  { property: 'og:title', content: `${title} · STORVA` }, { property: 'og:description', content: description },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
] });