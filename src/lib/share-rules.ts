/** Share links for a shop. Each link tags the visit with utm_source so Analytics shows where shoppers came from. */
export function taggedUrl(shopUrl: string, source: string) {
  const u = new URL(shopUrl);
  u.searchParams.set("utm_source", source);
  return u.toString();
}

export function shareLinks(shopUrl: string, storeName: string) {
  const text = (src: string) => `Shop at ${storeName}: ${taggedUrl(shopUrl, src)}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text("whatsapp"))}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(taggedUrl(shopUrl, "facebook"))}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(taggedUrl(shopUrl, "telegram"))}&text=${encodeURIComponent(`Shop at ${storeName}`)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(text("x"))}`,
    email: `mailto:?subject=${encodeURIComponent(storeName)}&body=${encodeURIComponent(text("email"))}`,
    qr: taggedUrl(shopUrl, "qr"),
    instagramBio: taggedUrl(shopUrl, "instagram"),
  };
}
