const { createClient } = require("@supabase/supabase-js");
const jwt    = require("jsonwebtoken");
const webpush = require("web-push");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

webpush.setVapidDetails(
  "mailto:" + (process.env.VAPID_EMAIL || "admin@teknisiapp.com"),
  process.env.VAPID_PUBLIC_KEY  || "",
  process.env.VAPID_PRIVATE_KEY || ""
);

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // GET: kembalikan VAPID public key supaya frontend bisa subscribe
  if (req.method === "GET") {
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  }

  // POST: simpan subscription baru dari browser
  if (req.method === "POST") {
    try {
      const decoded   = verifyToken(req);
      const { subscription } = req.body || {};
      if (!subscription || !subscription.endpoint)
        return res.status(400).json({ error: "Subscription tidak valid" });

      // Upsert: satu endpoint = satu baris
      const { error } = await supabase.from("push_subscriptions").upsert({
        username:     decoded.username,
        role:         decoded.role,
        endpoint:     subscription.endpoint,
        subscription: JSON.stringify(subscription),
        updated_at:   new Date().toISOString(),
      }, { onConflict: "endpoint" });

      if (error) return res.status(500).json({ error: "Gagal simpan subscription" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  // DELETE: hapus subscription saat logout
  if (req.method === "DELETE") {
    try {
      const decoded = verifyToken(req);
      const { endpoint } = req.body || {};
      if (endpoint) {
        await supabase.from("push_subscriptions")
          .delete().eq("endpoint", endpoint).eq("username", decoded.username);
      } else {
        await supabase.from("push_subscriptions")
          .delete().eq("username", decoded.username);
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};

// ── Helper: diekspor agar bisa dipakai tugas.js ───────────────────
// sendPushToUser(supabase, username, payload)
// sendPushToRole(supabase, role, payload)
async function sendPushToUser(supabase, username, payload) {
  return _sendPush(supabase, { username }, payload);
}
async function sendPushToRole(supabase, role, payload) {
  return _sendPush(supabase, { role }, payload);
}
async function _sendPush(supabase, filter, payload) {
  let query = supabase.from("push_subscriptions").select("subscription, endpoint");
  if (filter.username) query = query.eq("username", filter.username);
  if (filter.role)     query = query.eq("role", filter.role);

  const { data } = await query;
  if (!data || data.length === 0) return;

  const payloadStr = JSON.stringify(payload);
  const dead = [];

  await Promise.allSettled(
    data.map(async row => {
      try {
        const sub = typeof row.subscription === "string"
          ? JSON.parse(row.subscription)
          : row.subscription;
        await webpush.sendNotification(sub, payloadStr);
      } catch (err) {
        // 410 Gone / 404 Not Found = subscription sudah tidak valid
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.endpoint);
        }
      }
    })
  );

  // Hapus subscription mati
  if (dead.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", dead);
  }
}

module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToRole = sendPushToRole;
