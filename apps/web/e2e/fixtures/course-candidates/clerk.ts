// Only the private local-browser fixture aliases Clerk. The main app uses
// its real protected layout and the local API still checks bearer identity.
const getOwner = () => window.localStorage.getItem('fixture-learner') ?? 'missing-fixture-owner';
const getToken = async () => getOwner();
const session = { id: 'fixture-session', user: { id: getOwner() }, getToken };

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, getToken };
}

export function useSession() {
  return { isLoaded: true, session };
}
