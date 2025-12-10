/**
 * Selects a playback key from an item object.
 * @param {Object} item - Object representing a media item; may contain `path`, `relativePath`, `downloadUrl`, or `url`.
 * @returns {string|null} The first defined value among `item.path`, `item.relativePath`, `item.downloadUrl`, and `item.url`, or `null` if none are present.
 */
export function playKeyForItem(item) {
  return item.path || item.relativePath || item.downloadUrl || item.url || null;
}

/**
 * Builds an alternative relative path by replacing certain audio extensions with a placeholder video extension.
 * @param {string|null|undefined} relPath - The relative path to transform; if falsy, no transformation is performed.
 * @returns {string|null} The transformed path with `.unknown_video` (preserving an optional `.part` suffix) if a pattern matched, `null` otherwise.
 */
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