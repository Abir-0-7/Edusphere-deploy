export type VaultMission = {
  id: string;
  name: string;
  tokens: number;
  xp: number;
  playable: boolean;
};

/** Public display metadata. Production prices are validated again on the server. */
export const CYBERVERSE_MISSIONS: readonly VaultMission[] = [
  { id: 'binary_city', name: 'Binary City', tokens: 5, xp: 100, playable: true },
  { id: 'code_district', name: 'Code District', tokens: 10, xp: 150, playable: false },
  { id: 'network_nexus', name: 'Network Nexus', tokens: 15, xp: 200, playable: false },
  { id: 'firewall_fortress', name: 'Firewall Fortress', tokens: 20, xp: 250, playable: false },
  { id: 'algorithm_arena', name: 'Algorithm Arena', tokens: 25, xp: 300, playable: false },
  { id: 'malware_core', name: 'Malware Core', tokens: 30, xp: 350, playable: false },
];

export type GameVaultEntry = {
  id: string;
  title: string;
  category: string;
  description: string;
  entryUrl: string;
  bridge: 'edusphere-v1' | 'none';
  controls: string;
  /** Supported play surfaces, shown on the Game Vault card. */
  platforms: readonly { label: string; detail: string }[];
  missions: readonly VaultMission[];
};

/** Add another entry to extend the vault without changing the player wrapper. */
export const gameVaultCatalog: readonly GameVaultEntry[] = [
  {
    id: 'cyberverse',
    title: 'CYBERVERSE',
    category: '3D cyberpunk adventure',
    description:
      'Explore a neon cyberpunk city in third person and decode Binary City. Play on Desktop with Keyboard + Mouse, or on Mobile/Tablet with on-screen Touch Controls. Five more educational districts are available as previews.',
    entryUrl: '/games/cyberverse/index.html',
    bridge: 'edusphere-v1',
    controls:
      'Desktop: WASD Move | E Terminal | M Missions | P Pause | R Respawn · Touch: Stick Move / Sprint | Drag Look | Tap Actions',
    platforms: [
      { label: 'Desktop', detail: 'Keyboard + Mouse' },
      { label: 'Mobile/Tablet', detail: 'Touch Controls' },
    ],
    missions: CYBERVERSE_MISSIONS,
  },
  {
    id: 'logic-arcade',
    title: 'Logic Arcade',
    category: 'Four original EduSphere games',
    description:
      'Sorting Race, N-Queens, Towers of Hanoi and Flashcard Tower Defense. The original games and their verified rewards remain available.',
    entryUrl: '/games/index.html',
    bridge: 'none',
    controls: 'Mouse / touch to play | 1–4 Choose game | Y / N Tower Defense',
    platforms: [],
    missions: [],
  },
];

export function getVaultGame(id: string): GameVaultEntry | undefined {
  return gameVaultCatalog.find((game) => game.id === id);
}
