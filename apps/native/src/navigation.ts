export function localDestination(value: unknown, origin: string) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    /[\\\r\n]/.test(value)
  )
    return "/";
  try {
    const url = value.startsWith("mangumi://")
      ? new URL(value.replace(/^mangumi:\/\//, `${origin}/`))
      : new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}
