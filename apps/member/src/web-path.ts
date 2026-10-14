const basePath = (process.env.EXPO_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

// Public files and plain HTML links need the same prefix as Expo Router.
export function publicPath(path: string): string {
  if (
    !basePath ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path === basePath ||
    path.startsWith(basePath + "/")
  )
    return path;
  return basePath + path;
}
