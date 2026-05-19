import { NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";

export const runtime = "nodejs";

const CONTACT_TO =
  process.env.CONTACT_TO?.trim() || "agdemirhalim4@gmail.com";

const MAIL_FROM =
  process.env.MAIL_FROM?.trim() || "Thundrly <onboarding@resend.dev>";

const ContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(20).max(4000),
  website: z.string().max(0).optional().default(""),
});

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 5;

function rateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= MAX_REQUESTS) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Mail servisi yapılandırılmamış." },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfter ?? 600) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Geçersiz istek." },
      { status: 400 },
    );
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        ok: false,
        error: first?.message || "Form geçersiz.",
        field: first?.path?.[0],
      },
      { status: 422 },
    );
  }

  const { name, email, subject, message, website } = parsed.data;
  if (website && website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replaceAll("\n", "<br/>");

  const text = [
    `Yeni iletişim mesajı`,
    ``,
    `Ad Soyad: ${name}`,
    `E-posta: ${email}`,
    `Konu: ${subject}`,
    ``,
    `Mesaj:`,
    message,
    ``,
    `—`,
    `IP: ${ip}`,
    `UA: ${req.headers.get("user-agent") || "—"}`,
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7f8;padding:32px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e8eb;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#007ea7;font-weight:600;">Thundrly · İletişim</div>
            <h1 style="margin:8px 0 0 0;font-size:22px;color:#003249;font-weight:500;letter-spacing:-0.01em;">${safeSubject}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 4px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef1f3;font-size:12px;color:rgba(0,50,73,0.55);text-transform:uppercase;letter-spacing:0.08em;width:120px;">Ad Soyad</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef1f3;font-size:14px;color:#003249;">${safeName}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef1f3;font-size:12px;color:rgba(0,50,73,0.55);text-transform:uppercase;letter-spacing:0.08em;">E-posta</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef1f3;font-size:14px;color:#003249;"><a href="mailto:${safeEmail}" style="color:#007ea7;text-decoration:none;">${safeEmail}</a></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 32px 32px;">
            <div style="font-size:12px;color:rgba(0,50,73,0.55);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Mesaj</div>
            <div style="font-size:14px;line-height:1.65;color:#003249;white-space:pre-wrap;">${safeMessage}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f6f7f8;border-top:1px solid #eef1f3;font-size:11px;color:rgba(0,50,73,0.5);">
            thundrly.com · ${escapeHtml(ip)}
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: MAIL_FROM,
      to: CONTACT_TO,
      replyTo: email,
      subject: `[Thundrly] ${subject}`,
      text,
      html,
    });

    if (result.error) {
      return NextResponse.json(
        { ok: false, error: "Mail gönderilemedi. Lütfen daha sonra tekrar deneyin." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Beklenmeyen bir hata oluştu." },
      { status: 500 },
    );
  }
}
