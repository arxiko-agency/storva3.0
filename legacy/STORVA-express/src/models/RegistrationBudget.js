'use strict';
const mongoose = require('mongoose');
// Hash-keyed, durable rolling budgets apply equally to known and unknown identifiers.
const schema = new mongoose.Schema({
  _id: String,
  hits: { type: [Date], default: [] },
  purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});
module.exports = mongoose.models.RegistrationBudget || mongoose.model('RegistrationBudget', schema);