import app from "./app.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`[api] Coding Buddy API listening on http://${host}:${port}`);
});
