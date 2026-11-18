// Isolated rendering fixture only. The production module uses Clerk normally.
const getToken = async () => 'fixture-token';
export function useAuth() {
  return { isLoaded: true, userId: 'fixture-learner', isSignedIn: true, getToken };
}
