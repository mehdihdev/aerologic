"use strict";

const { fetchVisaStatus } = require("./_lib/visa");

module.exports = async function handler(req, res) {
  const passport = (req.query.passport || "").trim().toUpperCase();
  const destination = (req.query.destination || "").trim().toUpperCase();

  if (!passport || !destination) {
    return res.status(400).json({ error: "Missing required passport/destination query params." });
  }

  try {
    const result = await fetchVisaStatus(passport, destination);
    res.json({ passport, destination, result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
};
