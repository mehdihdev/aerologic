"use strict";

const visa = require("./_lib/visa");

module.exports = function handler(req, res) {
  res.json({
    ok: true,
    service: "AeroLogic Visa API Proxy",
    passportIndexLoaded: Boolean(visa.PASSPORT_INDEX_DATA()),
    passportIndexLoadedAt: visa.PASSPORT_INDEX_LOADED_AT()
      ? new Date(visa.PASSPORT_INDEX_LOADED_AT()).toISOString()
      : null
  });
};
