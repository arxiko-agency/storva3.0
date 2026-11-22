'use strict';
// Platform-wide atomic counters (not tenant data), e.g. STORVA's own subscription invoice numbers.
const mongoose = require('mongoose');
const sequenceSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } });
sequenceSchema.statics.next = async function (key) {
  for (let i = 0; i < 3; i++) {
    try { const d = await this.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true }); return d.seq; }
    catch (e) { if (!(e && e.code === 11000)) throw e; }
  }
  throw new Error('Could not allocate a sequence number');
};
module.exports = mongoose.models.Sequence || mongoose.model('Sequence', sequenceSchema);
