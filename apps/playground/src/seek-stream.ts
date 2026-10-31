import { StreamNormalizer, type FormatName as Format } from 'tetra-stream';

/** Rebuild from the received prefix so rewinding never leaves future data behind. */
export function seekStream(source: string, format: Format, requestedPosition: number) {
  const position = Math.min(
    source.length,
    Math.max(0, Math.round(Number.isFinite(requestedPosition) ? requestedPosition : 0)),
  );
  const parser = new StreamNormalizer({ format });
  try {
    if (position) parser.write(source.slice(0, position));
    if (position && position === source.length) parser.end();
  } catch {
    // A malformed prefix is still useful: expose its partial data and parser error.
  }
  return { parser, position, snapshot: parser.snapshot() };
}
