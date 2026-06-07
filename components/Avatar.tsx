// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Avatar mit Initialen-Fallback:
 * - Initialen: max. 2 Zeichen aus an [\s._-] getrennten Teilen, sonst erste 2 Zeichen
 * - deterministische HSL-Farbe aus dem String: hash = c + (hash<<5) - hash,
 *   hue = |hash| % 360, hsl(hue 55% 45%), Schrift weiß, fontSize = size*0.4
 * - mit Bild: <img class="rounded-full object-cover">
 */

export function initialsFor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function colorFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    hash = c + (hash << 5) - hash;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

export function Avatar({
  name,
  src,
  size = 40,
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-label={name}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: colorFor(name),
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initialsFor(name)}
    </span>
  );
}
