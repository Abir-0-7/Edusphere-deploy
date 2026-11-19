const getToken = async () => 'fixture-token';
export function useAuth() { return { getToken, userId: 'map-fixture-owner', isLoaded: true }; }
