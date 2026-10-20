import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { get, list, put, type Database } from "./db.ts";
import { identity, permit } from "./auth.ts";
import { audit } from "./security.ts";
import type { Config } from "./config.ts";
export const emailTemplateSchema = z
  .object({
    purpose: z.enum(["verify", "email", "reset"]),
    subject: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\r\n]+$/),
    text: z
      .string()
      .min(1)
      .max(5000)
      .refine(
        (value) => value.includes("{{url}}"),
        "本文に {{url}} を含めてください",
      ),
  })
  .strict();
export function registerEmailTemplates(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  app.get("/api/admin/email-templates", async (request) => {
    const actor = await identity(db, request, config, "admin");
    permit(actor, ["super"]);
    return list(db, "emailTemplates");
  });
  app.post("/api/admin/email-templates", async (request) =>
    db.transaction(async (q) => {
      const actor = await identity(q, request, config, "admin");
      permit(actor, ["super"]);
      const body = z
          .object({
            template: emailTemplateSchema,
            reason: z.string().min(5).max(2000),
          })
          .strict()
          .parse(request.body),
        old = await get(q, "emailTemplates", body.template.purpose);
      await put(q, "emailTemplates", body.template.purpose, body.template);
      await audit(
        q,
        actor.user.id,
        "email.template",
        body.template.purpose,
        old,
        body.template,
        body.reason,
        request.ip,
      );
      return { ok: true };
    }),
  );
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function brandedEmail(
  brand: any,
  subject: string,
  text: string,
  origin: string,
) {
  const name = escape(brand?.name ?? "まんぞうラブ");
  const color = /^#[a-f\d]{6}$/i.test(brand?.accent ?? "")
    ? brand.accent
    : "#ffd45c";
  const logo = /^\/api\/media\/[a-z\d-]+$/i.test(brand?.emailLogo ?? "")
    ? `<img src="${escape(origin + brand.emailLogo)}" alt="${name}" style="max-width:240px;height:auto;max-height:100px;object-fit:contain">`
    : name;
  const content = text
    .split(/(https?:\/\/[^\s<>]+)/g)
    .map((part) =>
      /^https?:\/\//.test(part)
        ? `<a href="${escape(part)}" style="color:${color}">${escape(part)}</a>`
        : escape(part).replace(/\n/g, "<br>"),
    )
    .join("");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><body style="background:#100816;color:#fff;font-family:sans-serif;padding:24px"><main style="max-width:560px;margin:auto;padding:24px;border:2px solid ${color};border-radius:16px"><header>${logo}</header><h1 style="font-size:22px;color:${color}">${escape(subject)}</h1><p style="line-height:1.8;overflow-wrap:anywhere">${content}</p><footer>${name}</footer></main></body></html>`;
}
