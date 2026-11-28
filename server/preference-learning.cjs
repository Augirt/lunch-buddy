const engine = require('./recommend-core.cjs')(require('../data.js'));
module.exports = {
  validateEvents: engine.normalizeEvents,
  learnPreferences: (events, dateKey, enabled = true) => engine.learnPreferences(
    engine.normalizeEvents(events, dateKey), dateKey, enabled),
};
