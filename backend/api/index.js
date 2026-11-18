// Express app — handles everything except the pipeline itself (that's
// api/pipeline.py, a native Python serverless function in this same
// project). Mounted as the single Node entry point via vercel.json.
const express = require("express");
const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "kuku-promo-finder backend" });
});

// Catch-all so a bad route returns clean JSON, not an HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

module.exports = app;
