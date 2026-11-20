import { useEffect, useState } from 'react';
let owner = 'document-tools-owner';
const getToken = async () => owner;
export function switchOwner() {
  owner = 'document-tools-other';
  window.dispatchEvent(new Event('fixture-owner'));
}
export function useAuth() {
  const [userId, setUserId] = useState(owner);
  useEffect(() => {
    const update = () => setUserId(owner);
    window.addEventListener('fixture-owner', update);
    return () => window.removeEventListener('fixture-owner', update);
  }, []);
  return { getToken, userId, isLoaded: true };
}
