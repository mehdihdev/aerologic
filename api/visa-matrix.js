"use strict";

const { fetchVisaStatus, mapWithConcurrency } = require("./_lib/visa");

module.exports = async function handler(req, res) {
  const passport = (req.query.passport || "").trim().toUpperCase();
  const destinations = (req.query.destinations || "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean)
    .filter((entry) => /^[A-Z]{2}$/.test(entry));

  if (!passport || !destinations.length) {
    return res.status(400).json({
      error: "Missing required params. Use ?passport=US&destinations=DE,FR,BR"
    });
  }

  try {
    const pairs = await mapWithConcurrency(destinations, async (destinationCode) => {
      try {
        const result = await fetchVisaStatus(passport, destinationCode);
        return [destinationCode, result];
      } catch (error) {
        return [
          destinationCode,
          {
            status: "visa-required",
            visa: "Visa Required",
            durationDays: null,
            sourceCode: "ERR",
            sourceUpdatedAt: null,
            error: error.message
          }
        ];
      }
    });

    res.json({
      passport,
      matrix: Object.fromEntries(pairs)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
};
