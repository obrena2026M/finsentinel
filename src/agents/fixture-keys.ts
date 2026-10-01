// Content-derived keys used ONLY by the MockGateway to pick fixtures. The real gateway ignores them.
// Keys are derived from document/case content so seed, tests and the evaluation runner all resolve the
// same fixture regardless of generated ids or refs.

export function slug(s: string, words = 5): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, words)
    .join('-');
}

/** e.g. "product_proposal__product-proposal-international-instant-payments" */
export function documentFixtureKey(
  kind: string,
  chunks: Array<{ heading: string | null; text: string }>,
): string {
  const first = chunks.find((c) => c.heading)?.heading ?? chunks[0]?.text.split('\n')[0] ?? '';
  return `${kind}__${slug(first)}`;
}

/** e.g. "international-instant-payments" */
export function caseFixtureKey(title: string): string {
  return slug(title, 3);
}
