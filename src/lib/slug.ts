export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workspace';
}

export async function uniqueSlug(base: string, exists: (s: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let i = 1;
  while (await exists(candidate)) {
    candidate = `${root}-${i++}`;
    if (i > 1000) break;
  }
  return candidate;
}
