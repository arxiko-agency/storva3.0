import { describe, expect, it } from "vitest";
import { shareLinks, taggedUrl } from "./share-rules";

describe("shop share kit", () => {
  const url = "https://storva.example/shop/kerala-spices";
  it("tags every shared link with its source for analytics", () => {
    expect(taggedUrl(url, "qr")).toBe("https://storva.example/shop/kerala-spices?utm_source=qr");
    const l = shareLinks(url, "Kerala Spices");
    expect(decodeURIComponent(l.whatsapp)).toContain("utm_source=whatsapp");
    expect(decodeURIComponent(l.facebook)).toContain("utm_source=facebook");
    expect(l.instagramBio).toContain("utm_source=instagram");
  });
  it("opens WhatsApp with the shop name and link ready to send", () => {
    expect(shareLinks(url, "Kerala Spices").whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent("Shop at Kerala Spices: https://storva.example/shop/kerala-spices?utm_source=whatsapp")}`);
  });
  it("keeps an existing page parameter", () => expect(taggedUrl(`${url}?page=about`, "qr")).toBe(`${url}?page=about&utm_source=qr`));
});
