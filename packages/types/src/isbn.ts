const cleanIsbn = (value: string) => value.replace(/[-\s]/g, '').toUpperCase();

export function isValidIsbn(value: string): boolean {
  const isbn = cleanIsbn(value);
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const total = [...isbn].reduce(
      (sum, digit, index) => sum + (10 - index) * (digit === 'X' ? 10 : Number(digit)),
      0,
    );
    return total % 11 === 0;
  }
  return (
    /^\d{13}$/.test(isbn) &&
    [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10 === 0
  );
}

export function normalizeIsbn(value: string): string | null {
  const isbn = cleanIsbn(value);
  if (!isValidIsbn(isbn)) return null;
  if (isbn.length === 13) return isbn;
  const stem = `978${isbn.slice(0, 9)}`;
  const check =
    (10 -
      ([...stem].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10)) %
    10;
  return `${stem}${check}`;
}
