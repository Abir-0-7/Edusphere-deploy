const getToken = async () => 'bibliography-fixture-token';

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    getToken,
  };
}
