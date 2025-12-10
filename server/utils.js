export function playKeyForItem(item) {
  return item.path || item.relativePath || item.downloadUrl || item.url || null;
}

export function buildAltRelPath(relPath) {
  if (!relPath) return null;
  const replacements = [
    [/\.aac(\.part)?$/i, '.unknown_video$1'],
    [/\.mp3(\.part)?$/i, '.unknown_video$1'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(relPath)) {
      return relPath.replace(pattern, replacement);
    }
  }
  return null;
}
