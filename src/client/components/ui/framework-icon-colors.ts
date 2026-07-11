const WHITE_ON_DARK_ICON_SLUGS = new Set([
  "deno",
  "expo",
  "flask",
  "golang",
  "rust"
]);

export function frameworkIconClassName(slug: string | null | undefined, onDark = true) {
  return onDark && slug && WHITE_ON_DARK_ICON_SLUGS.has(slug) ? "brightness-0 invert" : "";
}
