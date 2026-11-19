export const citationGolden = {
  apa: {
    citation: '(Lovelace, 1843, p. 14)',
    bibliography:
      'Lovelace, A. (1843). Algorithms in Plain English (pp. 12–28). Example Press. https://doi.org/10.1234/example\n',
  },
  mla: {
    citation: '(Lovelace 14)',
    bibliography:
      'Lovelace, Ada. Algorithms in Plain English. Example Press, 1843, pp. 12–28, https://doi.org/10.1234/example.\n',
  },
  ieee: {
    citation: '[1, p. 14]',
    bibliography:
      '[1] A. Lovelace, Algorithms in Plain English. Example Press, 1843, pp. 12–28. doi: 10.1234/example.\n',
  },
} as const;

export const ieeeSecondCitation = '[2, p. 14]';
