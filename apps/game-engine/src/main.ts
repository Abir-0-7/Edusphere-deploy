import { mountGameVault } from './vault-view';

// The standalone preview and signed-in web page share the same accessible
// controls, deterministic timing and replay transcript. Rendering controls in
// native HTML avoids canvas-only hitboxes that clip or lose keyboard focus.
const host = document.getElementById('game');
if (host) mountGameVault(host);
