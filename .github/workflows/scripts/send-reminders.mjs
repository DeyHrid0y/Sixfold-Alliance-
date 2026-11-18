// Sixfold Alliance — মাসিক চাঁদার স্বয়ংক্রিয় ইমেইল স্মরণ
// GitHub Actions চালায় (প্রতি মাসের ১, ৫, ৮, ৯ তারিখ)। কোনো npm প্যাকেজ লাগে না (Node 18+)।
// লগে কোনো নাম/ইমেইল ছাপা হয় না (repo public হলেও নিরাপদ) — শুধু সংখ্যা।
import crypto from "node:crypto";

const env = process.env;
const SA = JSON.parse(env.FIREBASE_SA || "{}");
const DRY = env.DRY === "true";
const FS_BASE = env.FIRESTORE_BASE || "https://firestore.googleapis.com";
const MAIL_URL = env.EMAILJS_URL || "https://api.emailjs.com/api/v1.0/email/send";
const need = (v, n) => { if (!v) { console.error("Missing: " + n); process.exit(1); } };
need(SA.private_key && SA.client_email && SA.project_id, "FIREBASE_SA (service account JSON)");
if (!DRY) { need(env.EMAILJS_PRIVATE_KEY, "EMAILJS_PRIVATE_KEY"); need(env.EMAILJS_SERVICE, "EMAILJS_SERVICE"); need(env.EMAILJS_TEMPLATE, "EMAILJS_TEMPLATE"); need(env.EMAILJS_PUBLIC_KEY, "EMAILJS_PUBLIC_KEY"); }

const b64u = (b) => Buffer.from(b).toString("base64url");
async function token() {
  const now = Math.floor(Date.now() / 1000), aud = SA.token_uri || "https://oauth2.googleapis.com/token";
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/datastore", aud, iat: now, exp: now + 3000 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(head + "." + claim), SA.private_key).toString("base64url");
  const r = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + claim + "." + sig });
  const j = await r.json();
  if (!r.ok) throw new Error("Google login failed: " + (j.error_description || j.error));
  return j.access_token;
}
async function list(tok, col) {
  const out = []; let pt = "";
  do {
    const r = await fetch(`${FS_BASE}/v1/projects/${SA.project_id}/databases/(default)/documents/${col}?pageSize=300${pt ? "&pageToken=" + pt : ""}`, { headers: { Authorization: "Bearer " + tok } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Read ${col} failed: ` + (j.error && j.error.message));
    for (const d of j.documents || []) {
      const o = { _id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields || {})) o[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? null;
      out.push(o);
    }
    pt = j.nextPageToken || "";
  } while (pt);
  return out;
}

const month = env.MONTH || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const tok = await token();
const [members, contribs, users] = await Promise.all([list(tok, "members"), list(tok, "contributions"), list(tok, "users")]);
const paid = new Set(contribs.filter((c) => c.month === month && (c.status === "verified" || c.status === "pending")).map((c) => c.memberId));
const email = Object.fromEntries(users.map((u) => [u.memberId, u.email]));
const due = members.filter((m) => m.status === "active" && !paid.has(m.memberId));
console.log(`Month ${month}: active=${members.filter((m) => m.status === "active").length}, unpaid=${due.length}${DRY ? " (dry run — no emails sent)" : ""}`);

let ok = 0, bad = 0, noMail = 0;
if (!DRY) {
  for (const m of due) {
    const to = email[m.memberId];
    if (!to) { noMail++; continue; }
    const r = await fetch(MAIL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE, template_id: env.EMAILJS_TEMPLATE, user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to, to_name: m.nameBn || m.nameEn || "", member_id: m.memberId, month, amount: "100" } }) });
    if (r.ok) ok++; else { bad++; console.error("EmailJS error " + r.status + ": " + (await r.text()).slice(0, 120)); }
    await new Promise((s) => setTimeout(s, 700));
  }
  console.log(`Sent=${ok}, failed=${bad}, no-email=${noMail}`);
}
if (bad) process.exit(1);
