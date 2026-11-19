import { createRoot } from 'react-dom/client';
import { TrackPlanPanel } from '../../../src/components/track-plan-panel';
import { fixtureGetToken } from './clerk';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing track plan fixture root');
createRoot(host).render(<TrackPlanPanel getToken={fixtureGetToken()} />);
