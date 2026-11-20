const getToken = async () => 'whiteboard-fixture-token';

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: 'whiteboard-user-a', getToken };
}
