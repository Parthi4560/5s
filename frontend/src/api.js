const KEY = '5s-auth';

export const getAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
};
export const setAuth = (a) =>
  a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY);

export async function api(path, { method = 'GET', body, form } = {}) {
  const auth = getAuth();
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    setAuth(null);
    location.href = '/login';
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const tok = () => encodeURIComponent(getAuth()?.token || '');
export const imgUrl = (f) => (f ? `/uploads/${f}?token=${tok()}` : null);
export const pdfUrl = (pid) => `/api/projects/${pid}/report.pdf?token=${tok()}`;
