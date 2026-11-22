'use strict';
// Creates a ready-to-explore demo account for local development:  node scripts/seed-demo.js
// Login: demo@storva.test / Demo1234  ·  store: /store/demo-boutique. Refuses to run with NODE_ENV=production.
require('dotenv').config();
if (process.env.NODE_ENV === 'production') { console.error('seed-demo refuses to run in production.'); process.exit(1); }
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Store = require('../src/models/Store');
const Product = require('../src/models/Product');
const Collection = require('../src/models/Collection');
const { hashPassword } = require('../src/utils/password');

const PRODUCTS = [
  ['Handwoven Jute Basket', 999, 'Home decor', ['featured', 'handmade'], 15], ['Kerala Kasavu Saree', 3499, 'Sarees', ['featured'], 6],
  ['Brass Diya Set (4)', 799, 'Festive', ['festive'], 30], ['Coconut Shell Bowl', 449, 'Kitchen', ['eco'], 40],
  ['Banana Fibre Tote', 699, 'Bags', ['eco', 'featured'], 22], ['Terracotta Planter', 549, 'Home decor', [], 12],
  ['Spice Box (Masala Dabba)', 1299, 'Kitchen', ['featured'], 9], ['Cotton Mundu', 899, 'Clothing', [], 18],
];
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  let user = await User.findOne({ email: 'demo@storva.test' });
  if (!user) user = await User.create({ name: 'Demo Owner', email: 'demo@storva.test', phone: '919000000001', passwordHash: await hashPassword('Demo1234'), emailVerified: true });
  let store = await Store.findOne({ slug: 'demo-boutique' });
  if (!store) store = await Store.create({ owner: user._id, name: 'Demo Boutique', slug: 'demo-boutique', tagline: 'Handmade goods from Kerala', description: 'Small-batch crafts made by local artisans.', whatsappNumber: '919000000001', plan: 'pro', planCycle: 'monthly', planExpiresAt: new Date(Date.now() + 30 * 864e5) });
  const col = await Collection.findOneAndUpdate({ store: store._id, slug: 'bestsellers' }, { $setOnInsert: { store: store._id, name: 'Bestsellers', slug: 'bestsellers' } }, { upsert: true, new: true });
  for (const [title, price, category, tags, stock] of PRODUCTS) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await Product.updateOne({ store: store._id, slug }, { $setOnInsert: { store: store._id, slug, title, pricePaise: price * 100, compareAtPricePaise: tags.includes('featured') ? Math.round(price * 1.25) * 100 : null, category, tags, stock, status: 'active', description: `${title}, made by hand.`, collections: tags.includes('featured') ? [col._id] : [], hsnCode: '4602', gstRate: 5 } }, { upsert: true });
  }
  console.log('Demo ready: login demo@storva.test / Demo1234 · store /store/demo-boutique');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
