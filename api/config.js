"use strict";

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
};
