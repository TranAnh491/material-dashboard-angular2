export interface ParsedWarehouseLocation {
  shelf: string;
  slot: string | null;
  raw: string;
}

export function parseWarehouseLocation(
  location: string,
  knownShelves: string[]
): ParsedWarehouseLocation | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return null;

  const sorted = [...new Set(knownShelves.map(s => s.toUpperCase()))].sort(
    (a, b) => b.length - a.length
  );

  const dotMatch = raw.match(/^([A-Z]+\d*)\.(\d+)/i);
  if (dotMatch) {
    const shelf = matchShelf(dotMatch[1].toUpperCase(), sorted);
    if (shelf) {
      return { shelf, slot: dotMatch[2], raw };
    }
  }

  for (const shelf of sorted) {
    if (!raw.startsWith(shelf)) continue;

    const remainder = raw.slice(shelf.length);
    const slotMatch = remainder.match(/^(\d+)/);
    if (slotMatch) {
      return { shelf, slot: slotMatch[1], raw };
    }

    if (!remainder || /^[^0-9]/.test(remainder)) {
      return { shelf, slot: null, raw };
    }
  }

  if (raw.startsWith('IQC')) {
    const suffix = raw.slice(3).match(/^(\d+)/)?.[1] || null;
    return { shelf: 'IQC', slot: suffix, raw };
  }

  return null;
}

function matchShelf(part: string, sorted: string[]): string | null {
  if (sorted.includes(part)) return part;
  for (const shelf of sorted) {
    if (part.startsWith(shelf)) return shelf;
  }
  return null;
}
