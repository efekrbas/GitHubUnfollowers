import { UserNode } from "../model/user";

function getCurrentGithubLogin(): string {
  const meta = document.querySelector('meta[name="user-login"]') as HTMLMetaElement | null;
  if (meta && meta.content) return meta.content;
  const m = location.pathname.match(/^\/([A-Za-z0-9-_.]+)(?:\/|$)/);
  if (m) return m[1];
  throw new Error("Could not determine GitHub login. Make sure you're logged in.");
}

async function fetchHtml(path: string): Promise<Document> {
  const url = path.startsWith('http') ? path : `${location.origin}${path}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const text = await res.text();
  return new DOMParser().parseFromString(text, 'text/html');
}

function extractUsernames(doc: Document): string[] {
  const usernames = new Set<string>();
  const anchors = Array.from(doc.querySelectorAll('a[data-hovercard-type="user"], a.Link--secondary, a.Link--primary')) as HTMLAnchorElement[];
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/^\/([A-Za-z0-9-_.]+)$/);
    if (m) usernames.add(m[1]);
  }
  return Array.from(usernames);
}

function getNextPage(doc: Document): string | null {
  const nextEl = (doc.querySelector('a.next_page, a[rel="next"], .paginate-container a.next_page, .pagination a.next_page') as HTMLAnchorElement | null);
  const next = nextEl?.getAttribute('href');
  if (!next) return null;
  if (next.startsWith('http')) return new URL(next).pathname + new URL(next).search;
  return next;
}

async function getAllUsernames(listPath: string): Promise<Set<string>> {
  const result = new Set<string>();
  let path = listPath;
  for (let guard = 0; guard < 100 && path; guard++) {
    const doc = await fetchHtml(path);
    extractUsernames(doc).forEach(u => result.add(u));
    const next = getNextPage(doc);
    if (!next) break;
    path = next;
  }
  return result;
}

export async function scanGithubUsers(): Promise<readonly UserNode[]> {
  const login = getCurrentGithubLogin();
  // Correct paths for GitHub profile tabs
  const following = await getAllUsernames(`/${encodeURIComponent(login)}?tab=following`);
  const followers = await getAllUsernames(`/${encodeURIComponent(login)}?tab=followers`);

  const users: UserNode[] = [];
  Array.from(following).forEach(u => {
    users.push({
      id: u,
      username: u,
      full_name: u,
      profile_pic_url: `https://avatars.githubusercontent.com/${encodeURIComponent(u)}`,
      is_private: false,
      is_verified: false,
      follows_viewer: followers.has(u),
      followed_by_viewer: true,
      requested_by_viewer: false,
      reel: {
        id: u,
        expiring_at: 0,
        has_pride_media: false,
        latest_reel_media: 0,
        seen: null,
        owner: { __typename: 0 as unknown as any, id: u, profile_pic_url: `https://avatars.githubusercontent.com/${encodeURIComponent(u)}`, username: u },
      },
    });
  });
  return users;
}

function getGithubCsrfToken(): string | null {
  const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
  return meta && meta.content ? meta.content : null;
}

// Best-effort unfollow using GitHub web endpoint
export async function unfollowGithubUser(username: string): Promise<void> {
  const token = getGithubCsrfToken();
  // GitHub uses a generic follow toggle endpoint behind actions. This endpoint may change; using current stable path.
  // POST /users/follow?target=<username> follows; DELETE or POST /users/unfollow unfollows in many pages via AJAX.
  const params = new URLSearchParams();
  params.set('target', username);
  if (token) {
    const res = await fetch(`${location.origin}/users/unfollow`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrf-token': token,
      },
      body: params.toString(),
    });
    if (res.ok) return;
  }
  // Fallback: Load profile page, extract authenticity_token and unfollow form
  try {
    const doc = await (async () => {
      const htmlRes = await fetch(`${location.origin}/${encodeURIComponent(username)}`, { credentials: 'include' });
      if (!htmlRes.ok) throw new Error(`profile HTTP ${htmlRes.status}`);
      const html = await htmlRes.text();
      return new DOMParser().parseFromString(html, 'text/html');
    })();
    const form = doc.querySelector('form[action*="/users/unfollow"]') as HTMLFormElement | null;
    if (!form) throw new Error('unfollow form not found');
    const action = form.getAttribute('action') || '/users/unfollow';
    const auth = (form.querySelector('input[name="authenticity_token"]') as HTMLInputElement | null)?.value || token || '';
    const target = (form.querySelector('input[name="target"]') as HTMLInputElement | null)?.value || username;
    const body = new URLSearchParams();
    body.set('authenticity_token', auth);
    body.set('target', target);
    const formRes = await fetch(`${location.origin}${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrf-token': auth,
      },
      body: body.toString(),
    });
    if (!formRes.ok) throw new Error(`form HTTP ${formRes.status}`);
  } catch (e) {
    throw new Error(`Unfollow ${username} failed: ${(e as Error).message}`);
  }
}
