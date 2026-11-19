export function useParams() {
  return { id: location.pathname.split('/').filter(Boolean)[1] ?? '' };
}
export function useSearchParams() { return new URLSearchParams(location.search); }
export function useRouter() {
  return { replace: (url: string) => location.assign(url), push: (url: string) => location.assign(url) };
}
