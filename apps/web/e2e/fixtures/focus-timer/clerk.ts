// Only used by this isolated fixture; the application retains real Clerk auth.
const getToken = async () => 'focus-fixture-token';
export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: 'focus-fixture-learner', getToken };
}
