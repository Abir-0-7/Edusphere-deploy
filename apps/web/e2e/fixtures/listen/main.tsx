import { createRoot } from 'react-dom/client';
import { SummaryPanel } from '@/components/summary-panel';

createRoot(document.getElementById('root')!).render(
  <SummaryPanel
    chapter={{
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Photosynthesis',
      ordinal: 1,
      start_page: 1,
      end_page: 2,
    }}
  />,
);
