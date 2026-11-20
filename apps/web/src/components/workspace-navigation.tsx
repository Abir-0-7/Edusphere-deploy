'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sections = [
  {
    label: 'Study',
    links: [
      { href: '/dashboard', label: 'Overview' },
      { href: '/library', label: 'My library' },
      { href: '/tutor', label: 'AI tutor' },
    ],
  },
  {
    label: 'Practice',
    links: [
      { href: '/review', label: 'Flashcards' },
      { href: '/courses', label: 'Guided courses' },
      { href: '/learning-profile', label: 'Learning profile' },
      { href: '/progress', label: 'Focus & progress' },
      { href: '/games', label: 'Game vault' },
    ],
  },
  {
    label: 'Tools',
    links: [
      { href: '/tools', label: 'Academic toolkit' },
      { href: '/account', label: 'Account' },
    ],
  },
];

export function WorkspaceNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace navigation" className={mobile ? 'app-mobile-nav' : 'app-side-nav'}>
      {sections.flatMap(({ label, links }) => [
        <p key={label} className="app-nav-section">
          {label}
        </p>,
        ...links.map(({ href, label: name }, index) => {
          const active =
            pathname === href ||
            pathname.startsWith(href + '/') ||
            (href === '/library' && pathname.startsWith('/document/'));
          return (
            <Link key={href} href={href} className="app-nav-link" aria-current={active ? 'page' : undefined}>
              <span className="app-nav-mark" aria-hidden="true">
                {String(index + 1 + (label === 'Practice' ? 3 : label === 'Tools' ? 8 : 0)).padStart(2, '0')}
              </span>
              <span>{name}</span>
            </Link>
          );
        }),
      ])}
    </nav>
  );
}
